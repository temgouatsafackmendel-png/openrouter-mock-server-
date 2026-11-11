# OpenRouter Mock & Test Server

![OpenRouter Mock & Test Server — Architecture Banner](./src/assets/images/github_banner_hero_1794405704588.jpg)

[![License: MIT](https://img.shields.io/badge/License-MIT-2563EB.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![OpenRouter API v1](https://img.shields.io/badge/OpenRouter_API-v1%2Fchat%2Fcompletions-10B981.svg)](https://openrouter.ai/docs)
[![Author](https://img.shields.io/badge/Auteur-Mendel_Temgoua-0F172A.svg)](mailto:mendeltemgouabusiness@gmail.com)

Un serveur local léger, déterministe et hautement configurable écrit en **TypeScript / Express** qui émule fidèlement le comportement de l'API **OpenRouter** (`POST /v1/chat/completions` et `GET /v1/models`).

Conçu et réalisé de bout en bout par **Mendel Temgoua** pour permettre aux développeurs et aux équipes d'agents IA de valider la robustesse de leurs applications (**stratégies de retry avec backoff exponentiel**, **basculement automatique de modèles**, **gestion des timeouts** et **décodage de flux Server-Sent Events**) de manière totalement isolée, déterministe et gratuite — aussi bien en local que dans vos pipelines CI/CD GitHub Actions.

---

## Aperçu Visuel & Architecture

| Matrice de Résilience & Mode Chaos (429 / 503) | Streaming SSE Token-par-Token & Télémétrie |
| :---: | :---: |
| ![Pipeline de Résilience et Mode Chaos](./src/assets/images/preview_chaos_matrix_1794405705825.jpg) | ![Streaming SSE et Histogramme de Latence](./src/assets/images/preview_sse_inspector_1794405706059.jpg) |
| *Injection d'erreurs `429 Rate Limit` (`Retry-After`) et `503 Provider Down` pour éprouver le basculement inter-fournisseurs.* | *Émission de chunks `chat.completion.chunk` en temps réel avec mesure du TTFT et de la distribution de latence.* |

---

## Pourquoi ce Projet ?

Lors du développement d'orchestrateurs d'agents IA (LangGraph, CrewAI, Vercel AI SDK, OpenAI SDK), tester les cas limites sur l'API réelle de production pose trois problèmes majeurs :
1. **Non-déterminisme** : Impossible de provoquer sur commande une erreur `429 Too Many Requests` ou une panne `503 Service Unavailable` sur un fournisseur précis (`Anthropic`, `Fireworks`, `OpenAI`).
2. **Coût & Lenteur en CI/CD** : Exécuter des centaines de tests d'intégration consomme des crédits API et ralentit les pull requests.
3. **Observabilité Locale Limitée** : Difficile d'inspecter instantanément les en-têtes exacts (`HTTP-Referer`, `X-Title`, `Authorization`) et le découpage SSE envoyés par vos agents.

**OpenRouter Mock & Test Server** résout ces trois problèmes avec un serveur local zéro-dépendance externe qui démarre en moins d'une seconde.

---

## Fonctionnalités Clés

- **Émulation Standard OpenRouter (`/v1/chat/completions` & `/v1/models`)**
  - Structure de requête et de réponse 100 % conforme à la spécification OpenAI / OpenRouter.
  - Calcul déterministe de l'objet `usage` (`prompt_tokens`, `completion_tokens`, `total_tokens`) et génération d'en-têtes `X-OpenRouter-Provider` et `X-OpenRouter-Generation-Id`.
  - Support des profils déterministes : `default` (texte), `reasoning` (balises `<think>`), `json` (objet JSON garanti), `code` (TypeScript) et `tool_call` (appels de fonctions).
- **Mode Chaos & Résilience (par En-têtes HTTP ou Politique Globale)**
  - **`429 Too Many Requests`** : Simule un dépassement de limite de taux avec en-tête standard `Retry-After` et headers `X-RateLimit-*`.
  - **`502 Bad Gateway` / `503 Service Unavailable`** : Simule une panne du fournisseur amont avec recommandation de fallback dans `error.metadata`.
  - **Latence Artificielle (`x-mock-latency`)** : Injecte un délai précis (de `0ms` à `30000ms`) avant le premier octet pour tester les `AbortSignal` et timeouts d'agents.
  - **Taux d'Échec Probabiliste (`x-mock-fail-rate`)** : Déclenche un pourcentage contrôlé d'erreurs aléatoires (`0.0` à `1.0`) pour les tests de charge.
- **Streaming SSE (Server-Sent Events)**
  - Support natif de `"stream": true` avec découpage lexical fluide, délai inter-chunk configurable (`x-mock-chunk-delay`) et terminaison `data: [DONE]\n\n`.
- **Console Inspector (Terminal ANSI + Interface Web Moderne)**
  - Affichage structuré et coloré dans les logs du serveur et interface Web complète (`http://localhost:3000`) avec Studio SSE, relecture de requêtes en 1 clic, générateur de snippets SDK et export `JSONL`.

---

## Structure du Projet

```text
openrouter-mock-server/
├── .env.example               # Variables d'environnement documentées
├── .gitignore                 # Fichiers ignorés par Git
├── CHANGELOG.md               # Historique des versions (Keep a Changelog)
├── CONTRIBUTING.md            # Guide de contribution Open Source
├── LICENSE                    # Licence MIT (Copyright Mendel Temgoua)
├── README.md                  # Documentation principale et exemples
├── package.json               # Scripts npm et dépendances
├── tsconfig.json              # Configuration TypeScript stricte
├── docs/
│   └── ARCHITECTURE.md        # Spécification technique détaillée et diagrammes de flux
└── src/
    ├── server.ts              # Configuration Express, middlewares CORS et routes API
    ├── handlers/
    │   ├── chat.ts            # Logique /v1/chat/completions, profils déterministes et SSE
    │   └── chaos.ts           # Moteur d'injection d'erreurs (429, 502, 503) et latence
    └── logger.ts              # Console Inspector ANSI et buffer circulaire en mémoire
```

---

## Installation & Démarrage Rapide

### Prérequis
- **Node.js** `>= 18.x`
- **npm** `>= 9.x` (ou `pnpm` / `bun`)

### 1. Cloner le dépôt et installer les dépendances

```bash
git clone https://github.com/mendeltemgoua/openrouter-mock-server.git
cd openrouter-mock-server
npm install
```

### 2. Configurer les variables d'environnement

```bash
cp .env.example .env
```

### 3. Démarrer le serveur

```bash
# Mode développement avec Console Inspector Web sur http://localhost:3000
npm run dev

# Vérification du typage TypeScript
npm run lint

# Build et exécution en production
npm run build
npm start
```

---

## Référence Complète des En-têtes HTTP du Mode Chaos

Pilotez le comportement du serveur **requête par requête** directement depuis votre SDK ou vos tests d'intégration :

| En-tête HTTP | Type / Valeurs | Exemple | Effet sur la réponse `/v1/chat/completions` |
| :--- | :--- | :--- | :--- |
| `x-mock-status` *(alias `x-chaos-error`)* | `200`, `401`, `429`, `500`, `502`, `503` | `x-mock-status: 429` | Force le code HTTP retourné avec le format d'erreur JSON exact d'OpenRouter. |
| `x-mock-latency` *(alias `x-chaos-latency`)* | Entier (`0` – `30000` ms) | `x-mock-latency: 1800` | Retarde l'envoi de la réponse ou du premier chunk SSE de `N` millisecondes. |
| `x-mock-retry-after` | Entier (secondes) | `x-mock-retry-after: 5` | Définit l'en-tête HTTP `Retry-After` lors d'une erreur `429`. |
| `x-mock-provider` | Chaîne de caractères | `x-mock-provider: Anthropic` | Surcharge le nom du fournisseur amont dans les en-têtes et métadonnées d'erreur. |
| `x-mock-fail-rate` | Flottant (`0.0` – `1.0`) | `x-mock-fail-rate: 0.35` | Déclenche une erreur aléatoire (`429` ou `503`) sur 35 % des requêtes. |
| `x-mock-chunk-delay` | Entier (`5` – `2000` ms) | `x-mock-chunk-delay: 30` | Ajuste la vitesse de génération entre chaque token SSE. |
| `x-mock-scenario` | `default`, `reasoning`, `json`, `code`, `tool_call` | `x-mock-scenario: json` | Sélectionne un profil de réponse déterministe adapté à votre test. |

---

## Scripts de Test & Exemples d'Intégration

### 1. Requête Standard Synchrone (`200 OK`)

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-or-v1-mock-key" \
  -H "HTTP-Referer: https://github.com/mendeltemgoua/openrouter-mock-server" \
  -H "X-Title: BillingAuditorAgent" \
  -d '{
    "model": "anthropic/claude-3.7-sonnet",
    "messages": [
      { "role": "system", "content": "Tu es un architecte SRE." },
      { "role": "user", "content": "Vérifie la résilience du cluster eu-west-1." }
    ]
  }'
```

### 2. Streaming SSE Temps Réel (`"stream": true`)

```bash
curl -N -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-or-v1-mock-key" \
  -H "x-mock-chunk-delay: 30" \
  -d '{
    "model": "openai/gpt-4o",
    "stream": true,
    "messages": [
      { "role": "user", "content": "Explique le pattern Circuit Breaker en 3 points." }
    ]
  }'
```

### 3. Test de Rate Limit (`429 Too Many Requests` + `Retry-After`)

```bash
curl -i -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-mock-status: 429" \
  -H "x-mock-retry-after: 3" \
  -d '{
    "model": "meta-llama/llama-3.3-70b-instruct",
    "messages": [{ "role": "user", "content": "Validation du backoff exponentiel" }]
  }'
```

### 4. Test de Panne Fournisseur + Latence (`503 Service Unavailable`)

```bash
curl -i -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-mock-status: 503" \
  -H "x-mock-latency: 1500" \
  -H "x-mock-provider: Fireworks" \
  -d '{
    "model": "deepseek/deepseek-r1",
    "messages": [{ "role": "user", "content": "Test de basculement inter-modèles" }]
  }'
