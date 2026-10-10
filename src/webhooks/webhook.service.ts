import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { toView } from '../evaluations/evaluation.view';
import { QUEUE_WEBHOOKS, type WebhookJob } from '../queue/queue.module';
import { signatureHeader } from './signature';

export type WebhookEvent = 'evaluation.completed' | 'evaluation.failed';

export class WebhookDeliveryError extends Error {}

export interface PingResult {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  /** First 500 characters of the response body, or the network error. */
  body: string;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    @InjectQueue(QUEUE_WEBHOOKS) private readonly queue: Queue<WebhookJob>,
  ) {}

  /** Queues a signed notification if the client (or the request) gave a webhook URL. */
  async notify(evaluationIds: string[], event: WebhookEvent): Promise<void> {
    if (evaluationIds.length === 0) return;
    const evaluations = await this.prisma.evaluation.findMany({
      where: { id: { in: evaluationIds } },
      select: { id: true, clientId: true, callbackUrl: true, client: { select: { webhookUrl: true } } },
    });
    const rows = evaluations
      .map((e) => ({ e, url: e.callbackUrl ?? e.client.webhookUrl }))
      .filter((r): r is { e: (typeof evaluations)[number]; url: string } => Boolean(r.url));
    if (rows.length === 0) return;

    const deliveries = await this.prisma.$transaction(
      rows.map(({ e, url }) =>
        this.prisma.webhookDelivery.create({
          data: { clientId: e.clientId, evaluationId: e.id, event, url },
          select: { id: true },
        }),
      ),
    );
    await this.queue.addBulk(
      deliveries.map((d) => ({
        name: 'deliver',
        data: { deliveryId: d.id },
        opts: {
          jobId: `wh-${d.id}`,
          attempts: this.env.WEBHOOK_MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: 10_000 },
        },
      })),
    );
  }

  /** Sends one delivery. Throws on failure so the queue retries with backoff. */
  async deliver(deliveryId: string, isFinalAttempt: boolean): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { client: { select: { webhookSecret: true } } },
    });
    if (!delivery || delivery.status === 'delivered') return;
    const evaluation = await this.prisma.evaluation.findUnique({ where: { id: delivery.evaluationId } });
    if (!evaluation) return;

    const body = JSON.stringify({
      id: delivery.id,
      type: delivery.event,
      createdAt: delivery.createdAt.toISOString(),
      data: { evaluation: toView(evaluation) },
    });

    let status: number | null = null;
    let error: string | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.env.WEBHOOK_TIMEOUT_MS);
    try {
      const res = await fetch(delivery.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ai-marking-service/1',
          'X-AMS-Event': delivery.event,
          'X-AMS-Delivery': delivery.id,
          'X-AMS-Signature': signatureHeader(delivery.client.webhookSecret, body),
        },
        body,
        signal: controller.signal,
      });
      status = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message;
    } finally {
      clearTimeout(timer);
    }

    const delivered = error === null;
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts: { increment: 1 },
        lastStatusCode: status,
        lastError: error,
        status: delivered ? 'delivered' : isFinalAttempt ? 'failed' : 'pending',
        deliveredAt: delivered ? new Date() : null,
      },
    });
    if (!delivered) {
      if (isFinalAttempt) this.logger.warn(`Webhook ${deliveryId} to ${delivery.url} gave up: ${error}`);
      throw new WebhookDeliveryError(`Webhook delivery failed: ${error}`);
    }
  }

  /** Sends a signed `ping` event to a URL right away (not queued) and reports what came back. */
  async ping(url: string, secret: string): Promise<PingResult> {
    const body = JSON.stringify({ id: randomUUID(), type: 'ping', createdAt: new Date().toISOString(), data: {} });
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.env.WEBHOOK_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ai-marking-service/1',
          'X-AMS-Event': 'ping',
          'X-AMS-Signature': signatureHeader(secret, body),
        },
        body,
        signal: controller.signal,
      });
      return { ok: res.ok, status: res.status, latencyMs: Date.now() - started, body: (await res.text()).slice(0, 500) };
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      return { ok: false, status: null, latencyMs: Date.now() - started, body: aborted ? 'Timed out' : (e as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }
}
