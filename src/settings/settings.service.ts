import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

/** Small JSON settings edited from the console, stored in AppSetting by key. */
@Injectable()
export class SettingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** The stored object merged over `defaults`, so new fields get their default. */
  async get<T extends object>(key: string, defaults: T): Promise<T> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    const value = row?.value;
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...defaults, ...(value as Partial<T>) } : defaults;
  }

  async set<T extends object>(key: string, value: T): Promise<T> {
    const json = value as unknown as Prisma.InputJsonValue;
    await this.prisma.appSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
    return value;
  }
}

@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
