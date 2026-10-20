import { Module } from '@nestjs/common';
import { CoreModule } from '../core.module';
import { LeadsAdminController } from '../leads/leads';
import { EvaluationsService } from '../evaluations/evaluations.service';
import { AdminAuthController, AdminsController } from './auth/admin-auth.controller';
import { AdminAuthService } from './auth/admin-auth.service';
import { AdminGuard } from './auth/admin.guard';
import { BillingController, PlansController } from './billing/billing.controller';
import { BillingService } from './billing/billing.service';
import { ClientsAdminController, ClientsAdminService } from './clients.admin';
import { ModelsAdminController, ModelsAdminService } from './models.admin';
import { EvaluationsAdminController, SystemController, WebhooksAdminController } from './operations.admin';
import { OverviewController, OverviewService } from './overview.admin';
import { PlaygroundController, PlaygroundService } from './playground.admin';

/** The operator console's API under /admin-api. Session-cookie auth, separate from client API keys. */
@Module({
  imports: [CoreModule],
  controllers: [
    AdminAuthController,
    AdminsController,
    OverviewController,
    ClientsAdminController,
    ModelsAdminController,
    PlansController,
    BillingController,
    EvaluationsAdminController,
    WebhooksAdminController,
    PlaygroundController,
    SystemController,
    LeadsAdminController,
  ],
  providers: [
    AdminAuthService,
    AdminGuard,
    BillingService,
    ClientsAdminService,
    ModelsAdminService,
    OverviewService,
    PlaygroundService,
    EvaluationsService,
  ],
})
export class AdminModule {}
