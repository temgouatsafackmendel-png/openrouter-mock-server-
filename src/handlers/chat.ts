/**
 * @file src/handlers/chat.ts
 * @author Mendel Temgoua <mendeltemgouabusiness@gmail.com>
 * @license MIT
 * @description Implémentation de l'endpoint POST /v1/chat/completions et GET /v1/models
 * conforme au contrat OpenAI / OpenRouter, avec support natif du streaming SSE (Server-Sent Events)
 * et intégration du Mode Chaos & Console Inspector.
 */

import { Request, Response } from 'express';
import {
  evaluateChaosForRequest,
  sendOpenRouterChaosError,
  sleep,
} from './chaos.ts';
import { logAgentRequest } from '../logger.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface ChatCompletionRequestBody {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  response_format?: { type?: 'text' | 'json_object' };
  tools?: Array<{
    type: string;
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
  }>;
  models?: string[]; // OpenRouter model fallback array
}

export const MOCK_OPENROUTER_MODELS = [
  {
    id: 'anthropic/claude-3.7-sonnet',
    name: 'Anthropic: Claude 3.7 Sonnet (Mock)',
    context_length: 200000,
    pricing: { prompt: '0.000003', completion: '0.000015' },
    top_provider: { name: 'Anthropic', is_moderated: false },
  },
  {
    id: 'openai/gpt-4o',
    name: 'OpenAI: GPT-4o (Mock)',
    context_length: 128000,
    pricing: { prompt: '0.0000025', completion: '0.00001' },
    top_provider: { name: 'OpenAI', is_moderated: true },
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek: R1 Reasoning (Mock)',
    context_length: 128000,
    pricing: { prompt: '0.00000055', completion: '0.00000219' },
    top_provider: { name: 'Fireworks', is_moderated: false },
  },
  {
    id: 'mistralai/mistral-large-2411',
    name: 'Mistral: Mistral Large 2411 (Mock)',
    context_length: 128000,
    pricing: { prompt: '0.000002', completion: '0.000006' },
    top_provider: { name: 'Mistral', is_moderated: false },
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Meta: Llama 3.3 70B Instruct (Mock)',
    context_length: 131072,
    pricing: { prompt: '0.00000012', completion: '0.0000003' },
    top_provider: { name: 'Together AI', is_moderated: false },
  },
];

/**
 * Estime de façon déterministe le nombre de tokens d'un texte (~4 caractères par token).
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

/**
 * Génère une réponse déterministe réaliste adaptée au prompt, au modèle et au profil demandé.
 */
function buildDeterministicReply(
  model: string,
  provider: string,
  messages: ChatMessage[],
  scenarioHeader?: string,
  responseFormatType?: string
): string {
  const lastUserMessage =
    [...messages].reverse().find((m) => m.role === 'user')?.content ||
    messages[messages.length - 1]?.content ||
    'Ping test';

  const trimmedPrompt = lastUserMessage.slice(0, 160);

  if (scenarioHeader === 'json' || responseFormatType === 'json_object') {
    return JSON.stringify(
      {
        status: 'verified',
        mock_server: 'openrouter-mock-server',
        routed_model: model,
        upstream_provider: provider,
        deterministic: true,
        input_summary: trimmedPrompt,
        actions: ['validate_schema', 'commit_checkpoint', 'acknowledge_agent'],
      },
      null,
      2
    );
  }

  if (scenarioHeader === 'reasoning' || model.includes('deepseek-r1')) {
    return `<think>\n1. Réception de la requête agent sur ${model} via ${provider}.\n2. Vérification des contraintes de résilience et du contexte (${messages.length} messages).\n3. Synthèse d'une réponse déterministe reproductible pour les tests d'intégration.\n</think>\n\n[OpenRouter Mock · ${model}] Analyse déterministe exécutée avec succès pour le prompt : "${trimmedPrompt}". Toutes les assertions de contrat API et de routage (${provider}) sont validées.`;
  }

  if (scenarioHeader === 'code') {
    return `Voici l'implémentation déterministe générée par **${model}** (${provider}) :\n\n\`\`\`typescript\nexport async function executeWithRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {\n  for (let attempt = 1; attempt <= retries; attempt++) {\n    try {\n      return await fn();\n    } catch (err) {\n      if (attempt === retries) throw err;\n      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));\n    }\n  }\n  throw new Error('Unreachable');\n}\n\`\`\``;
  }

  return `[OpenRouter Mock · ${model} via ${provider}] Réponse déterministe générée pour votre requête (${messages.length} message${messages.length > 1 ? 's' : ''}) : "${trimmedPrompt}". Le pipeline d'agent a reçu un payload conforme au schéma OpenAI/OpenRouter sans consommer de crédits externes.`;
}

