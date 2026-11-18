// Browser calls to /api/v1, proxied to core or agent by the rewrites in next.config.ts.
import type { Problem } from './types';

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
  }
}

export async function api<T>(
  path: string,
  init: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    idempotencyKey?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      signal: init.signal,
      headers: {
        accept: 'application/json',
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError({ type: 'about:blank', title: 'Network', status: 0, code: 'NETWORK' });
  }
  // 204 No Content (sign out, unlink): nothing to read.
  if (res.status === 204) return undefined as T;
  if (res.ok) return (await res.json()) as T;
  const problem = (await res.json().catch(() => null)) as Problem | null;
  throw new ApiError(
    problem?.code
      ? problem
      : { type: 'about:blank', title: res.statusText, status: res.status, code: 'UNKNOWN' },
  );
}

/** Customer-facing message for each problem code (architecture.md 7.4). */
export function problemMessage(p: Problem): string {
  switch (p.code) {
    case 'OUT_OF_STOCK':
      return "Un article n'est plus disponible en quantité suffisante. Ajustez votre panier.";
    case 'PRICE_CHANGED':
      return 'Le prix a changé depuis votre dernier calcul. Vérifiez le nouveau total.';
    case 'PAYMENT_UNAVAILABLE':
    case 'RATE_UNAVAILABLE':
    case 'PROVIDER_TIMEOUT':
      return 'Paiement momentanément indisponible. Réessayez dans un instant.';
    case 'TOO_MANY_PENDING_ORDERS':
      return 'Vous avez déjà des commandes en attente de paiement. Payez-les ou attendez leur expiration.';
    case 'RATE_LIMITED':
      return 'Trop de requêtes, réessayez dans un instant.';
    case 'STORE_PAUSED':
      return 'Boutique momentanément fermée.';
    case 'VALIDATION_FAILED':
      return 'Certaines informations sont incomplètes. Vérifiez le formulaire.';
    case 'NETWORK':
      return 'Pas de connexion. Vérifiez votre réseau et réessayez.';
    default:
      return "Une erreur s'est produite. Réessayez.";
  }
}
