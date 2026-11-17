import { ERROR_CODES, type ErrorCode } from '@selly/contracts';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

/** An error with a stable code, rendered as RFC 9457 problem+json. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    readonly detail: string,
    readonly extra: { errors?: Record<string, unknown>[]; headers?: Record<string, string> } = {},
    readonly title: string = code
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase()),
  ) {
    super(detail);
    this.status = ERROR_CODES[code];
  }
}

const typeUrl = (base: string, code: string) =>
  `${base}/problems/${code.toLowerCase().replace(/_/g, '-')}`;

export function registerErrorHandling(app: FastifyInstance, baseUrl: string) {
  app.setNotFoundHandler((req, reply) => {
    reply
      .code(404)
      .type('application/problem+json')
      .send({
        type: typeUrl(baseUrl, 'NOT_FOUND'),
        title: 'Not found',
        status: 404,
        code: 'NOT_FOUND',
        detail: `No route ${req.method} ${req.url.split('?')[0]}.`,
        trace_id: req.id,
      });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      for (const [k, v] of Object.entries(err.extra.headers ?? {})) reply.header(k, v);
      return reply
        .code(err.status)
        .type('application/problem+json')
        .send({
          type: typeUrl(baseUrl, err.code),
          title: err.title,
          status: err.status,
          code: err.code,
          detail: err.detail,
          ...(err.extra.errors ? { errors: err.extra.errors } : {}),
          trace_id: req.id,
        });
    }
    if (err instanceof ZodError) {
      return reply
        .code(422)
        .type('application/problem+json')
        .send({
          type: typeUrl(baseUrl, 'VALIDATION_FAILED'),
          title: 'Validation failed',
          status: 422,
          code: 'VALIDATION_FAILED',
          detail: 'The request is not valid.',
          errors: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          trace_id: req.id,
        });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    return reply
      .code(status)
      .type('application/problem+json')
      .send({
        type: typeUrl(baseUrl, status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED'),
        title: status >= 500 ? 'Internal error' : 'Bad request',
        status,
        code: status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED',
        detail: status >= 500 ? 'Something went wrong on our side.' : (err as Error).message,
        trace_id: req.id,
      });
  });
}