```

### 5. Exemple avec le SDK officiel `openai` (TypeScript)

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'sk-or-v1-mock-key',
  maxRetries: 3,
  defaultHeaders: {
    'HTTP-Referer': 'https://my-agent.internal',
    'X-Title': 'ResilientAgentWorker',
  },
});

async function runAgentWithFallback() {
  try {
    const completion = await client.chat.completions.create({
      model: 'anthropic/claude-3.7-sonnet',
      messages: [{ role: 'user', content: 'Synthétise le rapport d incident.' }],
    });
    return completion.choices[0].message.content;
  } catch (error) {
    // Basculement explicite sur un modèle de secours en cas de 503 persistant
    const fallback = await client.chat.completions.create({
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'Synthétise le rapport d incident.' }],
    });
    return fallback.choices[0].message.content;
  }
}
```

---

## Intégration dans GitHub Actions (CI/CD)

Ajoutez ce service dans votre workflow `.github/workflows/ci.yml` pour exécuter vos tests d'agents sans clé API externe :

```yaml
name: AI Agent Resilience Tests
on: [push, pull_request]

jobs:
  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - name: Start OpenRouter Mock Server
        run: |
          nohup npx tsx src/server.ts > mock-server.log 2>&1 &
          sleep 2
      - name: Run Agent Resilience Suite
        env:
          OPENROUTER_BASE_URL: http://localhost:3000/v1
          OPENROUTER_API_KEY: sk-or-v1-ci-mock-key
        run: npm test
```

---

## Auteur & Conception

Projet conçu, architecturé et développé de bout en bout par **Mendel Temgoua** (`mendeltemgouabusiness@gmail.com`).

- **[Architecture Technique Détaillée](./docs/ARCHITECTURE.md)** — Diagrammes de séquence, cycle de vie d'une requête et contrat SSE.
- **[Guide de Contribution](./CONTRIBUTING.md)** — Conventions de code, ajout de nouveaux profils déterministes et soumission de PR.
- **[Changelog](./CHANGELOG.md)** — Journal des versions et nouveautés.

## Licence

Distribué sous licence **MIT** — Copyright (c) 2026 **Mendel Temgoua**. Consultez le fichier [LICENSE](./LICENSE) pour le texte complet.
