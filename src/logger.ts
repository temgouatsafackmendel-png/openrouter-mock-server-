/**
 * @file src/logger.ts
 * @author Mendel Temgoua <mendeltemgouabusiness@gmail.com>
 * @license MIT
 * @description Console Inspector — Journalisation ANSI structurée et colorée dans le terminal
 * + buffer circulaire en mémoire pour l'inspection temps réel dans l'interface Web.
 */

export interface AgentInspectionLog {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  model: string;
  provider: string;
  stream: boolean;
  statusCode: number;
  latencyMs: number;
  chaosTriggered: boolean;
  chaosReason?: string;
  agentTitle?: string;
  httpReferer?: string;
  promptPreview: string;
  messageCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responsePreview: string;
}

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m\x1b[37m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgYellow: '\x1b[43m\x1b[30m',
};

const MAX_LOG_ENTRIES = 100;
const inspectionBuffer: AgentInspectionLog[] = [];

/**
 * Formate le badge de statut HTTP avec couleur ANSI pour la console.
 */
function formatStatusAnsi(status: number): string {
  if (status >= 200 && status < 300) {
    return `${ANSI.bgGreen} ${status} OK ${ANSI.reset}`;
  }
  if (status === 429) {
    return `${ANSI.bgYellow} 429 RATE LIMIT ${ANSI.reset}`;
  }
  return `${ANSI.bgRed} ${status} ERROR ${ANSI.reset}`;
}

/**
 * Enregistre une requête entrante d'agent dans la console avec formatage structuré
 * et stocke l'entrée dans le buffer du Console Inspector.
 */
export function logAgentRequest(entry: AgentInspectionLog): void {
  inspectionBuffer.unshift(entry);
  if (inspectionBuffer.length > MAX_LOG_ENTRIES) {
    inspectionBuffer.pop();
  }

  const verbose = process.env.MOCK_VERBOSE_LOGGING !== 'false';
  if (!verbose) return;

  const border = `${ANSI.gray}${'─'.repeat(76)}${ANSI.reset}`;
  const statusBadge = formatStatusAnsi(entry.statusCode);
  const modeTag = entry.stream
    ? `${ANSI.cyan}[SSE STREAM]${ANSI.reset}`
    : `${ANSI.blue}[JSON SYNC]${ANSI.reset}`;
  const chaosTag = entry.chaosTriggered
    ? ` ${ANSI.red}${ANSI.bold}[CHAOS: ${entry.chaosReason || entry.statusCode}]${ANSI.reset}`
    : '';

  console.log(`\n${border}`);
  console.log(
    `${ANSI.bold}${ANSI.magenta}⚡ OPENROUTER CONSOLE INSPECTOR${ANSI.reset} ${ANSI.gray}(${entry.timestamp})${ANSI.reset}`
  );
  console.log(
    `   ${statusBadge} ${modeTag}${chaosTag} ${ANSI.bold}${entry.method} ${entry.path}${ANSI.reset} ${ANSI.yellow}${entry.latencyMs}ms${ANSI.reset}`
  );
  console.log(
    `   ${ANSI.gray}Modèle      :${ANSI.reset} ${ANSI.bold}${entry.model}${ANSI.reset} ${ANSI.gray}(Provider: ${entry.provider})${ANSI.reset}`
  );
  console.log(
    `   ${ANSI.gray}Agent Meta  :${ANSI.reset} X-Title="${entry.agentTitle || 'non-spécifié'}" | Referer="${entry.httpReferer || 'direct'}"`
  );
  console.log(
    `   ${ANSI.gray}Messages (${entry.messageCount}):${ANSI.reset} "${entry.promptPreview}"`
  );
  console.log(
    `   ${ANSI.gray}Tokens Est. :${ANSI.reset} prompt=${entry.promptTokens} | completion=${entry.completionTokens} | total=${entry.totalTokens}`
  );
  console.log(`${border}`);
}

/**
 * Retourne l'historique des requêtes inspectées.
 */
export function getInspectionLogs(): AgentInspectionLog[] {
  return inspectionBuffer;
}

/**
 * Vide l'historique du Console Inspector.
 */
export function clearInspectionLogs(): void {
  inspectionBuffer.length = 0;
}

/**
 * Pré-remplit quelques logs initiaux réalistes au démarrage pour que l'inspecteur
 * affiche immédiatement des exemples concrets d'appels d'agents.
 */
