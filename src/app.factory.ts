import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/errors';
import { ENV } from './config/config.module';
import type { Env } from './config/env';

export async function createApp(
  opts: { embeddedWorkers?: boolean; logger?: boolean } = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(opts), {
    bufferLogs: opts.logger !== false,
    bodyParser: false,
    ...(opts.logger === false ? { logger: false as const } : {}),
  });
  const env = app.get<Env>(ENV);
  if (opts.logger !== false) app.useLogger(app.get(Logger));
  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Plain-http deployments (local, private network) would otherwise break the console.
          upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
          connectSrc: ["'self'"],
        },
      },
    }),
  );
  if (env.CONSOLE_ENABLED) serveConsole(app, env.CONSOLE_DIR);
  // 500 answers of up to 20k characters fit comfortably.
  app.useBodyParser('json', { limit: '12mb' });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  return app;
}

/**
 * The operator console's built files at /console (single-page app: unknown paths get index.html).
 * Hashed assets are cached for a year; index.html is always revalidated.
 */
function serveConsole(app: NestExpressApplication, dir?: string): void {
  const root = resolve(dir ?? join(__dirname, '..', 'console', 'dist'));
  const index = join(root, 'index.html');
  if (!existsSync(index)) return;
  app.useStaticAssets(root, {
    prefix: '/console',
    index: false,
    setHeaders: (res, path) => {
      res.setHeader('Cache-Control', path.includes(`${join(root, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.use('/console', (req: Request, res: Response, next: NextFunction) => {
    // Page routes get the app; a missing file (e.g. an old hashed asset) gets a 404, not HTML.
    if ((req.method !== 'GET' && req.method !== 'HEAD') || /\.[a-z0-9]+$/i.test(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  app.use((req: Request, res: Response, next: NextFunction) => (req.path === '/' && req.method === 'GET' ? res.redirect('/console/') : next()));
}
