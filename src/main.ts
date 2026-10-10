import './config/load-env';
import 'reflect-metadata';
import { Logger } from 'nestjs-pino';
import { createApp } from './app.factory';
import { ENV } from './config/config.module';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const env = app.get<Env>(ENV);
  await app.listen(env.PORT, env.HOST);
  app.get(Logger).log(`AI marking API listening on ${env.HOST}:${env.PORT}`, 'Bootstrap');
}

void bootstrap();
