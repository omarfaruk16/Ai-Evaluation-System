import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { hashApiKey } from './api-key';

export interface AuthenticatedClient {
  id: string;
  name: string;
  webhookUrl: string | null;
  monthlyBudgetUsd: number | null;
}

type RequestWithClient = Request & { client?: AuthenticatedClient };

const CACHE_MS = 60_000;

/** Accepts `Authorization: Bearer <key>` or `X-Api-Key: <key>`. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly cache = new Map<string, { at: number; client: AuthenticatedClient | null }>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestWithClient>();
    const header = req.headers.authorization;
    const key =
      (typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined) ??
      (typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : undefined);
    if (!key) throw new AppError('unauthorized', 'Missing API key', HttpStatus.UNAUTHORIZED);

    const client = await this.lookup(hashApiKey(key));
    if (!client) throw new AppError('unauthorized', 'Invalid or disabled API key', HttpStatus.UNAUTHORIZED);
    req.client = client;
    return true;
  }

  private async lookup(hash: string): Promise<AuthenticatedClient | null> {
    const hit = this.cache.get(hash);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.client;
    const row = await this.prisma.client.findUnique({ where: { apiKeyHash: hash } });
    const client =
      row && row.active
        ? {
            id: row.id,
            name: row.name,
            webhookUrl: row.webhookUrl,
            monthlyBudgetUsd: row.monthlyBudgetUsd === null ? null : Number(row.monthlyBudgetUsd),
          }
        : null;
    this.cache.set(hash, { at: Date.now(), client });
    return client;
  }
}

export const CurrentClient = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedClient =>
    ctx.switchToHttp().getRequest<RequestWithClient>().client!,
);
