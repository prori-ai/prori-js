import { API_BASE, ProriError, query } from './shared.js';

const TOOLS_PATH = '/api/v1/tools';
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const RETRYABLE_POLL_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface ProriToolsClientOptions {
  /** Defaults to PRORI_API_BASE when set, then the Prori API origin. */
  baseUrl?: string;
  /** Defaults to PRORI_API_KEY when set. Only sent on authenticated routes. */
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  /** Additional Gateway headers. Excluded from presigned downloads. */
  headers?: Record<string, string>;
  /** Per-request deadline in milliseconds. Defaults to 15000, or 65000 for run(). */
  timeoutMs?: number;
}

export type ToolsJsonValue =
  | null
  | boolean
  | number
  | string
  | ToolsJsonValue[]
  | { [key: string]: ToolsJsonValue };

export interface ToolsStatsResponse {
  endpointCount: number;
  providerCount: number;
  runnableCount: number;
}

export interface ToolsCategory {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface ToolsCategoriesResponse {
  items: ToolsCategory[];
}

export interface ToolsEndpointsParams {
  q?: string;
  category?: string;
  provider?: string;
  runnable?: boolean;
  cursor?: string;
  /** 1–50. Defaults to 24 on the Gateway. */
  limit?: number;
}

export interface ToolsEndpoint {
  provider?: string;
  endpoint?: string;
  category?: string;
  runnable?: boolean;
  [key: string]: unknown;
}

export interface ToolsEndpointsResponse {
  items: ToolsEndpoint[];
  cursor: string | null;
  total: number;
}

export interface ToolsBalanceResponse {
  [key: string]: unknown;
}

export interface ToolsDiscoverRequest {
  query: string;
  /** 1–20. */
  limit?: number;
  category?: string;
}

export interface ToolsDiscoverResponse {
  items?: ToolsEndpoint[];
  [key: string]: unknown;
}

export interface ToolsInspectRequest {
  provider: string;
  endpoint: string;
  input?: ToolsJsonValue;
}

export type ToolsInspectResponse = ToolsEndpoint;

export interface ToolsRunRequest extends ToolsInspectRequest {
  input: ToolsJsonValue;
  /** 0–55 seconds to wait for a terminal result in the initial request. */
  waitSeconds?: number;
}

export interface ToolsRunOptions {
  /** Reuse this key with the same request to resume submission safely. */
  idempotencyKey: string;
}

export type ToolsRunStatus =
  | 'READY'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'STOPPED'
  | 'TIMED_OUT';

export interface ToolsRunResponse {
  runId: string;
  status: ToolsRunStatus;
  output?: ToolsJsonValue;
  outputUrl?: string | null;
  outputUrlExpiresIn?: number | null;
  retry_after?: number | string | null;
  credits?: { charged?: number | string | null; [key: string]: unknown } | null;
  providerHttpStatus?: number | null;
  providerError?: unknown;
  [key: string]: unknown;
}

export interface ToolsListRunsParams {
  /** 1–100. */
  limit?: number;
}

export interface ToolsListRunsResponse {
  items?: ToolsRunResponse[];
  [key: string]: unknown;
}

export interface ToolsWaitForRunOptions {
  /** First polling delay in milliseconds. Defaults to 500. */
  initialDelayMs?: number;
  /** Maximum exponential delay in milliseconds. Server hints can exceed it. Defaults to 8000. */
  maxDelayMs?: number;
  signal?: AbortSignal;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function seconds(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
}

function retryAfter(header: string | null, ...bodyValues: unknown[]): number | undefined {
  const hints = bodyValues.map(seconds).filter((value) => value !== undefined);
  if (header) {
    const numeric = seconds(header);
    const date = Date.parse(header);
    if (numeric !== undefined) hints.push(numeric);
    else if (Number.isFinite(date)) hints.push(Math.max(0, (date - Date.now()) / 1000));
  }
  return hints.length ? Math.max(...hints) : undefined;
}

/** HTTP error from the Tools Gateway or a presigned output download. */
export class ProriToolsError extends ProriError {
  readonly errorType?: string;
  /** Minimum time to wait before retrying, in seconds. */
  readonly retryAfter?: number;
  /** The structured Gateway error, validation issues or plain detail, when present. */
  readonly details: unknown;

