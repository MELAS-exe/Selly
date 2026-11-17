// Typed client for core's internal API (architecture.md sections 5.2 G and 7.1).
// Service token with scopes, X-Request-Id, X-Actor. Reads 3 s, writes 8 s, order creation 15 s,
// one retry on network errors with the same Idempotency-Key.

import { randomUUID } from 'node:crypto';
import { CoreError } from '../errors';
import type {
  Adjustment,
  AdjustmentRequest,
  AgentProfile,
  CartQuote,
  CartQuoteRequest,
  Draft,
  DraftConfirmRequest,
  DraftUpsertRequest,
  Entitlements,
  IntrospectResponse,
  MediaUploadResult,
  Metrics,
  NotificationRequest,
  OrderCreated,
  OrderCreateRequest,
  OrderList,
  OrderStatus,
  OrderStatusView,
  ProductDetail,
  ProductPatchRequest,
  SearchQuery,
  SearchResult,
  UsageRequest,
  UsageResponse,
  VendorLookup,
  VendorProduct,
} from './types';

/** Who the call is made for, for core's audit log: `customer:<conversation id>` or `vendor:<id>`. */
export interface CallContext {
  actor?: string;
  requestId?: string;
}

export interface CoreClient {
  getVendorBySlug(slug: string, ctx?: CallContext): Promise<VendorLookup>;
  getAgentProfile(vendorId: string, ctx?: CallContext): Promise<AgentProfile>;
  getEntitlements(vendorId: string, ctx?: CallContext): Promise<Entitlements>;
  reportUsage(vendorId: string, body: UsageRequest, ctx?: CallContext): Promise<UsageResponse>;
  searchProducts(vendorId: string, q: SearchQuery, ctx?: CallContext): Promise<SearchResult>;
  getProduct(productId: string, ctx?: CallContext): Promise<ProductDetail>;
  createCartQuote(vendorId: string, body: CartQuoteRequest, ctx?: CallContext): Promise<CartQuote>;
  createOrder(
    vendorId: string,
    body: OrderCreateRequest,
    idempotencyKey: string,
    ctx?: CallContext,
  ): Promise<OrderCreated>;
  getOrder(vendorId: string, orderRef: string, ctx?: CallContext): Promise<OrderStatusView>;
  listOrders(
    vendorId: string,
    q: { status?: OrderStatus; period?: 'today' | '7d' },
    ctx?: CallContext,
  ): Promise<OrderList>;
  fulfillOrder(vendorId: string, orderRef: string, ctx?: CallContext): Promise<OrderStatusView>;
  getMetrics(vendorId: string, period: 'today' | '7d' | '30d', ctx?: CallContext): Promise<Metrics>;
  upsertDraft(vendorId: string, body: DraftUpsertRequest, ctx?: CallContext): Promise<Draft>;
  confirmDraft(
    draftId: string,
    body: DraftConfirmRequest,
    ctx?: CallContext,
  ): Promise<VendorProduct>;
  adjustStock(
    vendorId: string,
    variantId: string,
    body: AdjustmentRequest,
    idempotencyKey: string,
    ctx?: CallContext,
  ): Promise<Adjustment>;
  updateProduct(
    vendorId: string,
    productId: string,
    body: ProductPatchRequest,
    ctx?: CallContext,
  ): Promise<VendorProduct>;
  uploadMedia(bytes: Buffer, contentType: string, ctx?: CallContext): Promise<MediaUploadResult>;
  notifyVendor(vendorId: string, body: NotificationRequest, ctx?: CallContext): Promise<void>;
  introspectSession(sessionCookie: string): Promise<IntrospectResponse>;
}

const READ_MS = 3_000;
const WRITE_MS = 8_000;
const ORDER_MS = 15_000;

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  rawBody?: { bytes: Buffer; contentType: string };
  timeoutMs: number;
  idempotencyKey?: string;
  ctx?: CallContext;
}

