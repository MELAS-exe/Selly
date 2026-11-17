import type { z } from 'zod';
import { AppError } from '../errors';

function check<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value ?? {});
  if (!r.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Invalid request.',
      r.error.issues.map((i) => ({ field: i.path.join('.') || null, message: i.message })),
    );
  }
  return r.data;
}

export const parseBody = check;
export const parseQuery = check;
