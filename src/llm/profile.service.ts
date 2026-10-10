import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, type LlmCallKind } from '@prisma/client';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { SettingsService } from '../settings/settings.service';
import { envProfile, fromRow, toRowData, type ResolvedProfile } from './profile';

export const LLM_TASKS: readonly LlmCallKind[] = ['marking', 'rubric_draft', 'feedback_rewrite'];
export const ASSIGNMENTS_KEY = 'llm.assignments';
export type Assignments = Partial<Record<LlmCallKind, string>>;

/** How long a process keeps resolved profiles; console changes reach every process within this. */
const CACHE_MS = 10_000;

/**
 * Resolves which model profile serves each task. Assignments and profiles live in the database
 * and are edited from the console; the first start saves the .env settings as a profile.
 */
@Injectable()
export class ProfileService implements OnModuleInit {
  private readonly logger = new Logger(ProfileService.name);
  private readonly fallback: ResolvedProfile;
  private cache: { at: number; byKind: Record<LlmCallKind, ResolvedProfile> } | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ENV) env: Env,
  ) {
    this.fallback = envProfile(env);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.bootstrap();
      const marking = await this.forKind('marking');
      this.logger.log(`Marking model: ${marking.name} (${marking.provider} ${marking.model})`);
    } catch (e) {
      this.logger.warn(`Could not load model profiles, using .env settings: ${(e as Error).message}`);
    }
  }

  /** First start: save the .env model as an editable profile and assign it to every task. */
  async bootstrap(): Promise<void> {
    if ((await this.prisma.modelProfile.count()) > 0) return;
    try {
      const row = await this.prisma.modelProfile.create({ data: toRowData(this.fallback) });
      await this.settings.set<Assignments>(ASSIGNMENTS_KEY, Object.fromEntries(LLM_TASKS.map((t) => [t, row.id])));
      this.logger.log(`Saved the .env model settings as profile "${row.name}"`);
    } catch (e) {
      // Another process (API or worker) seeded it at the same moment.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    this.invalidate();
  }

  async forKind(kind: LlmCallKind): Promise<ResolvedProfile> {
    return (await this.load())[kind];
  }

  async byId(id: string): Promise<ResolvedProfile> {
    const row = /^[0-9a-f-]{36}$/i.test(id) ? await this.prisma.modelProfile.findUnique({ where: { id } }) : null;
    if (!row) throw new AppError('not_found', 'Model profile not found', HttpStatus.NOT_FOUND);
    return fromRow(row);
  }

  /** Last resolved profile for a task, without a database read (health checks, labels). */
  current(kind: LlmCallKind): ResolvedProfile {
    return this.cache?.byKind[kind] ?? this.fallback;
  }

  async assignments(): Promise<Assignments> {
    return this.settings.get<Assignments>(ASSIGNMENTS_KEY, {});
  }

  invalidate(): void {
    this.cache = null;
  }

  private async load(): Promise<Record<LlmCallKind, ResolvedProfile>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.byKind;
    const assigned = await this.assignments();
    const ids = [...new Set(Object.values(assigned).filter((v): v is string => typeof v === 'string'))];
    const rows = ids.length > 0 ? await this.prisma.modelProfile.findMany({ where: { id: { in: ids }, archived: false } }) : [];
    const byId = new Map(rows.map((r) => [r.id, fromRow(r)]));
    const byKind = Object.fromEntries(
      LLM_TASKS.map((t) => [t, byId.get(assigned[t] ?? '') ?? this.fallback]),
    ) as Record<LlmCallKind, ResolvedProfile>;
    this.cache = { at: Date.now(), byKind };
    return byKind;
  }
}