export function seedInitialLogs(): void {
  if (inspectionBuffer.length > 0) return;

  const now = Date.now();
  const seeds: AgentInspectionLog[] = [
    {
      id: 'req_or_seed_03',
      timestamp: new Date(now - 14000).toISOString(),
      method: 'POST',
      path: '/v1/chat/completions',
      model: 'anthropic/claude-3.7-sonnet',
      provider: 'Anthropic',
      stream: true,
      statusCode: 200,
      latencyMs: 185,
      chaosTriggered: false,
      agentTitle: 'CustomerSupportSupervisor',
      httpReferer: 'https://agents.internal.corp',
      promptPreview: 'Synthétise le rapport d incident #4821 et propose un plan de remédiation en 3 étapes.',
      messageCount: 3,
      promptTokens: 64,
      completionTokens: 98,
      totalTokens: 162,
      requestHeaders: {
        'content-type': 'application/json',
        'authorization': 'Bearer sk-or-v1-••••••••a92f',
        'x-title': 'CustomerSupportSupervisor',
        'http-referer': 'https://agents.internal.corp',
      },
      requestBody: {
        model: 'anthropic/claude-3.7-sonnet',
        stream: true,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'Tu es un ingénieur SRE principal.' },
          { role: 'user', content: 'Synthétise le rapport d incident #4821 et propose un plan de remédiation en 3 étapes.' },
        ],
      },
      responsePreview: '[OpenRouter Mock - anthropic/claude-3.7-sonnet] Analyse déterministe complétée : 1. Isoler le nœud défaillant, 2. Purger la file Redis, 3. Basculer le trafic sur us-east-2.',
    },
    {
      id: 'req_or_seed_02',
      timestamp: new Date(now - 42000).toISOString(),
      method: 'POST',
      path: '/v1/chat/completions',
      model: 'openai/gpt-4o',
      provider: 'OpenAI',
      stream: false,
      statusCode: 429,
      latencyMs: 42,
      chaosTriggered: true,
      chaosReason: 'Rate Limit Exceeded (429) — Retry-After: 5s',
      agentTitle: 'ResearchCrawlerWorker-04',
      httpReferer: 'https://pipeline.ai-lab.dev',
      promptPreview: 'Extrais les entités nommées JSON du document financier Q3.',
      messageCount: 2,
      promptTokens: 48,
      completionTokens: 0,
      totalTokens: 48,
      requestHeaders: {
        'content-type': 'application/json',
        'authorization': 'Bearer sk-or-v1-••••••••a92f',
        'x-title': 'ResearchCrawlerWorker-04',
        'x-mock-status': '429',
        'x-mock-retry-after': '5',
      },
      requestBody: {
        model: 'openai/gpt-4o',
        stream: false,
        messages: [
          { role: 'user', content: 'Extrais les entités nommées JSON du document financier Q3.' },
        ],
      },
      responsePreview: '{"error":{"message":"Rate limit exceeded for model openai/gpt-4o on provider OpenAI. Please retry after 5 seconds.","code":429}}',
    },
    {
      id: 'req_or_seed_01',
      timestamp: new Date(now - 95000).toISOString(),
      method: 'POST',
      path: '/v1/chat/completions',
      model: 'deepseek/deepseek-r1',
      provider: 'Fireworks',
      stream: false,
      statusCode: 503,
      latencyMs: 1520,
      chaosTriggered: true,
      chaosReason: 'Provider Down (503) + Latence 1500ms',
      agentTitle: 'FallbackRouterAgent',
      httpReferer: 'https://router.agent-mesh.io',
      promptPreview: 'Vérifie la cohérence formelle de la transaction multi-signatures.',
      messageCount: 2,
      promptTokens: 52,
      completionTokens: 0,
      totalTokens: 52,
      requestHeaders: {
        'content-type': 'application/json',
        'x-title': 'FallbackRouterAgent',
        'x-mock-status': '503',
        'x-mock-latency': '1500',
        'x-mock-provider': 'Fireworks',
      },
      requestBody: {
        model: 'deepseek/deepseek-r1',
        messages: [
          { role: 'user', content: 'Vérifie la cohérence formelle de la transaction multi-signatures.' },
        ],
      },
      responsePreview: '{"error":{"message":"Provider Fireworks is currently unavailable or overloaded (HTTP 503). Consider configuring model fallbacks in your OpenRouter request.","code":503}}',
    },
  ];

  inspectionBuffer.push(...seeds);
}
