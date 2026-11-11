/**
 * @file src/server.ts
 * @author Mendel Temgoua <mendeltemgouabusiness@gmail.com>
 * @license MIT
 * @description Point d'entrée principal de "OpenRouter Mock & Test Server".
 * Configure Express, les middlewares CORS/JSON, les routes d'émulation OpenRouter
 * (/v1/chat/completions, /v1/models) ainsi que les endpoints d'inspection et Vite.
 */

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleChatCompletions, handleListModels } from './handlers/chat.ts';
import {
  getGlobalChaosConfig,
  resetGlobalChaosConfig,
  updateGlobalChaosConfig,
} from './handlers/chaos.ts';
import {
  clearInspectionLogs,
  getInspectionLogs,
  seedInitialLogs,
} from './logger.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

export async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // Pré-remplissage initial du Console Inspector avec 3 traces réalistes d'agents
  seedInitialLogs();

  // Middlewares CORS et parsing JSON
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, HTTP-Referer, X-Title, x-mock-status, x-mock-latency, x-mock-retry-after, x-mock-provider, x-mock-fail-rate, x-mock-chunk-delay, x-mock-scenario, x-chaos-error, x-chaos-latency'
    );
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Retry-After, X-OpenRouter-Mock, X-OpenRouter-Provider, X-OpenRouter-Generation-Id, X-RateLimit-Limit-Requests, X-RateLimit-Remaining-Requests, X-RateLimit-Reset-Requests'
    );

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '4mb' }));

  // ==========================================================================
  // 1. Endpoints d'Émulation OpenRouter (/v1/* et alias /api/v1/*)
  // ==========================================================================
  app.post('/v1/chat/completions', handleChatCompletions);
  app.post('/api/v1/chat/completions', handleChatCompletions);

  app.get('/v1/models', handleListModels);
  app.get('/api/v1/models', handleListModels);

  // ==========================================================================
  // 2. Endpoints de Pilotage du Console Inspector & Mode Chaos
  // ==========================================================================
  app.get('/api/inspector/logs', (_req: Request, res: Response) => {
    res.json({
      logs: getInspectionLogs(),
      chaosConfig: getGlobalChaosConfig(),
    });
  });

  app.delete('/api/inspector/logs', (_req: Request, res: Response) => {
    clearInspectionLogs();
    res.json({ ok: true, logs: [] });
  });

  app.get('/api/chaos-config', (_req: Request, res: Response) => {
    res.json(getGlobalChaosConfig());
  });

  app.post('/api/chaos-config', (req: Request, res: Response) => {
    const updated = updateGlobalChaosConfig(req.body || {});
    res.json(updated);
  });

  app.post('/api/chaos-config/reset', (_req: Request, res: Response) => {
    const reset = resetGlobalChaosConfig();
    res.json(reset);
  });

  // Exposition des fichiers sources du projet Open Source pour consultation/copie
  app.get('/api/project-files', (_req: Request, res: Response) => {
    const relativeFiles = [
      'README.md',
      'docs/ARCHITECTURE.md',
      'CONTRIBUTING.md',
      'CHANGELOG.md',
      'LICENSE',
      'src/server.ts',
      'src/handlers/chat.ts',
      'src/handlers/chaos.ts',
      'src/logger.ts',
      '.env.example',
      'package.json',
      'tsconfig.json',
    ];

    const files = relativeFiles.map((relPath) => {
      const fullPath = path.join(ROOT_DIR, relPath);
      let content = '';
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        content = `// Fichier ${relPath} introuvable`;
      }
      return {
        path: relPath,
        content,
      };
    });

    res.json({ files });
  });

  // ==========================================================================
  // 3. Intégration Vite (Dev) ou Fichiers Statiques (Production)
  // ==========================================================================
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `\n\x1b[1m\x1b[32m✔ OpenRouter Mock & Test Server actif sur http://0.0.0.0:${PORT}\x1b[0m`
    );
    console.log(
      `  \x1b[90m├─ Endpoint Chat Completions :\x1b[0m POST http://localhost:${PORT}/v1/chat/completions`
    );
    console.log(
      `  \x1b[90m├─ Endpoint Modèles          :\x1b[0m GET  http://localhost:${PORT}/v1/models`
    );
    console.log(
      `  \x1b[90m└─ Console Inspector Web UI  :\x1b[0m http://localhost:${PORT}\n`
    );
  });
}

startServer();
