import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

export type ErrorCode =
  | 'unauthorized'
  | 'validation_failed'
  | 'invalid_rubric'
  | 'not_found'
  | 'conflict'
  | 'budget_exceeded'
  | 'llm_unavailable'
  | 'rubric_draft_invalid'
  | 'payload_too_large'
  | 'internal_error';

/** Every error the API returns has this shape: { error: { code, message, details? } }. */
export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    readonly details?: unknown,
  ) {
    super({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status);
  }
}

export const notFound = (what: string) => new AppError('not_found', `${what} not found`, 404);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCode =
        status === 401
          ? 'unauthorized'
          : status === 404
            ? 'not_found'
            : status === 413
              ? 'payload_too_large'
              : status >= 500
                ? 'internal_error'
                : 'validation_failed';
      res.status(status).json({ error: { code, message: exception.message } });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: { code: 'internal_error', message: 'Unexpected server error' } });
  }
}
