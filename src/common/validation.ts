import { HttpStatus } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';
import { AppError } from './errors';

/** Parses a request body or query with a zod schema, or throws a 400 listing every problem. */
export function parseOrThrow<T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(
      'validation_failed',
      'Request validation failed',
      HttpStatus.BAD_REQUEST,
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return parsed.data;
}
