import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './common/prisma.service';
import { AppConfigModule, ENV } from './config/config.module';
import type { Env } from './config/env';
import { LlmModule } from './llm/llm.module';
import { FeedbackService } from './marking/feedback.service';
import { MarkingService } from './marking/marking.service';
import { RubricDraftService } from './marking/rubric-draft.service';
import { QueueModule } from './queue/queue.module';
import { UsageService } from './usage/usage.service';
import { WebhookService } from './webhooks/webhook.service';

const services = [UsageService, WebhookService, MarkingService, RubricDraftService, FeedbackService];

/** Everything shared by the HTTP API and the worker process. */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
          autoLogging: { ignore: (req) => req.url === '/health' },
          ...(env.NODE_ENV === 'development'
            ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
            : {}),
        },
      }),
    }),
    PrismaModule,
    LlmModule,
    QueueModule,
  ],
  providers: services,
  exports: [...services, AppConfigModule],
})
export class CoreModule {}
