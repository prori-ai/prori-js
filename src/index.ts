import { API_BASE, ProriClient } from './client.js';
import type {
  Campaign,
  CampaignListParams,
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

export { API_BASE, HOMEPAGE, ProriClient, ProriError, VERSION } from './client.js';
export type { ProriClientOptions } from './client.js';
export type * from './types.js';

/**
 * Shared client backing the module-level helpers. Created on first use so
 * importing this package never touches the network or requires `fetch` to
 * exist until a call is actually made.
 */
let shared: ProriClient | undefined;

function defaultClient(baseUrl?: string): ProriClient {
  if (baseUrl && baseUrl.replace(/\/$/, '') !== API_BASE) {
    // A one-off origin must not become the shared default for later calls.
    return new ProriClient({ baseUrl });
  }
  shared ??= new ProriClient();
  return shared;
}

/** Search and page through the product catalogue. */
export function getProducts(
  params: ProductListParams & { baseUrl?: string } = {},
): Promise<ProductsResponse> {
  const { baseUrl, ...rest } = params;
  return defaultClient(baseUrl).products(rest);
}

/** One product by id. */
export function getProduct(id: string, options: { baseUrl?: string } = {}): Promise<Product> {
  return defaultClient(options.baseUrl).product(id);
}

/** Products the catalogue considers similar to `id`. */
export function getSimilarProducts(
  id: string,
  limit = 5,
  options: { baseUrl?: string } = {},
): Promise<Product[]> {
  return defaultClient(options.baseUrl).similarProducts(id, limit);
}

/** Comment thread on a product. */
export function getProductComments(
  id: string,
  options: { baseUrl?: string } = {},
): Promise<ProductCommentsResponse> {
  return defaultClient(options.baseUrl).productComments(id);
}

/** The launch feed powering prori.ai's homepage, newest day first. */
export function getDailyFeed(
  options: { days?: number; perDay?: number; baseUrl?: string } = {},
): Promise<DailyFeedResponse> {
  return defaultClient(options.baseUrl).dailyFeed(options);
}

/** Top products for a day, week, month or year. `year` is always required. */
export function getLeaderboard(
  params: LeaderboardParams & { baseUrl?: string },
): Promise<LeaderboardResponse> {
  const { baseUrl, ...rest } = params;
  return defaultClient(baseUrl).leaderboard(rest);
}

/** Topic list with product counts, most populated first. */
export function getTopics(limit = 30, options: { baseUrl?: string } = {}): Promise<TopicItem[]> {
  return defaultClient(options.baseUrl).topics(limit);
}

/** Promotion campaigns. Pass `{ status: 'active' }` for ones still accepting work. */
export function getCampaigns(
  params: CampaignListParams & { baseUrl?: string } = {},
): Promise<Campaign[]> {
  const { baseUrl, ...rest } = params;
  return defaultClient(baseUrl).campaigns(rest);
}

/** One campaign by id. */
export function getCampaign(id: string, options: { baseUrl?: string } = {}): Promise<Campaign> {
  return defaultClient(options.baseUrl).campaign(id);
}

/** A public profile by user id or X username. */
export function getProfile(
  key: string,
  options: { baseUrl?: string } = {},
): Promise<ProfileResponse> {
  return defaultClient(options.baseUrl).profile(key);
}

/** Community members ranked by points. */
export function getCommunityUsers(
  limit = 30,
  options: { baseUrl?: string } = {},
): Promise<CommunityUser[]> {
  return defaultClient(options.baseUrl).communityUsers(limit);
}