  constructor(status: number, statusText: string, url: string, body: unknown, retryHeader: string | null = null) {
    super(status, statusText, url, body);
    this.name = 'ProriToolsError';

    const data = record(body);
    const detail = data?.detail;
    const error = record(record(detail)?.error);
    this.details = error ?? detail ?? body;
    this.errorType = typeof error?.type === 'string' ? error.type : undefined;
    this.retryAfter = retryAfter(retryHeader, error?.retry_after, record(detail)?.retry_after, data?.retry_after);

    let description = statusText || 'Request failed';
    if (typeof error?.message === 'string') description = error.message;
    else if (typeof detail === 'string') description = detail;
    else if (Array.isArray(detail)) {
      const messages = detail.map((issue) => record(issue)?.msg).filter((msg) => typeof msg === 'string');
      description = messages.length ? messages.join('; ') : 'Request validation failed';
    }
    const type = this.errorType ? ` (${this.errorType})` : '';
    this.message = `Prori Tools API ${status}${type}: ${description}`;
  }
}

function environment(name: string): string | undefined {
  return typeof process === 'undefined' ? undefined : process.env?.[name];
}

export function isToolsRunPending(run: ToolsRunResponse): boolean {
  return run.status === 'READY' || run.status === 'RUNNING';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Discover, inspect and run endpoints through the Prori Tools Gateway. */
export class ProriToolsClient {
  readonly baseUrl: string;
  readonly #apiKey?: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #headers: Headers;
  readonly #timeoutMs?: number;
  readonly #pollHints = new WeakMap<ToolsRunResponse, number>();

  constructor(options: ProriToolsClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? (environment('PRORI_API_BASE') || API_BASE)).replace(/\/+$/, '');
    this.#apiKey = options.apiKey ?? environment('PRORI_API_KEY')?.trim();
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== 'function') {
      throw new TypeError('No global fetch available. Pass one via `new ProriToolsClient({ fetch })`, or run Node 18+.');
    }
    this.#headers = new Headers(options.headers);
    this.#headers.delete('authorization');
    this.#headers.set('accept', 'application/json');
    this.#timeoutMs = options.timeoutMs;
  }

  stats(): Promise<ToolsStatsResponse> {
    return this.#request('/stats');
  }

  categories(): Promise<ToolsCategoriesResponse> {
    return this.#request('/categories');
  }

  endpoints(params: ToolsEndpointsParams = {}): Promise<ToolsEndpointsResponse> {
    return this.#request(`/endpoints${query({ ...params })}`);
  }

  balance(): Promise<ToolsBalanceResponse> {
    return this.#request('/balance', { authenticated: true });
  }

  discover(body: ToolsDiscoverRequest): Promise<ToolsDiscoverResponse> {
    return this.#request('/discover', { authenticated: true, body });
  }

  inspect(body: ToolsInspectRequest): Promise<ToolsInspectResponse> {
    return this.#request('/inspect', { authenticated: true, body });
  }

  run(body: ToolsRunRequest, { idempotencyKey }: ToolsRunOptions): Promise<ToolsRunResponse> {
    if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new TypeError('Invalid idempotency key.');
    }
    return this.#requestRun('/run', { authenticated: true, body, idempotencyKey });
  }

  listRuns(params: ToolsListRunsParams = {}): Promise<ToolsListRunsResponse> {
    return this.#request(`/runs${query({ ...params })}`, { authenticated: true });
  }

  getRun(runId: string): Promise<ToolsRunResponse> {
    return this.#getRun(runId);
  }

  stopRun(runId: string): Promise<ToolsRunResponse> {
    return this.#requestRun(`/runs/${encodeURIComponent(runId)}/stop`, { authenticated: true, method: 'POST' });
  }

