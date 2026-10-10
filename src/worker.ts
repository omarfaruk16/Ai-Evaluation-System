import './config/load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkersModule } from './workers.module';

/** Queue consumers only, no HTTP. Run one or more replicas of this next to the API. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkersModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('Worker started: consuming marking-realtime, marking-deferred, webhooks', 'Worker');
}

void bootstrap();
