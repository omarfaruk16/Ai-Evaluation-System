import { Body, Controller, Get, HttpStatus, Inject, Injectable, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Prisma, type ModelProfile } from '@prisma/client';
import { z } from 'zod';
import { AppError, notFound } from '../common/errors';
import { maskSecret } from '../common/mask';
import { PrismaService } from '../common/prisma.service';
import { parseOrThrow } from '../common/validation';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import {
  API_KEY_ENV_PATTERN,
  fromRow,
  JSON_MODES,
  OPENROUTER_BASE_URL,
  REASONING_LEVELS,
  routingSchema,
} from '../llm/profile';
import { ASSIGNMENTS_KEY, LLM_TASKS, ProfileService, type Assignments, type LlmTask } from '../llm/profile.service';
import { SettingsService } from '../settings/settings.service';
import { AdminGuard } from './auth/admin.guard';
import { UuidPipe } from './http';
import { keyInfo, listHosts, listModels } from './openrouter.info';
import { PlaygroundService, SAMPLE } from './playground.admin';
import { profileView } from './views';

const price = z.number().min(0).max(10_000);

const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    provider: z.enum(['openrouter', 'openai_compatible', 'mock']),
    model: z.string().trim().min(1).max(200),
    baseUrl: z.string().trim().url().nullable().optional(),
    apiKeyEnv: z
      .string()
      .trim()
      .regex(API_KEY_ENV_PATTERN, 'name an environment variable ending in _API_KEY, e.g. DEEPSEEK_API_KEY')
      .nullable()
      .optional(),
    routing: routingSchema.nullable().optional(),
    reasoning: z.enum(REASONING_LEVELS).default('off'),
    temperature: z.number().min(0).max(2).default(0),
    seed: z.number().int().min(0).max(2_147_483_647).nullable().default(7),
    maxOutputTokens: z.number().int().min(200).max(64_000).default(2000),
    timeoutMs: z.number().int().min(5_000).max(300_000).default(60_000),
    jsonMode: z.enum(JSON_MODES).default('json_schema'),
    prices: z.object({ input: price, cachedInput: price, output: price }),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((p, ctx) => {
    if (p.provider !== 'mock' && !p.apiKeyEnv) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['apiKeyEnv'], message: 'name the environment variable that holds the API key' });
    }
    if (p.provider === 'openai_compatible' && !p.baseUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['baseUrl'], message: 'give the API base URL, e.g. https://api.deepseek.com/v1' });
    }
    if (p.baseUrl) {
      const u = new URL(p.baseUrl);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
      if (u.protocol !== 'https:' && !local) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['baseUrl'], message: 'use https (http only for localhost)' });
      }
    }
  });

type ProfileInput = z.infer<typeof profileSchema>;

const assignmentsSchema = z.object(
  Object.fromEntries(LLM_TASKS.map((t) => [t, z.string().uuid()])) as Record<LlmTask, z.ZodString>,
);

function rowData(p: ProfileInput) {
  return {
    name: p.name,
    provider: p.provider,
    model: p.model,
    baseUrl: p.provider === 'mock' ? null : p.provider === 'openrouter' ? (p.baseUrl ?? OPENROUTER_BASE_URL) : (p.baseUrl ?? null),
    apiKeyEnv: p.provider === 'mock' ? null : (p.apiKeyEnv ?? null),
    routing: p.provider === 'openrouter' ? ((p.routing ?? routingSchema.parse({})) as Prisma.InputJsonValue) : Prisma.DbNull,
    reasoning: p.reasoning,
    temperature: p.temperature,
    seed: p.seed,
    maxOutputTokens: p.maxOutputTokens,
    timeoutMs: p.timeoutMs,
    jsonMode: p.jsonMode,
    inputPricePerMTok: p.prices.input,
    cachedInputPricePerMTok: p.prices.cachedInput,
    outputPricePerMTok: p.prices.output,
    notes: p.notes ?? null,
  };
}

