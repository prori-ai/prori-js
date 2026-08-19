export const VERSION: string;
export const HOMEPAGE: string;
export const API_BASE: string;

export interface DailyFeedOptions {
  days?: number;
  perDay?: number;
  baseUrl?: string;
}

export declare function getDailyFeed(opts?: DailyFeedOptions): Promise<unknown>;
