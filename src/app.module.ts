import { Module, type DynamicModule } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { ApiKeyGuard } from './auth/api-key.guard';
import { envBool } from './config/runtime';
import { CoreModule } from './core.module';
import { EvaluationsController } from './evaluations/evaluations.controller';
import { EvaluationsService } from './evaluations/evaluations.service';
import { HealthController } from './health/health.controller';
import { ProjectController } from './project/project.controller';
import { RubricsController } from './rubrics/rubrics.controller';
import { UsageController } from './usage/usage.controller';
import { WorkersModule } from './workers.module';

@Module({})
export class AppModule {
  /** `embeddedWorkers` defaults to RUN_EMBEDDED_WORKERS; tests pass it explicitly. */
  static register(opts: { embeddedWorkers?: boolean } = {}): DynamicModule {
    const embedded = opts.embeddedWorkers ?? envBool('RUN_EMBEDDED_WORKERS', false);
    const console = envBool('CONSOLE_ENABLED', true);
    return {
      module: AppModule,
      imports: [CoreModule, ...(embedded ? [WorkersModule] : []), ...(console ? [AdminModule] : [])],
      controllers: [EvaluationsController, RubricsController, UsageController, ProjectController, HealthController],
      providers: [EvaluationsService, ApiKeyGuard],
    };
  }
}
