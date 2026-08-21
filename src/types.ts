/**
 * Response shapes for the public Prori API.
 *
 * These mirror the payloads prori.ai itself renders, so a field present here
 * is a field the site depends on. Anything the API may omit is optional or
 * nullable rather than guessed at.
 */

export interface ProductMaker {
  name: string;
  headline?: string | null;
  avatar?: string | null;
  twitter?: string | null;
}

export interface Product {
  id: string;
  owner_id: string;
  name: string;
  slug: string | null;
  tagline: string;
  description: string | null;
  website_url: string | null;
  logo_url: string | null;
  banner_url: string | null;
  screenshots: string[];
  categories: string[];
  video_url: string | null;
  twitter_handle: string | null;
  github_url: string | null;
  makers: ProductMaker[];
  upvote_count: number;
  comment_count: number;
  promotion_count: number;
  rating: number | null;
  featured_at: string | null;
  external_source: string | null;
  source_url: string | null;
  status: 'draft' | 'active' | 'archived';
  created_at: string;
  updated_at: string;
  owner_name: string | null;
  owner_avatar: string | null;
}

export interface ProductsResponse {
  data: Product[];
  count: number;
}

export interface ProductListParams {
  /** Free-text search across name / tagline / description. */
  q?: string;
  /** A topic name as returned by `topics()`, e.g. `"Developer Tools"`. */
  category?: string;
  status?: 'draft' | 'active' | 'archived';
  sort_by?: 'created_at' | 'upvote_count' | 'promotion_count';
  sort_order?: 'asc' | 'desc';
  skip?: number;
  limit?: number;
}

export interface ProductComment {
  id: string;
  product_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  user_name: string | null;
  user_avatar: string | null;
}

export interface ProductCommentsResponse {
  data: ProductComment[];
  count: number;
}

export interface DailyFeedDay {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Total launches that day, which can exceed `products.length`. */
  total: number;
  products: Product[];
}

export interface DailyFeedResponse {
  days: DailyFeedDay[];
}

export type LeaderboardPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface LeaderboardParams {
  period: LeaderboardPeriod;
  /** Required by the API for every period. */
  year: number;
  month?: number;
  day?: number;
  week?: number;
  limit?: number;
  skip?: number;
}

export interface LeaderboardResponse {
  start: string;
  end: string;
  total: number;
  products: Product[];
}

export interface TopicItem {
  name: string;
  count: number;
}

export type PromotePlatform =
  | 'twitter'
  | 'tiktok'
  | 'reddit'
  | 'instagram'
  | 'youtube'
  | 'xiaohongshu'
  | 'pinterest';

export type PromoteTaskStatus = 'draft' | 'active' | 'ended' | 'cancelled';

/**
 * A promotion campaign. Budget fields are decimal strings in USDC, not numbers —
 * they come off-chain from amounts held in on-chain integer units, so parsing
 * them as floats loses precision.
 */
export interface Campaign {
  id: string;
  product_id?: string | null;
  sponsor_id: string;
  sponsor_name?: string;
  sponsor_avatar?: string;
  title: string;
  description: string;
  requirements: string;
  platform: PromotePlatform;
  content_type: 'post';
  total_budget: string;
  total_distributed: string;
  executor_pool_pct: number;
  verifier_pool_pct: number;
  platform_fee_pct: number;
  current_round: number;
  min_verifications: number;
  pass_threshold: number;
  duration_days: number;
  media_urls: string[];
  status: PromoteTaskStatus;
  start_time: string | null;
  end_time: string | null;
  submission_deadline: string | null;
  submission_count: number;
  approved_count: number;
  payment_method: string | null;
  created_at: string;
}

export interface CampaignListParams {
  status?: PromoteTaskStatus;
  platform?: PromotePlatform;
  limit?: number;
  skip?: number;
}

export interface CampaignsResponse {
  data: Campaign[];
  count?: number;
}

export interface ProfileComment {
  body: string;
  created_at: string;
  product: { id: string; name: string; logo_url: string | null };
}

export interface ProfileResponse {
  user: {
    id: string;
    full_name: string;
    avatar: string | null;
    x_username: string | null;
    created_at: string | null;
  };
  stats: { upvotes: number; comments: number; products: number };
  points: { month: number; year: number; all: number; streak: number };
  badges: { key: string; emoji: string; rarity?: string }[];
  upvoted: Product[];
  products: Product[];
  comments: ProfileComment[];
}

export interface CommunityUser {
  id: string;
  full_name: string;
  avatar: string | null;
  x_username: string | null;
  points: number;
}
