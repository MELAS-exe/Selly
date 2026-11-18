import { z } from 'zod';

// Stable error codes: docs/architecture.md section 7.4 and docs/api.json.
export const ERROR_CODES = {
  OUT_OF_STOCK: 409,
  PRICE_CHANGED: 409,
  PAYMENT_UNAVAILABLE: 503,
  RATE_UNAVAILABLE: 503,
  INVOICE_EXPIRED: 410,
  TOO_MANY_PENDING_ORDERS: 429,
  VALIDATION_FAILED: 422,
  UNAUTHORIZED: 401,
  STEP_UP_REQUIRED: 403,
  CHALLENGE_INVALID: 401,
  CHAT_SESSION_EXPIRED: 401,
  STORE_PAUSED: 403,
  ORDERS_NOT_OPEN: 403,
  CHAT_UNAVAILABLE: 403,
  PLAN_LIMIT_REACHED: 409,
  FEATURE_NOT_IN_PLAN: 403,
  DOWNGRADE_NOT_ALLOWED_YET: 409,
  TRIAL_ALREADY_USED: 409,
  AGENT_QUOTA_EXCEEDED: 429,
  NWC_URI_INVALID: 422,
  NWC_PERMISSIONS_TOO_BROAD: 422,
  NWC_METHODS_MISSING: 422,
  NWC_TIMEOUT: 504,
  NWC_WALLET_ERROR: 422,
  PROVIDER_TIMEOUT: 504,
  IDEMPOTENCY_MISMATCH: 422,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  REQUEST_IN_PROGRESS: 409,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** RFC 9457 problem details with a stable code. */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  errors: z.array(z.record(z.string(), z.unknown())).optional(),
  trace_id: z.string().optional(),
});
export type Problem = z.infer<typeof ProblemSchema>;
