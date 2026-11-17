// Entitlements, usage and rate limits (architecture.md sections 3.7, 7.5 and 8.4).
// Limits are enforced in core; the agent only reads entitlements and reports usage.

import type { CoreClient } from '../core/client';
import type { AgentProfile, Entitlements, UsageRequest, UsageResponse } from '../core/types';

const STALE_LIMIT_MS = 10 * 60_000;

/** Entitlements cached for `valid_for_seconds` (60 s). If core is unreachable, the last answer is used for 10 minutes. */
export class EntitlementsCache {
  private readonly entries = new Map<
    string,
    { value: Entitlements; fetchedAt: number; validMs: number }
  >();

  constructor(
    private readonly core: CoreClient,
    private readonly now: () => number = Date.now,
  ) {}

  async get(vendorId: string): Promise<Entitlements | null> {
    const hit = this.entries.get(vendorId);
    const t = this.now();
    if (hit && t - hit.fetchedAt < hit.validMs) return hit.value;
    try {
      const value = await this.core.getEntitlements(vendorId);
      this.entries.set(vendorId, {
        value,
        fetchedAt: t,
        validMs: (value.valid_for_seconds || 60) * 1000,
      });
      return value;
    } catch {
      if (hit && t - hit.fetchedAt < STALE_LIMIT_MS) return hit.value;
      return null;
    }
  }

  invalidate(vendorId: string) {
    this.entries.delete(vendorId);
  }

  /** Keeps the cached usage roughly current between two reads, after a usage report. */
  applyUsage(vendorId: string, usage: UsageResponse) {
    const hit = this.entries.get(vendorId);
    if (!hit) return;
    if (usage.metric === 'agent_turns') hit.value.usage.agent_turns = usage.used;
    else hit.value.usage.drafts = usage.used;
  }
}

export type TurnBlock =
  | { ok: true; entitlements: Entitlements }
  | {
      ok: false;
      reason: 'core_unreachable' | 'store_paused' | 'agent_disabled' | 'quota_exceeded';
    };

/** Decides whether the bot may answer this turn (section 8.2 step 2). */
export function checkTurn(ent: Entitlements | null): TurnBlock {
  if (!ent) return { ok: false, reason: 'core_unreachable' };
  if (ent.store_status !== 'active' || ent.subscription_status === 'suspended')
    return { ok: false, reason: 'store_paused' };
  if (!ent.agent_enabled) return { ok: false, reason: 'agent_disabled' };
  if (ent.usage.agent_turns >= ent.limits.agent_turns_per_month)
    return { ok: false, reason: 'quota_exceeded' };
  return { ok: true, entitlements: ent };
}

export class UsageReporter {
  constructor(
    private readonly core: CoreClient,
    private readonly cache: EntitlementsCache,
  ) {}

  /** Reports one unit; never fails the turn (usage is idempotent by reference, so a retry later is safe). */
  async report(vendorId: string, body: UsageRequest): Promise<UsageResponse | null> {
    try {
      const res = await this.core.reportUsage(vendorId, body);
      this.cache.applyUsage(vendorId, res);
      return res;
    } catch {
      return null;
    }
  }
}

/** Shop profile for the system prompt, cached 60 seconds (section 8.2 step 5). */
export class ProfileCache {
  private readonly entries = new Map<string, { value: AgentProfile; at: number }>();
  constructor(
    private readonly core: CoreClient,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async get(vendorId: string): Promise<AgentProfile> {
    const hit = this.entries.get(vendorId);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    try {
      const value = await this.core.getAgentProfile(vendorId);
      this.entries.set(vendorId, { value, at: this.now() });
      return value;
    } catch (err) {
      if (hit) return hit.value;
      throw err;
    }
  }

  invalidate(vendorId: string) {
    this.entries.delete(vendorId);
  }
}

/** A sliding-window counter per key, in memory (one agent instance in the MVP). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit and returns whether it is allowed, with the seconds to wait when it is not. */
  take(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      const oldest = list[0] ?? t;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - t) / 1000)),
      };
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 50_000) this.sweep(t);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private sweep(t: number) {
    for (const [k, v] of this.hits) if (v.every((x) => t - x >= this.windowMs)) this.hits.delete(k);
  }
}
