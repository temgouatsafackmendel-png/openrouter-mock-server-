/**
 * @author Mendel Temgoua <mendeltemgouabusiness@gmail.com>
 * @license MIT
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Play,
  RefreshCw,
  Trash2,
  RotateCcw,
  Sun,
  Moon,
  Sparkles,
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Send,
  Copy,
  Check,
  Columns2,
  Search,
  Square,
  ArrowLeftRight,
  Download,
  Plus,
} from 'lucide-react';

interface ActivityEntry {
  id: string;
  timestamp: string;
  model: string;
  provider: string;
  stream: boolean;
  statusCode: number;
  latencyMs: number;
  promptPreview: string;
  responsePreview: string;
}

interface GlobalChaosConfig {
  enabled: boolean;
  defaultLatencyMs: number;
  forcedStatusCode: 0 | 429 | 502 | 503 | 500 | 401;
  failureProbability: number;
  retryAfterSeconds: number;
  streamChunkDelayMs: number;
}

interface FailoverStep {
  step: number;
  modelLabel: string;
  state: 'warning' | 'error' | 'success';
  title: string;
  detail: string;
  durationMs: number;
}

interface ComparisonSlotResult {
  modelId: string;
  text: string;
  durationMs: number | null;
  isPending: boolean;
}

interface ConversationTurn {
  id: string;
  prompt: string;
  modelId: string;
  modelLabel: string;
  provider: string;
  status: 'success' | 'warning' | 'error';
  answer: string;
  notice?: string;
  durationMs: number | null;
  timestamp: string;
}

type ActiveView = 'simulator' | 'compare' | 'resilience' | 'activity';
type SimulationBehavior = 'nominal' | 'rate_limit' | 'provider_down' | 'slow_network';
type ResponseStyle = 'default' | 'reasoning' | 'code';
type ActivityFilter = 'all' | 'ok' | 'incident';

const MODEL_OPTIONS = [
  {
    id: 'anthropic/claude-3.7-sonnet',
    label: 'Claude 3.7 Sonnet',
    provider: 'Anthropic',
    fallbackId: 'openai/gpt-4o',
  },
  {
    id: 'openai/gpt-4o',
    label: 'GPT-4o',
    provider: 'OpenAI',
    fallbackId: 'anthropic/claude-3.7-sonnet',
  },
  {
    id: 'deepseek/deepseek-r1',
    label: 'DeepSeek R1',
    provider: 'Fireworks',
    fallbackId: 'anthropic/claude-3.7-sonnet',
  },
  {
    id: 'mistralai/mistral-large-2411',
    label: 'Mistral Large',
    provider: 'Mistral',
    fallbackId: 'openai/gpt-4o',
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    label: 'Llama 3.3 70B',
    provider: 'Together AI',
    fallbackId: 'openai/gpt-4o',
  },
];

const QUICK_PROMPTS = [
  {
    label: 'Synthèse stratégique',
    text: 'Propose une synthèse en trois axes pour renforcer la continuité de service de notre plateforme.',
  },
  {
    label: 'Plan de remédiation',
    text: 'Quelles sont les étapes prioritaires pour isoler un ralentissement sur une passerelle de paiement ?',
  },
  {
    label: 'Analyse logique',
    text: 'Vérifie la cohérence de notre stratégie de basculement automatique entre deux régions.',
  },
];

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('simulator');
  const [isDark, setIsDark] = useState<boolean>(true);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  // Simulator state
  const [selectedModel, setSelectedModel] = useState<string>(MODEL_OPTIONS[0].id);
  const [behavior, setBehavior] = useState<SimulationBehavior>('nominal');
  const [responseStyle, setResponseStyle] = useState<ResponseStyle>('default');
  const [customDelayMs, setCustomDelayMs] = useState<number>(80);
  const [promptText, setPromptText] = useState<string>(QUICK_PROMPTS[0].text);

  // Conversation Thread & Active Streaming state
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [streamingAnswer, setStreamingAnswer] = useState<string>('');
  const [streamingPrompt, setStreamingPrompt] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Dual-Model Compare state
  const [modelLeft, setModelLeft] = useState<string>(MODEL_OPTIONS[0].id);
  const [modelRight, setModelRight] = useState<string>(MODEL_OPTIONS[1].id);
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [leftResult, setLeftResult] = useState<ComparisonSlotResult>({
    modelId: MODEL_OPTIONS[0].id,
    text: '',
    durationMs: null,
    isPending: false,
  });
  const [rightResult, setRightResult] = useState<ComparisonSlotResult>({
    modelId: MODEL_OPTIONS[1].id,
    text: '',
    durationMs: null,
    isPending: false,
  });

  // Resilience scenario state
  const [isRunningScenario, setIsRunningScenario] = useState<boolean>(false);
  const [failoverSteps, setFailoverSteps] = useState<FailoverStep[]>([]);
  const [globalConfig, setGlobalConfig] = useState<GlobalChaosConfig>({
    enabled: false,
    defaultLatencyMs: 0,
    forcedStatusCode: 0,
    failureProbability: 0,
    retryAfterSeconds: 5,
    streamChunkDelayMs: 28,
  });

  // Activity history state
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [activitySearch, setActivitySearch] = useState<string>('');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');

  const abortControllerRef = useRef<AbortController | null>(null);

  const loadActivities = useCallback(async () => {
    try {
      const res = await fetch('/api/inspector/logs');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.logs)) {
        setActivities(data.logs);
      }
      if (data.chaosConfig) {
        setGlobalConfig(data.chaosConfig);
      }
    } catch {
      // Ignore transient fetch issues
    }
  }, []);

  useEffect(() => {
    loadActivities();
  }, [loadActivities]);

  const formatCleanAnswer = (raw: string): string => {
    if (!raw) return '';
    return raw
      .replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
      .replace(/^\[OpenRouter Mock[^\]]*\]\s*/i, '')
      .trim();
  };

  const getModelInfo = (modelId: string) => {
    return (
      MODEL_OPTIONS.find((m) => m.id === modelId) || {
        id: modelId,
        label: modelId,
        provider: 'OpenRouter',
        fallbackId: MODEL_OPTIONS[1].id,
      }
    );
  };

  const handleCopyText = (id: string, text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const stopSimulation = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsRunning(false);
  };

  const runSimulation = async (options?: {
    overrideBehavior?: SimulationBehavior;
    overridePrompt?: string;
    overrideModel?: string;
  }) => {
    const activeBehavior = options?.overrideBehavior ?? behavior;
    const activePrompt = (options?.overridePrompt ?? promptText).trim();
    const activeModel = options?.overrideModel ?? selectedModel;
    if (!activePrompt) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const modelMeta = getModelInfo(activeModel);
    setIsRunning(true);
    setStreamingPrompt(activePrompt);
    setStreamingAnswer('');

    const startTime = performance.now();

    const statusHeader =
      activeBehavior === 'rate_limit'
        ? '429'
        : activeBehavior === 'provider_down'
          ? '503'
          : '200';

    const latencyHeader =
      activeBehavior === 'slow_network' ? 1800 : customDelayMs;

    try {
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-status': statusHeader,
          'x-mock-latency': String(latencyHeader),
          'x-mock-chunk-delay': '20',
          'x-mock-scenario': responseStyle,
        },
        body: JSON.stringify({
          model: activeModel,
          stream: statusHeader === '200',
          messages: [{ role: 'user', content: activePrompt }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const elapsed = Math.round(performance.now() - startTime);
        const isRateLimit = response.status === 429;
        const turn: ConversationTurn = {
          id: `turn-${Date.now()}`,
          prompt: activePrompt,
          modelId: activeModel,
          modelLabel: modelMeta.label,
          provider: modelMeta.provider,
          status: isRateLimit ? 'warning' : 'error',
          answer: '',
          notice: isRateLimit
            ? 'Surcharge temporaire simulée sur ce modèle. Vous pouvez relancer immédiatement sur un modèle de secours.'
            : 'Indisponibilité simulée du fournisseur principal. Basculez en un clic sur le modèle de secours pour poursuivre.',
          durationMs: elapsed,
          timestamp: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        };
        setConversation((prev) => [turn, ...prev]);
      } else if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assembled = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                assembled += delta;
                setStreamingAnswer(formatCleanAnswer(assembled));
              }
            } catch {
              // Ignore partial chunk
            }
          }
        }

        const elapsed = Math.round(performance.now() - startTime);
        const finalClean = formatCleanAnswer(assembled);
        const turn: ConversationTurn = {
          id: `turn-${Date.now()}`,
          prompt: activePrompt,
          modelId: activeModel,
          modelLabel: modelMeta.label,
          provider: modelMeta.provider,
          status: 'success',
          answer: finalClean,
          durationMs: elapsed,
          timestamp: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        };
        setConversation((prev) => [turn, ...prev]);
        setStreamingAnswer('');
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        const turn: ConversationTurn = {
          id: `turn-${Date.now()}`,
          prompt: activePrompt,
          modelId: activeModel,
          modelLabel: modelMeta.label,
          provider: modelMeta.provider,
          status: 'error',
          answer: '',
          notice: 'La simulation a été interrompue.',
          durationMs: Math.round(performance.now() - startTime),
          timestamp: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        };
        setConversation((prev) => [turn, ...prev]);
      }
    } finally {
      setIsRunning(false);
      loadActivities();
    }
  };

  const handleKeyDownPrompt = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isRunning) {
        runSimulation();
      }
    }
  };

  // Exécute une comparaison côte à côte de deux modèles en simultané
  const runSideBySideComparison = async () => {
    const activePrompt = promptText.trim();
    if (!activePrompt) return;

    setIsComparing(true);
    setLeftResult({
      modelId: modelLeft,
      text: '',
      durationMs: null,
      isPending: true,
    });
    setRightResult({
      modelId: modelRight,
      text: '',
      durationMs: null,
      isPending: true,
    });

    const executeOne = async (
      modelId: string,
      latency: number,
      setter: React.Dispatch<React.SetStateAction<ComparisonSlotResult>>
    ) => {
      const start = performance.now();
      try {
        const res = await fetch('/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-mock-status': '200',
            'x-mock-latency': String(latency),
            'x-mock-scenario': responseStyle,
          },
          body: JSON.stringify({
            model: modelId,
            stream: false,
            messages: [{ role: 'user', content: activePrompt }],
          }),
        });
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '';
        setter({
          modelId,
          text: formatCleanAnswer(content),
          durationMs: Math.round(performance.now() - start),
          isPending: false,
        });
      } catch {
        setter({
          modelId,
          text: 'Impossible de récupérer la réponse pour ce modèle.',
          durationMs: Math.round(performance.now() - start),
          isPending: false,
        });
      }
    };

    await Promise.all([
      executeOne(modelLeft, 75, setLeftResult),
      executeOne(modelRight, 115, setRightResult),
    ]);

    setIsComparing(false);
    loadActivities();
  };

  const swapComparisonModels = () => {
    setModelLeft(modelRight);
    setModelRight(modelLeft);
    setLeftResult(rightResult);
    setRightResult(leftResult);
  };

  // Exécute un scénario visuel complet de continuité
  const runAutomaticContinuityScenario = async () => {
    setIsRunningScenario(true);
    setFailoverSteps([]);

    const stepsPlan: Array<{
      step: number;
      modelId: string;
      modelLabel: string;
      statusHeader: string;
      latency: number;
      state: FailoverStep['state'];
      title: string;
      detail: string;
    }> = [
      {
        step: 1,
        modelId: 'anthropic/claude-3.7-sonnet',
        modelLabel: 'Claude 3.7 Sonnet',
        statusHeader: '429',
        latency: 90,
        state: 'warning',
        title: 'Saturation détectée sur le modèle principal',
        detail: 'Pause automatique de sécurité appliquée avant nouvelle tentative.',
      },
      {
        step: 2,
        modelId: 'anthropic/claude-3.7-sonnet',
        modelLabel: 'Claude 3.7 Sonnet',
        statusHeader: '503',
        latency: 140,
        state: 'error',
        title: 'Fournisseur principal indisponible',
        detail: 'Activation immédiate de la règle de basculement vers le modèle de secours.',
      },
      {
        step: 3,
        modelId: 'openai/gpt-4o',
        modelLabel: 'GPT-4o (Secours)',
        statusHeader: '200',
        latency: 110,
        state: 'success',
        title: 'Continuité assurée par le modèle de secours',
        detail: 'Réponse générée et validée sans interruption pour l’utilisateur final.',
      },
    ];

    const collected: FailoverStep[] = [];

    for (const item of stepsPlan) {
      const start = performance.now();
      await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-status': item.statusHeader,
          'x-mock-latency': String(item.latency),
        },
        body: JSON.stringify({
          model: item.modelId,
          stream: false,
          messages: [{ role: 'user', content: promptText }],
        }),
      });
      const durationMs = Math.round(performance.now() - start);
      collected.push({
        step: item.step,
        modelLabel: item.modelLabel,
        state: item.state,
        title: item.title,
        detail: item.detail,
        durationMs,
      });
      setFailoverSteps([...collected]);
      await new Promise((r) => setTimeout(r, 360));
    }

    setIsRunningScenario(false);
    loadActivities();
  };

  const updateGlobalSetting = async (patch: Partial<GlobalChaosConfig>) => {
    const next = { ...globalConfig, ...patch };
    setGlobalConfig(next);
    try {
      const res = await fetch('/api/chaos-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (res.ok) {
        setGlobalConfig(await res.json());
      }
    } catch {
      // Ignore
    }
  };

  const handleClearActivity = async () => {
    await fetch('/api/inspector/logs', { method: 'DELETE' });
    setActivities([]);
  };

  const handleDownloadSummaryReport = () => {
    const lines = [
      'RAPPORT DE SYNTHÈSE — OPENROUTER STUDIO (Mendel Temgoua)',
      `Date : ${new Date().toLocaleString()}`,
      `Simulations totales : ${activities.length}`,
      '------------------------------------------------------------',
      ...activities.map((a, idx) => {
        const stateLabel =
          a.statusCode >= 200 && a.statusCode < 300
            ? 'Réponse validée'
            : a.statusCode === 429
              ? 'Surcharge simulée'
              : 'Basculement requis';
        return `${idx + 1}. [${getModelInfo(a.model).label}] ${stateLabel} (${a.latencyMs} ms) — "${a.promptPreview}"`;
      }),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'rapport-simulations-ia.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const filteredActivities = useMemo(() => {
    return activities.filter((a) => {
      const isOk = a.statusCode >= 200 && a.statusCode < 300;
      if (activityFilter === 'ok' && !isOk) return false;
      if (activityFilter === 'incident' && isOk) return false;
      if (activitySearch.trim()) {
        const q = activitySearch.toLowerCase();
        return (
          getModelInfo(a.model).label.toLowerCase().includes(q) ||
          a.promptPreview.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [activities, activityFilter, activitySearch]);

  const activitySummary = useMemo(() => {
    const total = activities.length;
    const completed = activities.filter((a) => a.statusCode >= 200 && a.statusCode < 300).length;
    const avgMs =
      total > 0
        ? Math.round(activities.reduce((acc, a) => acc + a.latencyMs, 0) / total)
        : 0;
    return { total, completed, avgMs };
  }, [activities]);

  const totalScenarioDurationMs = useMemo(() => {
    return failoverSteps.reduce((acc, s) => acc + s.durationMs, 0);
  }, [failoverSteps]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#090D16] text-slate-900 dark:text-slate-100 flex flex-col transition-colors duration-150">
      {/* Top Bar Contract: Zone 1 (Brand) — Zone 2 (4 Clean Nav Links) — Zone 3 (1 Primary Action) */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-[#090D16]/90 sticky top-0 z-30 backdrop-blur-md">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('simulator');
          }}
          className="text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 font-display"
        >
          OpenRouter Studio
        </a>

        <nav className="flex items-center gap-7 text-sm font-medium text-slate-500 dark:text-slate-400 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveView('simulator')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeView === 'simulator'
                ? 'text-slate-900 dark:text-white border-blue-600 dark:border-blue-500 font-semibold'
                : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Simulateur
          </button>
          <button
            type="button"
            onClick={() => setActiveView('compare')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeView === 'compare'
                ? 'text-slate-900 dark:text-white border-blue-600 dark:border-blue-500 font-semibold'
                : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Comparateur
          </button>
          <button
            type="button"
            onClick={() => setActiveView('resilience')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeView === 'resilience'
                ? 'text-slate-900 dark:text-white border-blue-600 dark:border-blue-500 font-semibold'
                : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Résilience
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveView('activity');
              loadActivities();
            }}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeView === 'activity'
                ? 'text-slate-900 dark:text-white border-blue-600 dark:border-blue-500 font-semibold'
                : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Activité ({activities.length})
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveView('simulator');
              runSimulation();
            }}
            disabled={isRunning}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Lancer la simulation</span>
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-[1140px] mx-auto px-6 py-10 space-y-10">
        {/* Clean Minimal Hero Header */}
        <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-8 border-b border-slate-200/80 dark:border-slate-800/80">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>Version 1.2</span>
              <span aria-hidden="true">·</span>
              <span>Expérience interactive fluide</span>
              <span aria-hidden="true">·</span>
              <span>Réalisé par Mendel Temgoua</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white font-display">
              Simulez, comparez et éprouvez vos modèles IA en toute fluidité
            </h1>
          </div>

          <button
            type="button"
            onClick={() => setIsDark((prev) => !prev)}
            className="self-start sm:self-auto px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F1523] text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            {isDark ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>Mode clair</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-slate-700" />
                <span>Mode sombre</span>
              </>
            )}
          </button>
        </section>

        {/* ===================================================================
            VIEW 1: CLEAN INTERACTIVE SIMULATOR WITH CONTINUOUS THREAD UX
        =================================================================== */}
        {activeView === 'simulator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Simple Configuration Controls */}
            <div className="lg:col-span-5 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0F1523] p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Paramètres de simulation
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setBehavior('nominal');
                    setResponseStyle('default');
                    setCustomDelayMs(80);
                    setSelectedModel(MODEL_OPTIONS[0].id);
                  }}
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Réinitialiser</span>
                </button>
              </div>

              {/* Model Selection */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Modèle d’intelligence artificielle
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {MODEL_OPTIONS.map((m) => {
                    const active = selectedModel === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSelectedModel(m.id)}
                        className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                          active
                            ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/30 text-slate-900 dark:text-white'
                            : 'border-slate-200 dark:border-slate-800/90 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <span className="text-xs font-semibold">{m.label}</span>
                        <span className="text-xs text-slate-400">{m.provider}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Response Style Selection */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Ton et structure de réponse
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'default', label: 'Synthèse' },
                      { id: 'reasoning', label: 'Structuré' },
                      { id: 'code', label: 'Exemple' },
                    ] as const
                  ).map((st) => {
                    const active = responseStyle === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => setResponseStyle(st.id)}
                        className={`px-3 py-2 rounded-xl border text-xs font-medium transition-colors text-center cursor-pointer whitespace-nowrap ${
                          active
                            ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 font-semibold'
                            : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                        }`}
                      >
                        {st.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Scenario Behavior Selection */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Condition de test
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: 'nominal', label: 'Réponse fluide' },
                      { id: 'rate_limit', label: 'Surcharge (Quota)' },
                      { id: 'provider_down', label: 'Panne fournisseur' },
                      { id: 'slow_network', label: 'Réseau ralenti' },
                    ] as const
                  ).map((item) => {
                    const active = behavior === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setBehavior(item.id)}
                        className={`px-3 py-2.5 rounded-xl border text-xs font-medium transition-colors text-left cursor-pointer ${
                          active
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Response Speed Slider */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">
                    Délai de réponse simulé
                  </span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-200">
                    {behavior === 'slow_network' ? 1800 : customDelayMs} ms
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={2500}
                  step={50}
                  value={behavior === 'slow_network' ? 1800 : customDelayMs}
                  onChange={(e) => {
                    setBehavior('nominal');
                    setCustomDelayMs(Number(e.target.value));
                  }}
                  className="w-full accent-blue-600"
                />
              </div>
            </div>

            {/* Right Column: Interactive Conversation Thread & Composer */}
            <div className="lg:col-span-7 space-y-6">
              {/* Prompt Composer Card */}
              <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0F1523] p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Votre demande
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {QUICK_PROMPTS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setPromptText(preset.text);
                          runSimulation({
                            overrideBehavior: behavior,
                            overridePrompt: preset.text,
                          });
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  rows={3}
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  onKeyDown={handleKeyDownPrompt}
                  placeholder="Saisissez votre message (Entrée pour envoyer)..."
                  className="w-full rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 resize-none leading-relaxed"
                />

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Modèle actif :{' '}
                    <strong className="font-medium text-slate-800 dark:text-slate-200">
                      {getModelInfo(selectedModel).label}
                    </strong>
                    <span className="hidden sm:inline text-slate-400">
                      {' '}· Appuyez sur Entrée pour envoyer
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {isRunning ? (
                      <button
                        type="button"
                        onClick={stopSimulation}
                        className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                      >
                        <Square className="w-3.5 h-3.5" />
                        <span>Arrêter</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => runSimulation()}
                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Envoyer</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Conversation Thread Output */}
              <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0F1523] p-6 space-y-5 min-h-[280px] flex flex-col justify-between">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <Sparkles className="w-4 h-4 text-blue-500" />
                    <span>Fil de réponses ({conversation.length})</span>
                  </div>

                  {conversation.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setConversation([])}
                      className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Nouvelle session</span>
                    </button>
                  )}
                </div>

                <div className="space-y-4 flex-1 flex flex-col justify-center">
                  {/* Live streaming turn preview */}
                  {isRunning && (
                    <div className="p-4 rounded-xl border border-blue-500/40 bg-blue-50/30 dark:bg-blue-950/20 space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>{getModelInfo(selectedModel).label} rédige une réponse...</span>
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        « {streamingPrompt} »
                      </p>
                      {streamingAnswer && (
                        <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/70 text-sm text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                          {streamingAnswer}
                        </div>
                      )}
                    </div>
                  )}

                  {!isRunning && conversation.length === 0 && (
                    <div className="text-center py-10 space-y-2">
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Envoyez une demande ou choisissez un exemple ci-dessus pour démarrer la session.
                      </p>
                    </div>
                  )}

                  {conversation.map((turn) => {
                    const fallbackModel = getModelInfo(turn.modelId);
                    const nextModelInfo = getModelInfo(fallbackModel.fallbackId);

                    return (
                      <div
                        key={turn.id}
                        className="p-5 rounded-xl border border-slate-200/90 dark:border-slate-800/90 bg-slate-50/60 dark:bg-slate-950/50 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900 dark:text-white">
                              {turn.modelLabel}
                            </span>
                            <span aria-hidden="true" className="text-slate-400">
                              ·
                            </span>
                            <span className="text-slate-500 dark:text-slate-400">
                              {turn.provider}
                            </span>
                            <span aria-hidden="true" className="text-slate-400">
                              ·
                            </span>
                            <span className="text-slate-400 tabular-nums">
                              {turn.timestamp}
                            </span>
                          </div>

                          <div className="flex items-center gap-3">
                            {turn.durationMs !== null && (
                              <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400 tabular-nums">
                                <Clock className="w-3.5 h-3.5" />
                                <span>{turn.durationMs} ms</span>
                              </span>
                            )}
                            {turn.answer && (
                              <button
                                type="button"
                                onClick={() => handleCopyText(turn.id, turn.answer)}
                                className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 cursor-pointer"
                              >
                                {copiedId === turn.id ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-500" />
                                    <span>Copié</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Copier</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Demande : « {turn.prompt} »
                        </div>

                        {turn.status === 'success' ? (
                          <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/70 text-sm text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                            {turn.answer}
                          </div>
                        ) : (
                          <div
                            className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                              turn.status === 'warning'
                                ? 'bg-amber-50/70 dark:bg-amber-950/25 border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200'
                                : 'bg-rose-50/70 dark:bg-rose-950/25 border-rose-200 dark:border-rose-800/60 text-rose-900 dark:text-rose-200'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                              <div className="space-y-1 text-xs leading-relaxed">
                                <div className="font-semibold">
                                  {turn.status === 'warning'
                                    ? 'Surcharge détectée sur ce modèle'
                                    : 'Fournisseur principal indisponible'}
                                </div>
                                <p>{turn.notice}</p>
                              </div>
                            </div>

                            {/* One-click instant failover recovery button */}
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedModel(nextModelInfo.id);
                                setBehavior('nominal');
                                runSimulation({
                                  overrideBehavior: 'nominal',
                                  overrideModel: nextModelInfo.id,
                                  overridePrompt: turn.prompt,
                                });
                              }}
                              className="px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 transition-opacity shrink-0 self-start sm:self-center cursor-pointer whitespace-nowrap"
                            >
                              Basculer sur {nextModelInfo.label}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                  <span>Session interactive</span>
                  <button
                    type="button"
                    onClick={() => setActiveView('compare')}
                    className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <span>Comparer deux modèles côte à côte</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 2: ENHANCED DUAL-MODEL COMPARATOR
        =================================================================== */}
        {activeView === 'compare' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0F1523] p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400">
                    <Columns2 className="w-4 h-4" />
                    <span>Comparateur simultané</span>
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
                    Évaluez deux modèles côte à côte sur la même demande
                  </h2>
                </div>

                <div className="flex items-center gap-2 self-start">
                  <button
                    type="button"
                    onClick={swapComparisonModels}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer"
                    title="Inverser les deux modèles"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    <span>Inverser</span>
                  </button>

                  <button
                    type="button"
                    onClick={runSideBySideComparison}
                    disabled={isComparing}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    {isComparing ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Comparaison...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        <span>Comparer les deux modèles</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                    Premier modèle
                  </label>
                  <select
                    value={modelLeft}
                    onChange={(e) => setModelLeft(e.target.value)}
                    className="w-full rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} ({m.provider})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                    Second modèle
                  </label>
                  <select
                    value={modelRight}
                    onChange={(e) => setModelRight(e.target.value)}
                    className="w-full rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} ({m.provider})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <textarea
                rows={2}
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-3.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
              {[
                { slot: leftResult, selectedId: modelLeft, otherDuration: rightResult.durationMs },
                { slot: rightResult, selectedId: modelRight, otherDuration: leftResult.durationMs },
              ].map(({ slot, selectedId, otherDuration }, idx) => {
                const isFaster =
                  slot.durationMs !== null &&
                  otherDuration !== null &&
                  slot.durationMs <= otherDuration;
                const modelMeta = getModelInfo(selectedId);

                return (
                  <div
                    key={idx}
                    className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0F1523] p-6 flex flex-col justify-between min-h-[250px] space-y-4"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">
                          {modelMeta.label}
                        </span>
                        <span className="text-xs text-slate-400">
                          · {modelMeta.provider}
                        </span>
                      </div>

                      {slot.durationMs !== null && (
                        <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                          {isFaster && (
                            <span className="text-emerald-600 dark:text-emerald-400 font-sans font-medium">
                              Plus rapide ·
                            </span>
                          )}
                          <span className="text-slate-600 dark:text-slate-300">
                            {slot.durationMs} ms
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 flex flex-col justify-center py-2">
                      {slot.isPending ? (
                        <div className="flex items-center justify-center gap-2 text-xs text-slate-500 py-8">
                          <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                          <span>Génération en cours...</span>
                        </div>
                      ) : slot.text ? (
                        <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                          {slot.text}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-400 text-center py-8">
                          Cliquez sur « Comparer les deux modèles » pour afficher le résultat.
                        </p>
                      )}
                    </div>

                    {slot.text && (
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => handleCopyText(`cmp-${idx}`, slot.text)}
                          className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5 cursor-pointer"
                        >
                          {copiedId === `cmp-${idx}` ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                              <span>Copié</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copier</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedModel(selectedId);
                            setActiveView('simulator');
                          }}
                          className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <span>Poursuivre avec {modelMeta.label}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 3: CLEAN RESILIENCE SCENARIOS WITH PROGRESS BAR
        =================================================================== */}
        {activeView === 'resilience' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-7 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0F1523] p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Continuité de service</span>
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
                    Test de basculement automatique multi-modèles
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Vérifie que l’application passe automatiquement sur un modèle de secours en cas d’aléa.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={runAutomaticContinuityScenario}
                  disabled={isRunningScenario}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 shrink-0 self-start cursor-pointer"
                >
                  {isRunningScenario ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Test en cours...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      <span>Démarrer le scénario</span>
                    </>
                  )}
                </button>
              </div>

              {/* Visual Progress Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Progression du scénario de reprise</span>
                  <span className="font-mono tabular-nums">
                    {failoverSteps.length} / 3 étapes
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-900 overflow-hidden">
                  <div
                    style={{ width: `${(failoverSteps.length / 3) * 100}%` }}
                    className="h-full bg-blue-600 transition-all duration-300"
                  />
                </div>
              </div>

              {failoverSteps.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Cliquez sur <strong>Démarrer le scénario</strong> pour observer les 3 étapes de reprise automatique.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {failoverSteps.map((s) => (
                    <div
                      key={s.step}
                      className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-start justify-between gap-4"
                    >
                      <div className="flex items-start gap-3">
                        {s.state === 'success' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle
                            className={`w-4 h-4 shrink-0 mt-0.5 ${
                              s.state === 'warning' ? 'text-amber-500' : 'text-rose-500'
                            }`}
                          />
                        )}
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-slate-900 dark:text-white">
                            Étape {s.step} — {s.title}
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {s.detail}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          {s.modelLabel}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-400">
                          {s.durationMs} ms
                        </div>
                      </div>
                    </div>
                  ))}

                  {failoverSteps.length === 3 && (
                    <div className="p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between text-xs text-emerald-900 dark:text-emerald-200">
                      <span className="font-medium">
                        Continuité de service validée avec succès sans perte de demande.
                      </span>
                      <span className="font-mono tabular-nums font-semibold">
                        Total : {totalScenarioDurationMs} ms
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="lg:col-span-5 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0F1523] p-6 space-y-6">
              <div className="space-y-1 border-b border-slate-100 dark:border-slate-800 pb-4">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Comportement global
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Ajustez la sensibilité des tests de résilience.
                </p>
              </div>

              <div className="space-y-5">
                <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      Simulation d’aléas automatique
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Teste la résistance aux imprévus
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateGlobalSetting({ enabled: !globalConfig.enabled })
                    }
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      globalConfig.enabled
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {globalConfig.enabled ? 'Activé' : 'Désactivé'}
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-400 font-medium">
                      Fréquence d’aléas simulés
                    </span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-white">
                      {Math.round(globalConfig.failureProbability * 100)} %
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={globalConfig.failureProbability}
                    onChange={(e) =>
                      updateGlobalSetting({
                        enabled: true,
                        failureProbability: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-blue-600"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-400 font-medium">
                      Temps d’attente additionnel
                    </span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-white">
                      {globalConfig.defaultLatencyMs} ms
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={3000}
                    step={100}
                    value={globalConfig.defaultLatencyMs}
                    onChange={(e) =>
                      updateGlobalSetting({
                        enabled: true,
                        defaultLatencyMs: Number(e.target.value),
                      })
                    }
                    className="w-full accent-blue-600"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 4: CLEAN ACTIVITY HISTORY WITH FILTERS & REPORT DOWNLOAD
        =================================================================== */}
        {activeView === 'activity' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0F1523] p-5">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Simulations effectuées
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-1">
                  {activitySummary.total}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0F1523] p-5">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Réponses validées
                </div>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums mt-1">
                  {activitySummary.completed}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0F1523] p-5">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Temps de réponse moyen
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-1">
                  {activitySummary.avgMs} ms
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#0F1523] border border-slate-200 dark:border-slate-800 rounded-xl">
                  {(
                    [
                      { id: 'all', label: 'Tout' },
                      { id: 'ok', label: 'Réponses validées' },
                      { id: 'incident', label: 'Aléas simulés' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setActivityFilter(f.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                        activityFilter === f.id
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Filtrer par modèle ou demande..."
                    value={activitySearch}
                    onChange={(e) => setActivitySearch(e.target.value)}
                    className="pl-9 pr-4 py-2 text-xs rounded-xl bg-white dark:bg-[#0F1523] border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-200 focus:outline-none focus:border-blue-500 w-64"
                  />
                </div>
              </div>

              {activities.length > 0 && (
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={handleDownloadSummaryReport}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-[#0F1523] border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Télécharger le bilan</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleClearActivity}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Effacer</span>
                  </button>
                </div>
              )}
            </div>

            {filteredActivities.length === 0 ? (
              <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0F1523] p-12 text-center space-y-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Aucune simulation ne correspond à votre sélection.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setActivityFilter('all');
                    setActivitySearch('');
                    setActiveView('simulator');
                    runSimulation();
                  }}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors cursor-pointer"
                >
                  Lancer un essai
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0F1523] divide-y divide-slate-100 dark:divide-slate-800/80 overflow-hidden">
                {filteredActivities.slice(0, 15).map((item) => {
                  const isOk = item.statusCode >= 200 && item.statusCode < 300;
                  const isWarning = item.statusCode === 429;
                  return (
                    <div
                      key={item.id}
                      className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70 dark:hover:bg-slate-900/40 transition-colors"
                    >
                      <div className="space-y-1 max-w-2xl">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {getModelInfo(item.model).label}
                          </span>
                          <span aria-hidden="true" className="text-slate-400">
                            ·
                          </span>
                          <span
                            className={
                              isOk
                                ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                                : isWarning
                                  ? 'text-amber-600 dark:text-amber-400 font-medium'
                                  : 'text-rose-600 dark:text-rose-400 font-medium'
                            }
                          >
                            {isOk
                              ? 'Réponse complétée'
                              : isWarning
                                ? 'Surcharge simulée'
                                : 'Basculement requis'}
                          </span>
                          <span aria-hidden="true" className="text-slate-400">
                            ·
                          </span>
                          <span className="text-slate-400 tabular-nums">
                            {item.latencyMs} ms
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-1">
                          {item.promptPreview}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedModel(item.model);
                          setPromptText(item.promptPreview);
                          setActiveView('simulator');
                          runSimulation({
                            overrideBehavior: 'nominal',
                            overridePrompt: item.promptPreview,
                            overrideModel: item.model,
                          });
                        }}
                        className="self-start sm:self-center px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shrink-0 cursor-pointer"
                      >
                        Relancer
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Clean Minimal Footer */}
      <footer className="border-t border-slate-200/80 dark:border-slate-800/80 py-6 px-6 text-xs text-slate-500 mt-auto">
        <div className="max-w-[1140px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            OpenRouter Studio v1.2 · Conçu et réalisé par Mendel Temgoua
          </div>
          <div>Licence MIT</div>
        </div>
      </footer>
    </div>
  );
}
