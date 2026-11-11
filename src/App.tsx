/**
 * @author Mendel Temgoua <mendeltemgouabusiness@gmail.com>
 * @license MIT
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
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

type ActiveView = 'simulator' | 'resilience' | 'activity';
type SimulationBehavior = 'nominal' | 'rate_limit' | 'provider_down' | 'slow_network';

const MODEL_OPTIONS = [
  {
    id: 'anthropic/claude-3.7-sonnet',
    label: 'Claude 3.7 Sonnet',
    provider: 'Anthropic',
  },
  {
    id: 'openai/gpt-4o',
    label: 'GPT-4o',
    provider: 'OpenAI',
  },
  {
    id: 'deepseek/deepseek-r1',
    label: 'DeepSeek R1',
    provider: 'Fireworks',
  },
  {
    id: 'mistralai/mistral-large-2411',
    label: 'Mistral Large',
    provider: 'Mistral',
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    label: 'Llama 3.3 70B',
    provider: 'Together AI',
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
  const [customDelayMs, setCustomDelayMs] = useState<number>(80);
  const [promptText, setPromptText] = useState<string>(QUICK_PROMPTS[0].text);

  // Response state
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [responseText, setResponseText] = useState<string>('');
  const [responseStatus, setResponseStatus] = useState<'idle' | 'success' | 'warning' | 'error'>('idle');
  const [responseNotice, setResponseNotice] = useState<string>('');
  const [responseDurationMs, setResponseDurationMs] = useState<number | null>(null);

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
    // Nettoie les préfixes techniques éventuels pour un affichage fluide et naturel
    return raw.replace(/^\[OpenRouter Mock[^\]]*\]\s*/i, '').trim();
  };

  const getModelLabel = (modelId: string): string => {
    return MODEL_OPTIONS.find((m) => m.id === modelId)?.label || modelId;
  };

  const runSimulation = async (overrideBehavior?: SimulationBehavior, overridePrompt?: string) => {
    const activeBehavior = overrideBehavior ?? behavior;
    const activePrompt = (overridePrompt ?? promptText).trim();
    if (!activePrompt) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsRunning(true);
    setResponseText('');
    setResponseNotice('');
    setResponseStatus('idle');
    setResponseDurationMs(null);

    const startTime = performance.now();

    const statusHeader =
      activeBehavior === 'rate_limit'
        ? '429'
        : activeBehavior === 'provider_down'
          ? '503'
          : '200';

    const latencyHeader =
      activeBehavior === 'slow_network'
        ? 1800
        : customDelayMs;

    try {
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-status': statusHeader,
          'x-mock-latency': String(latencyHeader),
          'x-mock-chunk-delay': '24',
        },
        body: JSON.stringify({
          model: selectedModel,
          stream: statusHeader === '200',
          messages: [{ role: 'user', content: activePrompt }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const elapsed = Math.round(performance.now() - startTime);
        setResponseDurationMs(elapsed);

        if (response.status === 429) {
          setResponseStatus('warning');
          setResponseNotice(
            'Limite de capacité simulée atteinte. Le système recommande une pause automatique avant réessai.'
          );
        } else {
          setResponseStatus('error');
          setResponseNotice(
            'Indisponibilité temporaire du fournisseur simulée. Le basculement vers un modèle de secours peut prendre le relais.'
          );
        }
      } else if (response.body) {
        setResponseStatus('success');
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
                setResponseText(formatCleanAnswer(assembled));
              }
            } catch {
              // Ignore partial chunk
            }
          }
        }
        setResponseDurationMs(Math.round(performance.now() - startTime));
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setResponseStatus('error');
        setResponseNotice('La simulation a été interrompue avant la fin du délai.');
      }
    } finally {
      setIsRunning(false);
      loadActivities();
    }
  };

  // Exécute un scénario visuel complet de continuité (Surcharge -> Indisponibilité -> Secours réussi)
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
      await new Promise((r) => setTimeout(r, 380));
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#090D16] text-slate-900 dark:text-slate-100 flex flex-col transition-colors duration-150">
      {/* Top Bar Contract: Zone 1 (Brand) — Zone 2 (3 Clean Nav Links) — Zone 3 (1 Primary Action) */}
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

        <nav className="flex items-center gap-8 text-sm font-medium text-slate-500 dark:text-slate-400">
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
      <main className="flex-1 w-full max-w-[1120px] mx-auto px-6 py-10 space-y-10">
        {/* Clean Minimal Hero Header */}
        <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-8 border-b border-slate-200/80 dark:border-slate-800/80">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>Simulation IA déterministe</span>
              <span aria-hidden="true">·</span>
              <span>Réalisé par Mendel Temgoua</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white font-display">
              Testez la fiabilité de vos expériences IA en toute simplicité
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
            VIEW 1: CLEAN INTERACTIVE SIMULATOR
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

            {/* Right Column: Clean Conversation & Live Response Area */}
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
                          runSimulation(behavior, preset.text);
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
                  placeholder="Saisissez un message pour tester la réponse du modèle..."
                  className="w-full rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 resize-none leading-relaxed"
                />

                <div className="flex items-center justify-between pt-1">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Modèle actif :{' '}
                    <strong className="font-medium text-slate-800 dark:text-slate-200">
                      {getModelLabel(selectedModel)}
                    </strong>
                  </div>

                  <button
                    type="button"
                    onClick={() => runSimulation()}
                    disabled={isRunning}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    {isRunning ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Génération en cours...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Envoyer</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Clean Response Output Card */}
              <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0F1523] p-6 space-y-4 min-h-[240px] flex flex-col justify-between">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <Sparkles className="w-4 h-4 text-blue-500" />
                    <span>Réponse générée</span>
                  </div>

                  {responseDurationMs !== null && (
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{responseDurationMs} ms</span>
                    </div>
                  )}
                </div>

                <div className="py-2 flex-1 flex flex-col justify-center">
                  {responseStatus === 'idle' && !isRunning && (
                    <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">
                      Lancez une simulation pour visualiser le comportement du modèle en direct.
                    </p>
                  )}

                  {isRunning && !responseText && (
                    <div className="flex items-center justify-center gap-2.5 py-8 text-sm text-slate-500 dark:text-slate-400">
                      <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                      <span>Traitement de la demande...</span>
                    </div>
                  )}

                  {responseStatus === 'success' && responseText && (
                    <div className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                      {responseText}
                    </div>
                  )}

                  {(responseStatus === 'warning' || responseStatus === 'error') && (
                    <div
                      className={`p-4 rounded-xl border flex items-start gap-3 ${
                        responseStatus === 'warning'
                          ? 'bg-amber-50/70 dark:bg-amber-950/25 border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200'
                          : 'bg-rose-50/70 dark:bg-rose-950/25 border-rose-200 dark:border-rose-800/60 text-rose-900 dark:text-rose-200'
                      }`}
                    >
                      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                      <div className="space-y-1 text-xs leading-relaxed">
                        <div className="font-semibold text-sm">
                          {responseStatus === 'warning'
                            ? 'Simulation de surcharge activée'
                            : 'Simulation d’indisponibilité activée'}
                        </div>
                        <p>{responseNotice}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                  <span>{getModelLabel(selectedModel)}</span>
                  <button
                    type="button"
                    onClick={() => setActiveView('resilience')}
                    className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <span>Tester le basculement automatique</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 2: CLEAN RESILIENCE SCENARIOS
        =================================================================== */}
        {activeView === 'resilience' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Automatic Continuity Scenario Card */}
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
                </div>
              )}
            </div>

            {/* Right: Simple Global Simulation Preferences */}
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
            VIEW 3: CLEAN ACTIVITY HISTORY
        =================================================================== */}
        {activeView === 'activity' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Historique des simulations récentes
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Synthèse claire des derniers essais effectués.
                </p>
              </div>

              {activities.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearActivity}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Effacer l’historique</span>
                </button>
              )}
            </div>

            {activities.length === 0 ? (
              <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0F1523] p-12 text-center space-y-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Aucune simulation enregistrée pour le moment.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveView('simulator');
                    runSimulation();
                  }}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors cursor-pointer"
                >
                  Lancer un premier essai
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-[#0F1523] divide-y divide-slate-100 dark:divide-slate-800/80 overflow-hidden">
                {activities.slice(0, 15).map((item) => {
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
                            {getModelLabel(item.model)}
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
                          runSimulation('nominal', item.promptPreview);
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
        <div className="max-w-[1120px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            OpenRouter Studio · Conçu et réalisé par Mendel Temgoua
          </div>
          <div>Licence MIT</div>
        </div>
      </footer>
    </div>
  );
}
