/**
 * @file src/handlers/chaos.ts
 * @author Mendel Temgoua <mendeltemgouabusiness@gmail.com>
 * @license MIT
 * @description Gestionnaire du Mode Chaos & Résilience pour simuler les scénarios critiques :
 * - 429 Too Many Requests (Rate Limit Exceeded + Retry-After)
 * - 502 Bad Gateway / 503 Service Unavailable (Provider Down / Overloaded)
 * - Latence artificielle configurable (en ms)
 * - Taux d'échec probabiliste (0.0 -> 1.0)
 */

import { Request, Response } from 'express';

export interface GlobalChaosConfig {
  enabled: boolean;
  defaultLatencyMs: number;
  jitterMs: number;
  forcedStatusCode: 0 | 429 | 502 | 503 | 500 | 401;
  failureProbability: number; // 0.0 to 1.0
  retryAfterSeconds: number;
  streamChunkDelayMs: number;
  simulatedProvider: string;
}

export interface EvaluatedChaosPlan {
  shouldFail: boolean;
  statusCode: number;
  latencyMs: number;
  retryAfterSeconds: number;
  streamChunkDelayMs: number;
  provider: string;
  reason?: string;
}

// État global du Mode Chaos (modifiable via l'API /api/chaos-config ou variables d'environnement)
let globalChaosConfig: GlobalChaosConfig = {
  enabled: false,
  defaultLatencyMs: Number(process.env.MOCK_DEFAULT_LATENCY_MS || 0),
  jitterMs: 0,
  forcedStatusCode: (Number(process.env.MOCK_DEFAULT_ERROR_CODE || 0) as GlobalChaosConfig['forcedStatusCode']) || 0,
  failureProbability: Number(process.env.MOCK_FAILURE_PROBABILITY || 0),
  retryAfterSeconds: 5,
  streamChunkDelayMs: Number(process.env.MOCK_STREAM_CHUNK_DELAY_MS || 35),
  simulatedProvider: 'Auto',
};

export function getGlobalChaosConfig(): GlobalChaosConfig {
  return { ...globalChaosConfig };
}

export function updateGlobalChaosConfig(partial: Partial<GlobalChaosConfig>): GlobalChaosConfig {
  globalChaosConfig = {
    ...globalChaosConfig,
    ...partial,
  };
  return getGlobalChaosConfig();
}

export function resetGlobalChaosConfig(): GlobalChaosConfig {
  globalChaosConfig = {
    enabled: false,
    defaultLatencyMs: 0,
    jitterMs: 0,
    forcedStatusCode: 0,
    failureProbability: 0,
    retryAfterSeconds: 5,
    streamChunkDelayMs: 35,
    simulatedProvider: 'Auto',
  };
  return getGlobalChaosConfig();
}

/**
 * Déduit le fournisseur amont réaliste à partir de l'identifiant du modèle OpenRouter.
 */
export function inferProviderFromModel(model = 'openai/gpt-4o-mini', headerProvider?: string): string {
  if (headerProvider && headerProvider !== 'Auto') return headerProvider;
  if (globalChaosConfig.simulatedProvider && globalChaosConfig.simulatedProvider !== 'Auto') {
    return globalChaosConfig.simulatedProvider;
  }
  const lower = model.toLowerCase();
  if (lower.startsWith('anthropic/')) return 'Anthropic';
  if (lower.startsWith('openai/')) return 'OpenAI';
  if (lower.startsWith('mistralai/')) return 'Mistral';
  if (lower.startsWith('meta-llama/')) return 'Together AI';
  if (lower.startsWith('deepseek/')) return 'Fireworks';
  return 'OpenRouter-Primary';
}

/**
 * Pause asynchrone pour simuler la latence réseau ou le délai TTFT (Time To First Token).
 */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Analyse les en-têtes HTTP de la requête entrante (`x-mock-*` / `x-chaos-*`)
 * et la configuration globale pour calculer le plan d'exécution Chaos.
 */