export class HttpCoreClient implements CoreClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(opts: RequestOptions): Promise<T> {
    const url = new URL(this.baseUrl + opts.path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.serviceToken}`,
      accept: 'application/json',
      'x-request-id': opts.ctx?.requestId ?? randomUUID().replaceAll('-', ''),
    };
    if (opts.ctx?.actor) headers['x-actor'] = opts.ctx.actor;
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    let body: string | FormData | undefined;
    if (opts.rawBody) {
      const form = new FormData();
      form.set(
        'file',
        new Blob([new Uint8Array(opts.rawBody.bytes)], { type: opts.rawBody.contentType }),
      );
      body = form;
    } else if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    // Reads, and writes that carry an Idempotency-Key, are retried once on network errors.
    const retryable = opts.method === 'GET' || Boolean(opts.idempotencyKey);
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: opts.method,
          headers,
          body,
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (err) {
        if (retryable && attempt === 0) continue;
        const timeout = err instanceof Error && err.name === 'TimeoutError';
        throw new CoreError(
          timeout ? 504 : 503,
          timeout ? 'PROVIDER_TIMEOUT' : 'CORE_UNREACHABLE',
          null,
        );
      }
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      const json = text ? (JSON.parse(text) as unknown) : null;
      if (!res.ok) {
        const problem = (json ?? null) as Record<string, unknown> | null;
        const code = typeof problem?.code === 'string' ? problem.code : `HTTP_${res.status}`;
        throw new CoreError(res.status, code, problem);
      }
      return json as T;
    }
  }

  getVendorBySlug(slug: string, ctx?: CallContext) {
    return this.request<VendorLookup>({
      method: 'GET',
      path: `/internal/v1/stores/${encodeURIComponent(slug)}/vendor`,
      timeoutMs: READ_MS,
      ctx,
    });
  }
  getAgentProfile(vendorId: string, ctx?: CallContext) {
    return this.request<AgentProfile>({
      method: 'GET',
      path: `/internal/v1/vendors/${vendorId}/agent-profile`,
      timeoutMs: READ_MS,
      ctx,
    });
  }
  getEntitlements(vendorId: string, ctx?: CallContext) {
    return this.request<Entitlements>({
      method: 'GET',
      path: `/internal/v1/vendors/${vendorId}/entitlements`,
      timeoutMs: READ_MS,
      ctx,
    });
  }
  reportUsage(vendorId: string, body: UsageRequest, ctx?: CallContext) {
    return this.request<UsageResponse>({
      method: 'POST',
      path: `/internal/v1/vendors/${vendorId}/usage`,
      body,
      timeoutMs: WRITE_MS,
      ctx,
    });
  }
  searchProducts(vendorId: string, q: SearchQuery, ctx?: CallContext) {
    return this.request<SearchResult>({
      method: 'GET',
      path: `/internal/v1/vendors/${vendorId}/products/search`,
      query: { ...q },
      timeoutMs: READ_MS,
      ctx,
    });
  }
  getProduct(productId: string, ctx?: CallContext) {
    return this.request<ProductDetail>({
      method: 'GET',
      path: `/internal/v1/products/${productId}`,
      timeoutMs: READ_MS,
      ctx,
    });
  }
  createCartQuote(vendorId: string, body: CartQuoteRequest, ctx?: CallContext) {
    return this.request<CartQuote>({
      method: 'POST',
      path: `/internal/v1/vendors/${vendorId}/cart-quotes`,
      body,
      timeoutMs: WRITE_MS,
      ctx,
    });
  }
  createOrder(
    vendorId: string,
    body: OrderCreateRequest,
    idempotencyKey: string,
    ctx?: CallContext,
  ) {
    return this.request<OrderCreated>({
      method: 'POST',
      path: `/internal/v1/vendors/${vendorId}/orders`,
      body,
      idempotencyKey,
      timeoutMs: ORDER_MS,
      ctx,
    });
  }
  getOrder(vendorId: string, orderRef: string, ctx?: CallContext) {
    return this.request<OrderStatusView>({
      method: 'GET',
      path: `/internal/v1/vendors/${vendorId}/orders/${encodeURIComponent(orderRef)}`,
      timeoutMs: READ_MS,
      ctx,
    });
  }
  listOrders(
    vendorId: string,
    q: { status?: OrderStatus; period?: 'today' | '7d' },
    ctx?: CallContext,
  ) {
    return this.request<OrderList>({
      method: 'GET',
      path: `/internal/v1/vendors/${vendorId}/orders`,
      query: q,
      timeoutMs: READ_MS,
      ctx,
    });
  }
  fulfillOrder(vendorId: string, orderRef: string, ctx?: CallContext) {
    return this.request<OrderStatusView>({
      method: 'POST',
      path: `/internal/v1/vendors/${vendorId}/orders/${encodeURIComponent(orderRef)}/fulfill`,
      body: {},
      timeoutMs: WRITE_MS,
      ctx,
    });
  }
  getMetrics(vendorId: string, period: 'today' | '7d' | '30d', ctx?: CallContext) {
    return this.request<Metrics>({
      method: 'GET',
      path: `/internal/v1/vendors/${vendorId}/metrics`,
      query: { period },
      timeoutMs: READ_MS,
      ctx,
    });
  }
  upsertDraft(vendorId: string, body: DraftUpsertRequest, ctx?: CallContext) {
    return this.request<Draft>({
      method: 'POST',
      path: `/internal/v1/vendors/${vendorId}/product-drafts`,
      body,
      timeoutMs: WRITE_MS,
      ctx,
    });
  }
  confirmDraft(draftId: string, body: DraftConfirmRequest, ctx?: CallContext) {
    return this.request<VendorProduct>({
      method: 'POST',
      path: `/internal/v1/product-drafts/${draftId}/confirm`,
      body,
      timeoutMs: WRITE_MS,
      ctx,
    });
  }
  adjustStock(
    vendorId: string,
    variantId: string,
    body: AdjustmentRequest,
    idempotencyKey: string,
    ctx?: CallContext,
  ) {
    return this.request<Adjustment>({
      method: 'POST',
      path: `/internal/v1/vendors/${vendorId}/variants/${variantId}/adjustments`,
      body,
      idempotencyKey,
      timeoutMs: WRITE_MS,
      ctx,
    });
  }
  updateProduct(vendorId: string, productId: string, body: ProductPatchRequest, ctx?: CallContext) {
    return this.request<VendorProduct>({
      method: 'PATCH',
      path: `/internal/v1/vendors/${vendorId}/products/${productId}`,
      body,
      timeoutMs: WRITE_MS,
      ctx,
    });
  }
  uploadMedia(bytes: Buffer, contentType: string, ctx?: CallContext) {
    return this.request<MediaUploadResult>({
      method: 'POST',
      path: '/internal/v1/media',
      rawBody: { bytes, contentType },
      timeoutMs: WRITE_MS,
      ctx,
    });
  }
  async notifyVendor(vendorId: string, body: NotificationRequest, ctx?: CallContext) {
    await this.request<unknown>({
      method: 'POST',
      path: `/internal/v1/vendors/${vendorId}/notifications`,
      body,
      timeoutMs: WRITE_MS,
      ctx,
    });
  }
  introspectSession(sessionCookie: string) {
    return this.request<IntrospectResponse>({
      method: 'POST',
      path: '/internal/v1/sessions/introspect',
      body: { session_cookie: sessionCookie },
      timeoutMs: READ_MS,
    });
  }
}
