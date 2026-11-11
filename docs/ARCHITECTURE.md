# Architecture Technique — OpenRouter Mock & Test Server

> **Auteur & Architecte Principal** : Conçu et réalisé de bout en bout par **Mendel Temgoua** (`mendeltemgouabusiness@gmail.com`).

![Architecture Overview](../src/assets/images/github_banner_hero_1794405704588.jpg)

Ce document détaille l'architecture interne d'**OpenRouter Mock & Test Server**, le pipeline de décision du **Mode Chaos** et l'implémentation du protocole **Server-Sent Events (SSE)**.

---

## 1. Vue d'Ensemble du Pipeline de Requête

Chaque requête entrante sur `POST /v1/chat/completions` traverse quatre étapes déterministes :

```text
[Client / Agent IA (OpenAI SDK, LangChain, cURL)]
                       │
                       ▼
        ┌──────────────────────────────┐
        │   1. Express & CORS Layer    │  src/server.ts
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │   2. Chaos Evaluation Engine │  src/handlers/chaos.ts
        │   - En-têtes x-mock-*        │
        │   - Politique Chaos Globale  │
        │   - Injection Latence (ms)   │
        └──────────────┬───────────────┘
                       │
            ┌──────────┴──────────┐
            │ shouldFail === true │ shouldFail === false
            ▼                     ▼
┌───────────────────────┐ ┌───────────────────────────────┐
│ 3A. Chaos Error Reply │ │ 3B. Deterministic Generator   │  src/handlers/chat.ts
│ - 429 + Retry-After   │ │ - Mode JSON Synchrone         │
│ - 502 / 503 Provider  │ │ - Mode Streaming SSE (chunks) │
│ - 401 / 500           │ │ - Profils (json, code, think) │
└───────────┬───────────┘ └───────────────┬───────────────┘
            │                             │
            └──────────────┬──────────────┘
                           ▼
        ┌──────────────────────────────┐
        │   4. Console Inspector Log   │  src/logger.ts
        │   - Sortie ANSI colorée      │
        │   - Ring Buffer (100 reqs)   │
        └──────────────────────────────┘
```

---

## 2. Ordre de Priorité du Moteur Chaos (`src/handlers/chaos.ts`)

![Chaos Resilience Matrix](../src/assets/images/preview_chaos_matrix_1794405705825.jpg)

La fonction `evaluateChaosForRequest(req, model)` résout les règles d'injection de pannes selon un ordre de priorité strict afin de garantir la prévisibilité des tests unitaires et d'intégration :

1. **En-tête HTTP explicite (`x-mock-status` ou `x-chaos-error`)** :
   Si l'agent transmet `x-mock-status: 429`, `502`, `503`, `500` ou `401`, ce statut l'emporte toujours sur la configuration globale du serveur.
2. **Probabilité d'échec par requête (`x-mock-fail-rate`) ou globale (`failureProbability`)** :
   Permet de simuler un réseau dégradé (ex: `0.30` pour 30 % d'échecs aléatoires répartis entre `429` et `503`).
3. **Statut forcé dans la Politique Chaos Globale (`forcedStatusCode`)** :
   Pilotable à chaud via `POST /api/chaos-config` ou depuis l'interface Web sans modifier le code de l'agent.
4. **Latence Artificielle (`x-mock-latency` ou `defaultLatencyMs` + `jitterMs`)** :
   Exécutée via une promesse temporisée `sleep(ms)` avant l'envoi du statut HTTP ou du premier chunk SSE.

---

## 3. Protocole de Streaming SSE (`src/handlers/chat.ts`)

![SSE Streaming Telemetry](../src/assets/images/preview_sse_inspector_1794405706059.jpg)

Lorsque le corps de la requête contient `"stream": true` et qu'aucune erreur Chaos n'est déclenchée :

1. Le serveur positionne les en-têtes standards :
   - `Content-Type: text/event-stream; charset=utf-8`
   - `Cache-Control: no-cache, no-transform`
   - `Connection: keep-alive`
   - `X-OpenRouter-Generation-Id: gen-...`
2. **Chunk initial** : Émet `delta: { role: "assistant", content: "" }` avec `finish_reason: null`.
3. **Boucle d'émission lexicale** : Découpe la réponse déterministe en unités lexicales et applique une pause `streamChunkDelayMs` entre chaque événement `data: {...}\n\n`. Si le client ferme la connexion (`req.on('close')`), la boucle s'interrompt proprement pour tester les `AbortController`.
4. **Chunk final & Terminaison** : Émet `finish_reason: "stop"` accompagné de l'objet `usage` complet, suivi du marqueur protocolaire `data: [DONE]\n\n`.
