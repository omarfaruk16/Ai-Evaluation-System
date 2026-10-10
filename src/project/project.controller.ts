import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Post, Put, UseGuards } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { generateWebhookSecret } from '../auth/api-key';
import { ApiKeyGuard, clearApiKeyCache, CurrentClient, type AuthenticatedClient } from '../auth/api-key.guard';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { parseOrThrow } from '../common/validation';
import { UsageService } from '../usage/usage.service';
import { WebhookService } from '../webhooks/webhook.service';

const webhookSchema = z.object({
  url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), 'use an http(s) URL'),
});

function version(): string {
  try {
    return (JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * What a connected project needs to set itself up: who its key belongs to, and its webhook.
 * A project registers its own webhook URL, so nobody has to copy a signing secret by hand.
 */
@Controller('v1')
@UseGuards(ApiKeyGuard)
export class ProjectController {
  private readonly version = version();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(WebhookService) private readonly webhooks: WebhookService,
  ) {}

  /** The project this key belongs to. Use it to check a key when connecting. */
  @Get('me')
  async me(@CurrentClient() client: AuthenticatedClient) {
    const row = await this.prisma.client.findUniqueOrThrow({ where: { id: client.id }, include: { plan: true } });
    const now = new Date();
    const usage = await this.usage.projectUsage(client, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), now);
    return {
      project: { id: row.id, name: row.name },
      plan: row.plan ? { name: row.plan.name } : null,
      webhook: { url: row.webhookUrl },
      usageThisMonth: { answersMarked: usage.answers.completed, failed: usage.answers.failed, rubricDrafts: usage.rubricDrafts },
      usageLimit: usage.usageLimit,
      service: { name: 'AI Marking Service', version: this.version, api: 'v1' },
    };
  }

  /**
   * Registers where results are sent and issues a new signing secret for them. The previous
   * secret stops working at once, so store the returned secret before the next webhook arrives.
   */
  @Put('webhook')
  async setWebhook(@CurrentClient() client: AuthenticatedClient, @Body() body: unknown) {
    const { url } = parseOrThrow(webhookSchema, body);
    const secret = generateWebhookSecret();
    await this.prisma.client.update({ where: { id: client.id }, data: { webhookUrl: url, webhookSecret: secret } });
    clearApiKeyCache();
    return { url, secret };
  }

  /** Stops webhooks; the project can still poll GET /v1/evaluations. */
  @Delete('webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearWebhook(@CurrentClient() client: AuthenticatedClient) {
    await this.prisma.client.update({ where: { id: client.id }, data: { webhookUrl: null } });
    clearApiKeyCache();
  }

  /** Sends a signed `ping` to the registered webhook now and reports the response. */
  @Post('webhook/test')
  @HttpCode(HttpStatus.OK)
  async testWebhook(@CurrentClient() client: AuthenticatedClient) {
    const row = await this.prisma.client.findUniqueOrThrow({ where: { id: client.id }, select: { webhookUrl: true, webhookSecret: true } });
    if (!row.webhookUrl) {
      throw new AppError('validation_failed', 'No webhook URL is registered. PUT /v1/webhook first.', HttpStatus.BAD_REQUEST);
    }
    return { url: row.webhookUrl, ...(await this.webhooks.ping(row.webhookUrl, row.webhookSecret)) };
  }
}