  /** Poll a run ID or continue from a pending response. Returns the terminal result. */
  async waitForRun(run: string | ToolsRunResponse, options: ToolsWaitForRunOptions = {}): Promise<ToolsRunResponse> {
    const { signal, initialDelayMs = 500, maxDelayMs = 8000 } = options;
    const runId = typeof run === 'string' ? run : run.runId;
    let current = typeof run === 'string' ? undefined : run;
    let delay = current ? initialDelayMs : 0;
    let errorHint = 0;
    let failures = 0;

    while (!current || isToolsRunPending(current)) {
      const hint = current
        ? this.#pollHints.get(current) ?? seconds(current.retry_after) ?? seconds(current.retryAfter)
        : errorHint;
      await sleep(Math.max(delay, (hint ?? 0) * 1000), signal);
      delay = Math.min(maxDelayMs, Math.max(initialDelayMs, delay * 2));

      try {
        current = await this.#getRun(runId, signal);
        failures = 0;
      } catch (error) {
        if (
          !(error instanceof ProriToolsError) ||
          !RETRYABLE_POLL_STATUS.has(error.status) ||
          (error.status === 429 && error.errorType && error.errorType !== 'rate_limited') ||
          ++failures > 4
        ) {
          throw error;
        }
        current = undefined;
        errorHint = error.retryAfter ?? 0;
      }
    }
    return current;
  }

  /** Fetch an artifact as a Response so callers can stream or decode it. */
  async downloadOutput(outputUrl: string): Promise<Response> {
    const response = await this.#fetch(outputUrl, {
      credentials: 'omit',
      headers: { accept: '*/*' },
      // Large artifacts can stream without a deadline unless one was configured.
      signal: this.#timeoutMs === undefined ? undefined : AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) throw await this.#responseError(response, outputUrl);
    return response;
  }

  #getRun(runId: string, signal?: AbortSignal): Promise<ToolsRunResponse> {
    return this.#requestRun(`/runs/${encodeURIComponent(runId)}`, { authenticated: true, signal });
  }

  async #requestRun(path: string, options: RequestOptions): Promise<ToolsRunResponse> {
    const { data: run, retryHeader } = await this.#send<ToolsRunResponse>(path, options);
    const hint = retryAfter(retryHeader, run.retry_after, run.retryAfter);
    if (hint !== undefined) this.#pollHints.set(run, hint);
    return run;
  }

  async #request<T>(path: string, options?: RequestOptions): Promise<T> {
    return (await this.#send<T>(path, options)).data;
  }

  async #send<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<{ data: T; retryHeader: string | null }> {
    const headers = new Headers(this.#headers);
    const { authenticated, body, idempotencyKey, method = body === undefined ? 'GET' : 'POST', signal } = options;
    if (authenticated && this.#apiKey) headers.set('authorization', `Bearer ${this.#apiKey}`);
    if (body !== undefined) headers.set('content-type', 'application/json');
    if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey);

    const url = `${this.baseUrl}${TOOLS_PATH}${path}`;
    const timeout = AbortSignal.timeout(this.#timeoutMs ?? (path === '/run' ? 65_000 : 15_000));
    const controller = signal ? new AbortController() : undefined;
    const abort = () => controller?.abort(signal?.aborted ? signal.reason : timeout.reason);
    if (signal?.aborted) signal.throwIfAborted();
    signal?.addEventListener('abort', abort, { once: true });
    if (controller) timeout.addEventListener('abort', abort, { once: true });
    try {
      const response = await this.#fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
        cache: 'no-store',
        signal: controller?.signal ?? timeout,
      });
      if (!response.ok) throw await this.#responseError(response, url);
      return { data: (await response.json()) as T, retryHeader: response.headers.get('retry-after') };
    } finally {
      signal?.removeEventListener('abort', abort);
      timeout.removeEventListener('abort', abort);
    }
  }

  async #responseError(response: Response, url: string): Promise<ProriToolsError> {
    const text = await response.text().catch(() => '');
    let body: unknown = text || null;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      // Preserve a non-JSON response as text.
    }
    const error = new ProriToolsError(response.status, response.statusText, url, body, response.headers.get('retry-after'));
    if (this.#apiKey) error.message = error.message.replaceAll(this.#apiKey, '[redacted]');
    return error;
  }
}

interface RequestOptions {
  authenticated?: boolean;
  body?: ToolsDiscoverRequest | ToolsInspectRequest | ToolsRunRequest;
  idempotencyKey?: string;
  method?: 'GET' | 'POST';
  signal?: AbortSignal;
}
