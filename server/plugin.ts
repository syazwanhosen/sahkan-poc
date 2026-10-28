// Mounts the MyInvois endpoints on Vite's dev and preview servers, so `npm run dev` is all it
// takes. The single-file build has no server: it runs the simulated MyInvois only.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { readConfig } from './config';
import { createHandler } from './handler';

export function myinvoisApi(env: Record<string, string>): Plugin {
  const cfg = readConfig(env);
  let handle: ReturnType<typeof createHandler> | undefined;
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    handle ??= createHandler(cfg);
    void handle(req, res, next);
  };
  const summary = () => {
    const who = [cfg.taxpayer && 'taxpayer', cfg.intermediary && 'intermediary'].filter(Boolean).join(' and ');
    return who ? `MyInvois ${cfg.env}: ${who} system set up` : 'MyInvois: no credentials in .env, so only the simulated demo is available';
  };
  return {
    name: 'sahkan-myinvois',
    configureServer(server) {
      server.middlewares.use(middleware);
      server.httpServer?.once('listening', () => server.config.logger.info(`  ${summary()}`));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
