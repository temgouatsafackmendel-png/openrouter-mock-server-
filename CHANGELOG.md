# Changelog

Toutes les modifications notables de **OpenRouter Mock & Test Server** (conçu et réalisé de bout en bout par **Mendel Temgoua**) sont documentées dans ce fichier.
Ce projet respecte le format [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-11-11 — Mendel Temgoua

### Ajouté
- **Comparateur Multi-Modèles en Simultané** : Exécution parallèle de deux modèles IA côte à côte sur une même demande avec mesure comparative du temps de réponse.
- **Sélecteur de Style de Réponse** : Choix entre *Synthèse exécutive*, *Raisonnement étape par étape* et *Plan d'action* dans le simulateur, avec copie rapide en un clic.
- **Synthèse de Performance & Recherche d'Activité** : Indicateurs de disponibilité, temps de réponse moyen et filtre instantané dans l'historique d'activité.

---

## [1.0.0] - 2026-11-11 — Mendel Temgoua

### Ajouté
- **Émulation API OpenRouter (`/v1/chat/completions` & `/v1/models`)** compatible avec les SDKs OpenAI, Vercel AI, LangChain et LiteLLM.
- **Mode Chaos & Résilience (`src/handlers/chaos.ts`)** :
  - Simulation d'erreur `429 Too Many Requests` avec en-tête `Retry-After` et headers `X-RateLimit-*`.
  - Simulation de pannes fournisseurs `502 Bad Gateway` et `503 Service Unavailable`.
  - Injection de latence artificielle (`x-mock-latency`) et taux d'échec probabiliste (`x-mock-fail-rate`).
- **Streaming SSE (`src/handlers/chat.ts`)** : Émission temps réel par chunks `chat.completion.chunk` avec cadence configurable (`x-mock-chunk-delay`).
- **Console Inspector (`src/logger.ts`)** : Journalisation ANSI structurée dans le terminal + buffer circulaire temps réel.
- **Interface Web Moderne (`src/App.tsx`)** :
  - Studio API & SSE avec mesure du TTFT, inspecteur de chunks SSE et générateur de code multi-langages (`cURL`, `TypeScript`, `Python`, `Vercel AI SDK`).
  - Console Inspector avec histogramme de latence, relecture de requêtes en 1 clic et export `JSONL`.
  - Banc de Stress Test par salve de requêtes et explorateur de code source complet.
  - Support complet du Thème Sombre et du Thème Clair.
