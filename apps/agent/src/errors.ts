import { ERROR_CODES, type ErrorCode, type Problem } from '@selly/contracts';

const TITLES: Partial<Record<ErrorCode, string>> = {
  CHAT_SESSION_EXPIRED: 'Chat session expired',
  CHAT_UNAVAILABLE: 'Chat unavailable',
  STORE_PAUSED: 'Store paused',
  FEATURE_NOT_IN_PLAN: 'Feature not in plan',
  VALIDATION_FAILED: 'Validation failed',
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Not found',
  RATE_LIMITED: 'Too many requests',
  AGENT_QUOTA_EXCEEDED: 'Agent quota exceeded',
  PROVIDER_TIMEOUT: 'Provider timeout',
};

/** An error that becomes an RFC 9457 problem with a stable code (architecture.md section 7.4). */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    detail?: string,
    readonly errors?: Record<string, unknown>[],
    readonly retryAfterSeconds?: number,
  ) {
    super(detail ?? code);
    this.status = ERROR_CODES[code];
  }

  toProblem(traceId?: string): Problem {
    const slug = this.code.toLowerCase().replaceAll('_', '-');
    return {
      type: `https://selly.app/problems/${slug}`,
      title: TITLES[this.code] ?? this.code,
      status: this.status,
      code: this.code,
      ...(this.message !== this.code ? { detail: this.message } : {}),
      ...(this.errors ? { errors: this.errors } : {}),
      ...(traceId ? { trace_id: traceId } : {}),
    };
  }
}

/** An error answered by core. The tools map its code to a behaviour (section 7.4, column "Agent"). */
export class CoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly problem: Record<string, unknown> | null,
  ) {
    super(`core answered ${status} ${code}`);
  }
}