@Injectable()
export class ModelsAdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(PlaygroundService) private readonly playground: PlaygroundService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list() {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [rows, assignments, stats] = await Promise.all([
      this.prisma.modelProfile.findMany({ orderBy: [{ archived: 'asc' }, { createdAt: 'asc' }] }),
      this.profiles.assignments(),
      this.prisma.$queryRaw<
        { profileId: string; calls: bigint; failed: bigint; cost: Prisma.Decimal | null; avg_latency: number | null; p95_latency: number | null }[]
      >(Prisma.sql`
        SELECT "profileId",
          count(*) AS calls,
          count(*) FILTER (WHERE NOT ok) AS failed,
          sum("costUsd") AS cost,
          avg("latencyMs") FILTER (WHERE ok) AS avg_latency,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") FILTER (WHERE ok) AS p95_latency
        FROM "LlmCall" WHERE "createdAt" >= ${since} AND "profileId" IS NOT NULL
        GROUP BY "profileId"`),
    ]);
    const byProfile = new Map(stats.map((s) => [s.profileId, s]));
    const keyEnvs = [...new Set(rows.map((r) => r.apiKeyEnv).filter((k): k is string => Boolean(k)))];
    return {
      production: this.env.NODE_ENV === 'production',
      assignments,
      keys: keyEnvs.map((name) => {
        const v = API_KEY_ENV_PATTERN.test(name) ? process.env[name]?.trim() : undefined;
        return { name, set: Boolean(v), hint: maskSecret(v) };
      }),
      profiles: rows.map((r) => {
        const s = byProfile.get(r.id);
        const calls = Number(s?.calls ?? 0);
        return {
          ...profileView(r),
          usedFor: LLM_TASKS.filter((t) => assignments[t] === r.id),
          last30d: {
            calls,
            failed: Number(s?.failed ?? 0),
            costUsd: Number(s?.cost ?? 0),
            avgLatencyMs: s?.avg_latency === null || s?.avg_latency === undefined ? null : Math.round(Number(s.avg_latency)),
            p95LatencyMs: s?.p95_latency === null || s?.p95_latency === undefined ? null : Math.round(Number(s.p95_latency)),
          },
        };
      }),
    };
  }

  async create(input: ProfileInput) {
    this.assertAllowed(input.provider);
    const row = await this.unique(() => this.prisma.modelProfile.create({ data: rowData(input) }));
    return profileView(row);
  }

  async update(id: string, input: ProfileInput) {
    await this.find(id);
    this.assertAllowed(input.provider);
    const row = await this.unique(() => this.prisma.modelProfile.update({ where: { id }, data: rowData(input) }));
    this.profiles.invalidate();
    return profileView(row);
  }

  async duplicate(id: string) {
    const src = await this.find(id);
    const names = new Set((await this.prisma.modelProfile.findMany({ select: { name: true } })).map((r) => r.name));
    let name = `${src.name} (copy)`;
    for (let i = 2; names.has(name); i++) name = `${src.name} (copy ${i})`;
    const { id: _id, createdAt: _c, updatedAt: _u, routing, ...rest } = src;
    const row = await this.prisma.modelProfile.create({
      data: { ...rest, name, archived: false, routing: routing === null ? Prisma.DbNull : (routing as Prisma.InputJsonValue) },
    });
    return profileView(row);
  }

  async setArchived(id: string, archived: boolean) {
    await this.find(id);
    if (archived) {
      const assigned = await this.profiles.assignments();
      const tasks = LLM_TASKS.filter((t) => assigned[t] === id);
      if (tasks.length > 0) {
        throw new AppError('conflict', `This profile is in use for: ${tasks.join(', ')}. Assign another profile first.`, HttpStatus.CONFLICT);
      }
    }
    const row = await this.prisma.modelProfile.update({ where: { id }, data: { archived } });
    return profileView(row);
  }

  async setAssignments(input: Record<LlmTask, string>) {
    const ids = [...new Set(Object.values(input))];
    const rows = await this.prisma.modelProfile.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const t of LLM_TASKS) {
      const row = byId.get(input[t]);
      if (!row) throw new AppError('validation_failed', `Unknown profile for ${t}`, HttpStatus.BAD_REQUEST);
      if (row.archived) throw new AppError('validation_failed', `"${row.name}" is archived`, HttpStatus.BAD_REQUEST);
      this.assertAllowed(row.provider);
    }
    await this.settings.set<Assignments>(ASSIGNMENTS_KEY, input);
    this.profiles.invalidate();
    return this.profiles.assignments();
  }

  /** Marks the built-in sample answer with this profile: a quick end-to-end check of key, model and output. */
  async test(id: string) {
    await this.find(id);
    return this.playground.mark({ ...SAMPLE, profileId: id });
  }

  async keyInfo(id: string) {
    const row = await this.find(id);
    if (row.provider !== 'openrouter') {
      throw new AppError('validation_failed', 'Key usage is only available for OpenRouter profiles', HttpStatus.BAD_REQUEST);
    }
    return keyInfo(fromRow(row));
  }

  private assertAllowed(provider: string) {
    if (provider === 'mock' && this.env.NODE_ENV === 'production') {
      throw new AppError('validation_failed', 'The mock model can’t be used in production', HttpStatus.BAD_REQUEST);
    }
  }

  private async find(id: string): Promise<ModelProfile> {
    const row = await this.prisma.modelProfile.findUnique({ where: { id } });
    if (!row) throw notFound('Model profile');
    return row;
  }

  private async unique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError('conflict', 'A profile with this name already exists', HttpStatus.CONFLICT);
      }
      throw e;
    }
  }
}

@Controller('admin-api/models')
@UseGuards(AdminGuard)
export class ModelsAdminController {
  constructor(@Inject(ModelsAdminService) private readonly models: ModelsAdminService) {}

  @Get()
  list() {
    return this.models.list();
  }

  @Post()
  create(@Body() body: unknown) {
    return this.models.create(parseOrThrow(profileSchema, body));
  }

  @Put('assignments')
  assignments(@Body() body: unknown) {
    return this.models.setAssignments(parseOrThrow(assignmentsSchema, body) as Record<LlmTask, string>);
  }

  /** OpenRouter catalogue search (public, cached for an hour). */
  @Get('openrouter/models')
  openrouterModels(@Query('q') q?: string) {
    return listModels(OPENROUTER_BASE_URL, q ?? '');
  }

  /** Hosts serving a model on OpenRouter, with their prices and quantization. */
  @Get('openrouter/hosts')
  openrouterHosts(@Query('model') model?: string) {
    if (!model) throw new AppError('validation_failed', 'model is required', HttpStatus.BAD_REQUEST);
    return listHosts(OPENROUTER_BASE_URL, model);
  }

  @Put(':id')
  update(@Param('id', new UuidPipe()) id: string, @Body() body: unknown) {
    return this.models.update(id, parseOrThrow(profileSchema, body));
  }

  @Post(':id/duplicate')
  duplicate(@Param('id', new UuidPipe()) id: string) {
    return this.models.duplicate(id);
  }

  @Post(':id/archive')
  archive(@Param('id', new UuidPipe()) id: string) {
    return this.models.setArchived(id, true);
  }

  @Post(':id/restore')
  restore(@Param('id', new UuidPipe()) id: string) {
    return this.models.setArchived(id, false);
  }

  @Post(':id/test')
  test(@Param('id', new UuidPipe()) id: string) {
    return this.models.test(id);
  }

  @Get(':id/key')
  key(@Param('id', new UuidPipe()) id: string) {
    return this.models.keyInfo(id);
  }
}
