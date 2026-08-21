import type {
  Campaign,
  CampaignListParams,
  CampaignsResponse,
  CommunityUser,
  DailyFeedResponse,
  LeaderboardParams,
  LeaderboardResponse,
  Product,
  ProductCommentsResponse,
  ProductListParams,
  ProductsResponse,
  ProfileResponse,
  TopicItem,
} from './types.js';

export const VERSION = '0.1.0';
export const HOMEPAGE = 'https://prori.ai';
export const API_BASE = 'https://api.bnbot.ai';

/** Default per-request deadline. Public endpoints are cached and should be fast. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Retry attempts after the first, for transient failures only. */
const DEFAULT_RETRIES = 2;

/**
 * The catalogue sits behind an autoscaler that sheds load with 503 while it
 * wakes, so a first call from a cold client can fail for reasons that have
 * nothing to do with the request. These statuses are worth another attempt;
 * a 4xx never is.
 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Honour `Retry-After` when the server sends one, otherwise back off exponentially. */
function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 20_000);
  }
  return 300 * 2 ** attempt;
}

export interface ProriClientOptions {
  /** Override the API origin. Defaults to {@link API_BASE}. */
  baseUrl?: string;
  /** Inject a `fetch` implementation — useful for tests, proxies and edge runtimes. */
  fetch?: typeof globalThis.fetch;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
  /** Per-request deadline in milliseconds. Defaults to 15000. */
  timeoutMs?: number;
  /**
   * Extra attempts after a transient failure (429/5xx or a network error).
   * Defaults to 2. Set to 0 to fail fast.
   */
  retries?: number;
}

/**
 * Thrown for any non-2xx response. Carries the parsed body when the API
 * returned JSON, so FastAPI's `detail` payload survives the round trip.
 */
export class ProriError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;

  constructor(status: number, statusText: string, url: string, body: unknown) {
    super(`Prori API ${status} ${statusText} — ${url}`);
    this.name = 'ProriError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * Client for the public (unauthenticated) Prori API.
 *
 * ```ts
 * const prori = new ProriClient();
 * const feed = await prori.dailyFeed({ days: 3 });
 * ```
 */
export class ProriClient {
  readonly baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #headers: Record<string, string>;
  readonly #timeoutMs: number;
  readonly #retries: number;

  constructor(options: ProriClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? API_BASE).replace(/\/$/, '');
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#headers = { accept: 'application/json', ...options.headers };
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#retries = Math.max(0, options.retries ?? DEFAULT_RETRIES);

    if (typeof this.#fetch !== 'function') {
      throw new TypeError(
        'No global fetch available. Pass one via `new ProriClient({ fetch })`, or run Node 18+.',
      );
    }
  }

  /**
   * Issue a raw request against the API and parse the JSON body, retrying
   * transient failures. Use this for endpoints without a dedicated method.
   */
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    // A caller-supplied signal owns cancellation outright — retrying past an
    // abort the caller asked for would ignore them.
    const callerAborts = init.signal !== undefined;
    const attempts = callerAborts ? 1 : this.#retries + 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt++) {
      let res: Response;
      try {
        res = await this.#fetch(url, {
          ...init,
          headers: { ...this.#headers, ...(init.headers as Record<string, string> | undefined) },
          signal: init.signal ?? AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (error) {
        lastError = error;
        if (attempt === attempts - 1) throw error;
        await sleep(backoffMs(attempt, null));
        continue;
      }

      if (res.ok) return (await res.json()) as T;

      // A JSON error body is the useful case; anything else is best-effort text.
      let body: unknown = null;
      try {
        body = await res.clone().json();
      } catch {
        body = await res.text().catch(() => null);
      }
      lastError = new ProriError(res.status, res.statusText, url, body);

      if (!RETRYABLE_STATUS.has(res.status) || attempt === attempts - 1) throw lastError;
      await sleep(backoffMs(attempt, res.headers.get('retry-after')));
    }

    throw lastError;
  }

  // ── Products ────────────────────────────────────────────────────

  /** Search and page through the product catalogue. */
  products(params: ProductListParams = {}): Promise<ProductsResponse> {
    return this.request<ProductsResponse>(`/api/v1/products/${query({ ...params })}`);
  }

  /** One product by id. */
  product(id: string): Promise<Product> {
    return this.request<Product>(`/api/v1/products/${encodeURIComponent(id)}`);
  }

  /** Products the catalogue considers similar to `id`. */
  async similarProducts(id: string, limit = 5): Promise<Product[]> {
    const res = await this.request<{ data?: Product[] }>(
      `/api/v1/products/${encodeURIComponent(id)}/similar${query({ limit })}`,
    );
    return res.data ?? [];
  }

  /** Comment thread on a product. */
  productComments(id: string): Promise<ProductCommentsResponse> {
    return this.request<ProductCommentsResponse>(
      `/api/v1/products/${encodeURIComponent(id)}/comments`,
    );
  }

  /** The launch feed powering prori.ai's homepage, newest day first. */
  dailyFeed(options: { days?: number; perDay?: number } = {}): Promise<DailyFeedResponse> {
    return this.request<DailyFeedResponse>(
      `/api/v1/products/daily-feed${query({
        days: options.days ?? 3,
        per_day: options.perDay ?? 15,
      })}`,
    );
  }

  /** Top products for a day, week, month or year. `year` is always required. */
  leaderboard(params: LeaderboardParams): Promise<LeaderboardResponse> {
    return this.request<LeaderboardResponse>(`/api/v1/products/leaderboard${query({ ...params })}`);
  }

  /** Topic list with product counts, most populated first. */
  async topics(limit = 30): Promise<TopicItem[]> {
    const res = await this.request<{ topics?: TopicItem[] }>(
      `/api/v1/products/topics${query({ limit })}`,
    );
    return res.topics ?? [];
  }

  // ── Campaigns ───────────────────────────────────────────────────

  /** Promotion campaigns. Pass `{ status: 'active' }` for ones still accepting work. */
  async campaigns(params: CampaignListParams = {}): Promise<Campaign[]> {
    const res = await this.request<CampaignsResponse>(`/api/v1/promote/${query({ ...params })}`);
    return res.data ?? [];
  }

  /** One campaign by id. */
  campaign(id: string): Promise<Campaign> {
    return this.request<Campaign>(`/api/v1/promote/${encodeURIComponent(id)}`);
  }

  // ── Profiles ────────────────────────────────────────────────────

  /** A public profile by user id or X username. */
  profile(key: string): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(`/api/v1/profiles/${encodeURIComponent(key)}`);
  }

  /** Community members ranked by points. */
  async communityUsers(limit = 30): Promise<CommunityUser[]> {
    const res = await this.request<{ users?: CommunityUser[] }>(
      `/api/v1/profiles/${query({ limit })}`,
    );
    return res.users ?? [];
  }
}
