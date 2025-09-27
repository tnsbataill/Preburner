import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';

const serviceWorkerSource = fileURLToPath(new URL('../src/service-worker.ts', import.meta.url));
const serviceWorkerRequestPath = '/sw.js';
const virtualModuleId = 'virtual:preburner-sw-register';
const resolvedVirtualModuleId = `\0${virtualModuleId}`;

function injectDevMiddleware(server: ViteDevServer): void {
  server.watcher.add(serviceWorkerSource);

  server.middlewares.use((req, res, next) => {
    if (!req.url || !req.url.endsWith(serviceWorkerRequestPath)) {
      next();
      return;
    }

    server
      .transformRequest('/src/service-worker.ts')
      .then((result) => {
        if (!result) {
          res.statusCode = 404;
          res.end();
          return;
        }

        res.setHeader('Content-Type', 'application/javascript');
        res.end(result.code);
      })
      .catch((error) => {
        res.statusCode = 500;
        res.end(String(error));
      });
  });
}

export function preburnerPwaPlugin(): Plugin {
  let resolvedConfig: ResolvedConfig | undefined;

  return {
    name: 'preburner-pwa-plugin',
    enforce: 'post',
    configResolved(config) {
      resolvedConfig = config;
    },
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
      return undefined;
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        const base = resolvedConfig?.base ?? '/';
        const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
        const swPath = `${normalizedBase}${serviceWorkerRequestPath}` || serviceWorkerRequestPath;
        return `
export function registerPreburnerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('${swPath}')
      .catch((error) => {
        console.error('Service worker registration failed:', error);
      });
  });
}
`;
      }

      return undefined;
    },
    configureServer(server) {
      injectDevMiddleware(server);
    },
    buildStart() {
      if (!resolvedConfig || resolvedConfig.command !== 'build') {
        return;
      }

      this.emitFile({
        type: 'chunk',
        id: serviceWorkerSource,
        fileName: serviceWorkerRequestPath.slice(1),
      });
    },
  };
}
