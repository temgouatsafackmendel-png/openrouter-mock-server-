# Changelog

Toutes les modifications notables de **OpenRouter Mock & Test Server** (conçu et réalisé de bout en bout par **Mendel Temgoua**) sont documentées dans ce fichier.
Ce projet respecte le format [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.3.0] - 2026-11-11 — Mendel Temgoua

### Ajouté & Amélioré (Identité Visuelle, Typographie & Iconographie)
- **Système Typographique Éditorial** : Intégration du duo **Bricolage Grotesque** (titres et structure) + **Plus Jakarta Sans** (interface et lecture fluide) + **JetBrains Mono** (métriques tabulaires).
- **Illustrations Architecturales Haute Résolution** : Bannière visuelle interactive dans l'en-tête principal et cartes visuelles illustrant le flux temps réel et la matrice de continuité.
- **Emblèmes Vectoriels par Modèle & Iconographie Enrichie** : Icônes dédiées pour chaque fournisseur IA (*Anthropic*, *OpenAI*, *DeepSeek*, *Mistral*, *Meta*) et contrôles visuels enrichis.

---

## [1.2.0] - 2026-11-11 — Mendel Temgoua

### Amélioré (Interface & Expérience Utilisateur)
- **Fil de Conversation Continu & Raccourcis Clavier** : Envoi instantané avec la touche `Entrée`, interruption à la volée d'une génération en cours et bouton de **basculement immédiat sur un modèle de secours** lorsqu'un aléa est simulé.
- **Comparateur Enrichi** : Indicateur automatique du modèle le plus rapide, permutation rapide des deux modèles et reprise en un clic de la meilleure réponse dans le simulateur.
- **Indicateur de Progression & Export Lisible** : Suivi visuel étape par étape dans la vue *Résilience* et filtres par état avec export de rapport synthétique dans *Activité*.

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
