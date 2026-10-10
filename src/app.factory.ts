import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
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
  app.use(helmet());
  // 500 answers of up to 20k characters fit comfortably.
  app.useBodyParser('json', { limit: '12mb' });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  return app;
}
