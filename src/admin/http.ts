import type { Response } from 'express';
import { z } from 'zod';
import { notFound } from '../common/errors';

/** Rejects ids that aren't UUIDs with a 404 instead of a database error. */
export class UuidPipe {
  transform(value: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw notFound('Record');
    return value;
  }
}

export function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const paged = <T>(items: T[], total: number, page: number, pageSize: number) => ({
  items,
  total,
  page,
  pageSize,
  pages: Math.max(1, Math.ceil(total / pageSize)),
});