/**
 * Découpe un texte en segments (chunks) réalistes pour l'émulation du streaming SSE.
 */
function tokenizeForSSE(text: string): string[] {
  const tokens = text.match(/(\S+\s*|\n+)/g);
  return tokens && tokens.length > 0 ? tokens : [text];
}

/**
 * Masque partiellement les clés API dans les en-têtes enregistrés par le Console Inspector.
 */
function sanitizeHeaders(headers: Request['headers']): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    const strVal = Array.isArray(value) ? value.join(', ') : String(value);
    if (key.toLowerCase() === 'authorization' && strVal.length > 14) {
      result[key] = `${strVal.slice(0, 12)}••••••••${strVal.slice(-4)}`;
    } else {
      result[key] = strVal;
    }
  }
  return result;
}

/**
 * GET /v1/models — Retourne la liste des modèles émulés au format OpenRouter.
 */
export function handleListModels(_req: Request, res: Response): void {
  res.json({
    data: MOCK_OPENROUTER_MODELS,
  });
}

/**
 * POST /v1/chat/completions — Endpoint principal d'émulation OpenRouter.
 */
export async function handleChatCompletions(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  const body = (req.body || {}) as ChatCompletionRequestBody;

  // Support du tableau `models` (fallback OpenRouter) ou du champ standard `model`
  const model =
    body.model ||
    (Array.isArray(body.models) && body.models.length > 0 ? body.models[0] : 'anthropic/claude-3.7-sonnet');

  const messages: ChatMessage[] = Array.isArray(body.messages) && body.messages.length > 0
    ? body.messages
    : [{ role: 'user', content: 'Hello OpenRouter Mock Server!' }];

  const isStream = Boolean(body.stream);
  const scenarioHeader = req.header('x-mock-scenario');

  const lastMessageContent = messages[messages.length - 1]?.content || '';
  const promptPreview =
    typeof lastMessageContent === 'string'
      ? lastMessageContent.slice(0, 120)
      : JSON.stringify(lastMessageContent).slice(0, 120);

  const promptTokens = messages.reduce(
    (acc, msg) => acc + estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)) + 4,
    0
  );

  // 1. Évaluation du plan Chaos (429, 502, 503, latence, probabilité)
  const chaosPlan = evaluateChaosForRequest(req, model);

  // 2. Injection de la latence artificielle éventuelle
  if (chaosPlan.latencyMs > 0) {
    await sleep(chaosPlan.latencyMs);
  }

  const generationId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdUnix = Math.floor(Date.now() / 1000);

  // 3. Si le Mode Chaos déclenche une erreur (429, 502, 503, 401, 500)
  if (chaosPlan.shouldFail) {
    const { responseBody } = sendOpenRouterChaosError(res, chaosPlan, model);
    const totalElapsed = Date.now() - startTime;

    logAgentRequest({
      id: generationId,
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl || '/v1/chat/completions',
      model,
      provider: chaosPlan.provider,
      stream: isStream,
      statusCode: chaosPlan.statusCode,
      latencyMs: totalElapsed,
      chaosTriggered: true,
      chaosReason: chaosPlan.reason,
      agentTitle: req.header('x-title'),
      httpReferer: req.header('http-referer') || req.header('referer'),
      promptPreview,
      messageCount: messages.length,
      promptTokens,
      completionTokens: 0,
      totalTokens: promptTokens,
      requestHeaders: sanitizeHeaders(req.headers),
      requestBody: body,
      responsePreview: JSON.stringify(responseBody),
    });
    return;
  }

  // 4. Génération de la réponse déterministe
  const replyText = buildDeterministicReply(
    model,
    chaosPlan.provider,
    messages,
    scenarioHeader,
    body.response_format?.type
  );
  const completionTokens = estimateTokens(replyText);
  const totalTokens = promptTokens + completionTokens;

  // En-têtes standards OpenRouter
  res.setHeader('X-OpenRouter-Mock', 'true');
  res.setHeader('X-OpenRouter-Provider', chaosPlan.provider);
  res.setHeader('X-OpenRouter-Generation-Id', generationId);

  // 5. Branche A : Streaming SSE (Server-Sent Events)
  if (isStream) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const chunks = tokenizeForSSE(replyText);

    // Chunk initial avec le rôle assistant
    const initialChunk = {
      id: generationId,
      provider: chaosPlan.provider,
      model,
      object: 'chat.completion.chunk',
      created: createdUnix,
      system_fingerprint: 'fp_openrouter_mock_v1',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null,
        },
      ],
    };
    res.write(`data: ${JSON.stringify(initialChunk)}\n\n`);

    let clientClosed = false;
    req.on('close', () => {
      clientClosed = true;
    });

    for (let i = 0; i < chunks.length; i++) {
      if (clientClosed) break;
      await sleep(chaosPlan.streamChunkDelayMs);

      const contentChunk = {
        id: generationId,
        provider: chaosPlan.provider,
        model,
        object: 'chat.completion.chunk',
        created: createdUnix,
        system_fingerprint: 'fp_openrouter_mock_v1',
        choices: [
          {
            index: 0,
            delta: { content: chunks[i] },
            finish_reason: null,
          },
        ],
      };
      res.write(`data: ${JSON.stringify(contentChunk)}\n\n`);
    }

    // Dernier chunk avec finish_reason="stop" et statistiques d'usage OpenRouter
    const finalChunk = {
      id: generationId,
      provider: chaosPlan.provider,
      model,
      object: 'chat.completion.chunk',
      created: createdUnix,
      system_fingerprint: 'fp_openrouter_mock_v1',
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    };
    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

    const totalElapsed = Date.now() - startTime;
    logAgentRequest({
      id: generationId,
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl || '/v1/chat/completions',
      model,
      provider: chaosPlan.provider,
      stream: true,
      statusCode: 200,
      latencyMs: totalElapsed,
      chaosTriggered: chaosPlan.latencyMs > 0,
      chaosReason: chaosPlan.reason,
      agentTitle: req.header('x-title'),
      httpReferer: req.header('http-referer') || req.header('referer'),
      promptPreview,
      messageCount: messages.length,
      promptTokens,
      completionTokens,
      totalTokens,
      requestHeaders: sanitizeHeaders(req.headers),
      requestBody: body,
      responsePreview: replyText,
    });
    return;
  }

  // 6. Branche B : Réponse JSON synchrone standard
  const hasToolRequest =
    scenarioHeader === 'tool_call' ||
    (Array.isArray(body.tools) && body.tools.length > 0 && req.header('x-mock-tool-call') !== 'false');

  const toolCallPayload = hasToolRequest
    ? [
        {
          id: `call_${Math.random().toString(36).slice(2, 10)}`,
          type: 'function',
          function: {
            name: body.tools?.[0]?.function?.name || 'check_service_health',
            arguments: JSON.stringify({
              target: 'payment-gateway-eu',
              timeout_ms: 1500,
              fallback_enabled: true,
            }),
          },
        },
      ]
    : undefined;

  const responsePayload = {
    id: generationId,
    provider: chaosPlan.provider,
    model,
    object: 'chat.completion',
    created: createdUnix,
    system_fingerprint: 'fp_openrouter_mock_v1',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: hasToolRequest ? null : replyText,
          ...(toolCallPayload ? { tool_calls: toolCallPayload } : {}),
        },
        logprobs: null,
        finish_reason: hasToolRequest ? 'tool_calls' : 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    },
  };

  res.status(200).json(responsePayload);

  const totalElapsed = Date.now() - startTime;
  logAgentRequest({
    id: generationId,
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.originalUrl || '/v1/chat/completions',
    model,
    provider: chaosPlan.provider,
    stream: false,
    statusCode: 200,
    latencyMs: totalElapsed,
    chaosTriggered: chaosPlan.latencyMs > 0,
    chaosReason: chaosPlan.reason,
    agentTitle: req.header('x-title'),
    httpReferer: req.header('http-referer') || req.header('referer'),
    promptPreview,
    messageCount: messages.length,
    promptTokens,
    completionTokens,
    totalTokens,
    requestHeaders: sanitizeHeaders(req.headers),
    requestBody: body,
    responsePreview: hasToolRequest ? JSON.stringify(toolCallPayload) : replyText,
  });
}
