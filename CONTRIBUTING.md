# Guide de Contribution (Contributing)

Merci de votre intérêt pour **OpenRouter Mock & Test Server**, un projet open source conçu et réalisé de bout en bout par **Mendel Temgoua** pour offrir aux développeurs d'agents IA un banc d'essai local déterministe.

---

## Comment Contribuer

1. **Forkez** le dépôt sur GitHub (`https://github.com/mendeltemgoua/openrouter-mock-server`).
2. **Créez une branche** descriptive pour votre fonctionnalité ou correctif :
   ```bash
   git checkout -b feat/nouveau-profil-deterministe
   ```
3. **Installez les dépendances et lancez le serveur en mode développement** :
   ```bash
   npm install
   npm run dev
   ```
4. **Vérifiez le typage TypeScript et le build** avant de soumettre :
   ```bash
   npm run lint
   npm run build
   ```
5. **Ouvrez une Pull Request** en décrivant clairement le scénario de test ajouté.

---

## Ajouter un Nouveau Profil de Réponse Déterministe

Les profils de réponse sont définis dans `src/handlers/chat.ts` au sein de la fonction `buildDeterministicReply()`. Pour ajouter un nouveau scénario (ex: `x-mock-scenario: sql`) :

1. Ajoutez la branche correspondante dans `buildDeterministicReply()` dans `src/handlers/chat.ts`.
2. Ajoutez l'option dans le sélecteur de profil de `src/App.tsx`.
3. Documentez la nouvelle valeur dans la table des en-têtes de `README.md`.

---

## Licence

En contribuant à ce dépôt, vous acceptez que vos contributions soient distribuées sous la licence **MIT** du projet (Copyright (c) 2026 Mendel Temgoua).
