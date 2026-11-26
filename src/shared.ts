export const API_BASE = 'https://api.bnbot.ai';

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

export function query(params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