export function evaluateChaosForRequest(req: Request, model: string): EvaluatedChaosPlan {
  const headerStatusRaw =
    req.header('x-mock-status') ||
    req.header('x-chaos-error') ||
    req.header('x-openrouter-mock-error');

  const headerLatencyRaw =
    req.header('x-mock-latency') ||
    req.header('x-chaos-latency') ||
    req.header('x-openrouter-mock-latency');

  const headerRetryRaw = req.header('x-mock-retry-after') || req.header('retry-after');
  const headerFailRateRaw = req.header('x-mock-fail-rate') || req.header('x-chaos-fail-rate');
  const headerChunkDelayRaw = req.header('x-mock-chunk-delay');
  const headerProvider = req.header('x-mock-provider');

  const provider = inferProviderFromModel(model, headerProvider);

  // 1. Calcul de la latence (en-tête prioritaire sur la config globale)
  let latencyMs = headerLatencyRaw !== undefined
    ? Math.max(0, Math.min(30000, parseInt(headerLatencyRaw, 10) || 0))
    : globalChaosConfig.enabled
      ? globalChaosConfig.defaultLatencyMs
      : 0;

  if (globalChaosConfig.enabled && globalChaosConfig.jitterMs > 0 && headerLatencyRaw === undefined) {
    latencyMs += Math.floor(Math.random() * globalChaosConfig.jitterMs);
  }

  const retryAfterSeconds = headerRetryRaw !== undefined
    ? Math.max(1, parseInt(headerRetryRaw, 10) || 5)
    : globalChaosConfig.retryAfterSeconds;

  const streamChunkDelayMs = headerChunkDelayRaw !== undefined
    ? Math.max(5, Math.min(2000, parseInt(headerChunkDelayRaw, 10) || 35))
    : globalChaosConfig.streamChunkDelayMs;

  // 2. Statut d'erreur explicite dans l'en-tête HTTP
  if (headerStatusRaw !== undefined) {
    const parsedStatus = parseInt(headerStatusRaw, 10);
    if ([401, 429, 500, 502, 503].includes(parsedStatus)) {
      return {
        shouldFail: true,
        statusCode: parsedStatus,
        latencyMs,
        retryAfterSeconds,
        streamChunkDelayMs,
        provider,
        reason: buildChaosReasonDescription(parsedStatus, latencyMs, retryAfterSeconds, provider),
      };
    }
  }

  // 3. Taux d'échec probabiliste par en-tête ou global
  const failProbability = headerFailRateRaw !== undefined
    ? Math.max(0, Math.min(1, parseFloat(headerFailRateRaw) || 0))
    : globalChaosConfig.enabled
      ? globalChaosConfig.failureProbability
      : 0;

  if (failProbability > 0 && Math.random() < failProbability) {
    const randomStatus =
      globalChaosConfig.enabled && globalChaosConfig.forcedStatusCode !== 0
        ? globalChaosConfig.forcedStatusCode
        : Math.random() < 0.5
          ? 429
          : 503;

    return {
      shouldFail: true,
      statusCode: randomStatus,
      latencyMs,
      retryAfterSeconds,
      streamChunkDelayMs,
      provider,
      reason: `Échec probabiliste (${Math.round(failProbability * 100)}%) -> HTTP ${randomStatus}`,
    };
  }

  // 4. Statut d'erreur forcé dans la configuration Chaos globale
  if (globalChaosConfig.enabled && globalChaosConfig.forcedStatusCode !== 0) {
    const status = globalChaosConfig.forcedStatusCode;
    return {
      shouldFail: true,
      statusCode: status,
      latencyMs,
      retryAfterSeconds,
      streamChunkDelayMs,
      provider,
      reason: buildChaosReasonDescription(status, latencyMs, retryAfterSeconds, provider),
    };
  }

  return {
    shouldFail: false,
    statusCode: 200,
    latencyMs,
    retryAfterSeconds,
    streamChunkDelayMs,
    provider,
    reason: latencyMs > 0 ? `Latence injectée (${latencyMs}ms)` : undefined,
  };
}

function buildChaosReasonDescription(
  status: number,
  latencyMs: number,
  retryAfterSeconds: number,
  provider: string
): string {
  const latencySuffix = latencyMs > 0 ? ` + Latence ${latencyMs}ms` : '';
  switch (status) {
    case 429:
      return `Rate Limit Exceeded (429) — Retry-After: ${retryAfterSeconds}s${latencySuffix}`;
    case 502:
      return `Bad Gateway Upstream (502 - ${provider})${latencySuffix}`;
    case 503:
      return `Provider Down / Overloaded (503 - ${provider})${latencySuffix}`;
    case 401:
      return `Invalid Credentials (401)${latencySuffix}`;
    default:
      return `Internal Provider Error (${status})${latencySuffix}`;
  }
}

/**
 * Envoie une réponse d'erreur formatée selon le standard exact d'OpenRouter.
 */
export function sendOpenRouterChaosError(
  res: Response,
  plan: EvaluatedChaosPlan,
  model: string
): { responseBody: Record<string, unknown> } {
  res.setHeader('X-OpenRouter-Mock', 'true');
  res.setHeader('X-OpenRouter-Provider', plan.provider);

  if (plan.statusCode === 429) {
    res.setHeader('Retry-After', String(plan.retryAfterSeconds));
    res.setHeader('X-RateLimit-Limit-Requests', '60');
    res.setHeader('X-RateLimit-Remaining-Requests', '0');
    res.setHeader('X-RateLimit-Reset-Requests', `${plan.retryAfterSeconds}s`);

    const body = {
      error: {
        message: `Rate limit exceeded for model ${model} on provider ${plan.provider}. Please retry after ${plan.retryAfterSeconds} seconds or configure fallback models.`,
        code: 429,
        metadata: {
          provider_name: plan.provider,
          retry_after_seconds: plan.retryAfterSeconds,
          rate_limit_type: 'requests_per_minute',
          raw: `upstream_rate_limit_exceeded: ${model}`,
        },
      },
    };
    res.status(429).json(body);
    return { responseBody: body };
  }

  if (plan.statusCode === 502 || plan.statusCode === 503) {
    const is502 = plan.statusCode === 502;
    const body = {
      error: {
        message: is502
          ? `Upstream provider ${plan.provider} returned an invalid gateway response (HTTP 502) while serving ${model}.`
          : `Provider ${plan.provider} is currently unavailable or overloaded (HTTP 503) for model ${model}. Consider configuring model fallbacks in your OpenRouter request.`,
        code: plan.statusCode,
        metadata: {
          provider_name: plan.provider,
          model_slug: model,
          fallback_recommended: true,
          raw: is502 ? 'bad_gateway_upstream_eof' : 'upstream_provider_overloaded',
        },
      },
    };
    res.status(plan.statusCode).json(body);
    return { responseBody: body };
  }

  if (plan.statusCode === 401) {
    const body = {
      error: {
        message: 'No valid OpenRouter API key provided in Authorization Bearer header.',
        code: 401,
        metadata: {
          provider_name: 'OpenRouter-Auth',
        },
      },
    };
    res.status(401).json(body);
    return { responseBody: body };
  }

  const body = {
    error: {
      message: `Simulated internal error (${plan.statusCode}) on provider ${plan.provider}.`,
      code: plan.statusCode,
      metadata: {
        provider_name: plan.provider,
      },
    },
  };
  res.status(plan.statusCode).json(body);
  return { responseBody: body };
}
