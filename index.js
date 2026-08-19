export const VERSION = "0.0.1";
export const HOMEPAGE = "https://prori.ai";
export const API_BASE = "https://api.bnbot.ai";

/**
 * Public daily product feed used by prori.ai.
 * @param {{ days?: number, perDay?: number, baseUrl?: string }} [opts]
 */
export async function getDailyFeed(opts = {}) {
  const days = opts.days ?? 3;
  const perDay = opts.perDay ?? 15;
  const baseUrl = (opts.baseUrl ?? API_BASE).replace(/\/$/, "");
  const url = `${baseUrl}/api/v1/products/daily-feed?days=${days}&per_day=${perDay}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Prori API ${res.status} ${res.statusText}`);
  }
  return res.json();
}
