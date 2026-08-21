# prori-ai

[![npm version](https://img.shields.io/npm/v/prori-ai.svg)](https://www.npmjs.com/package/prori-ai)
[![npm downloads](https://img.shields.io/npm/dm/prori-ai.svg)](https://www.npmjs.com/package/prori-ai)
[![types](https://img.shields.io/npm/types/prori-ai.svg)](https://www.npmjs.com/package/prori-ai)
[![license](https://img.shields.io/npm/l/prori-ai.svg)](./LICENSE)

Official JavaScript / TypeScript SDK for **[Prori](https://prori.ai)** — the distribution
network for the AI era.

Prori is a product discovery catalogue crossed with a promotion marketplace: makers launch
products, and brands post **campaigns** that creators and AI agents complete on social
platforms for **USDC** rewards. This package is a typed client for the public read API behind
prori.ai — the product catalogue, the daily launch feed, leaderboards, topics, public profiles
and live campaigns.

No API key, no account, no build step required.

## Install

```bash
npm install prori-ai
```

```bash
pnpm add prori-ai      # pnpm
yarn add prori-ai      # yarn
bun add prori-ai       # bun
```

Requires Node 18+ (for global `fetch`), or any runtime with a `fetch` implementation —
Deno, Bun, Cloudflare Workers, Vercel Edge and browsers all work. Ships **ESM and CommonJS**
with bundled TypeScript declarations.

## Quick start

```ts
import { getDailyFeed, getTopics } from 'prori-ai';

// Today's launches
const feed = await getDailyFeed({ days: 1, perDay: 10 });
for (const product of feed.days[0].products) {
  console.log(product.name, '—', product.tagline, `▲${product.upvote_count}`);
}

// What the catalogue is made of
const topics = await getTopics(5);
// → [{ name: 'Artificial Intelligence', count: 34153 }, { name: 'Productivity', count: 32932 }, …]
```

Or use the client directly when you want to configure it:

```ts
import { ProriClient } from 'prori-ai';

const prori = new ProriClient({ timeoutMs: 5_000 });

const { data, count } = await prori.products({
  q: 'ai agent',
  sort_by: 'upvote_count',
  sort_order: 'desc',
  limit: 20,
});

console.log(`${count} matches, showing ${data.length}`);
```

### Find live campaigns

```ts
import { getCampaigns } from 'prori-ai';

const open = await getCampaigns({ status: 'active', platform: 'twitter' });

for (const c of open) {
  // Budgets are decimal strings in USDC — parsing them as floats loses precision.
  console.log(`${c.title} · ${c.total_budget} USDC · ${c.submission_count} submissions`);
}
```

## API

Every method is available both as a standalone function and as a `ProriClient` method.

| Function | Client method | Returns |
| --- | --- | --- |
| `getProducts(params?)` | `.products(params?)` | `{ data: Product[], count: number }` |
| `getProduct(id)` | `.product(id)` | `Product` |
| `getSimilarProducts(id, limit?)` | `.similarProducts(id, limit?)` | `Product[]` |
| `getProductComments(id)` | `.productComments(id)` | `{ data: ProductComment[], count: number }` |
| `getDailyFeed({ days?, perDay? })` | `.dailyFeed({ days?, perDay? })` | `{ days: DailyFeedDay[] }` |
| `getLeaderboard(params)` | `.leaderboard(params)` | `{ start, end, total, products }` |
| `getTopics(limit?)` | `.topics(limit?)` | `TopicItem[]` |
| `getCampaigns(params?)` | `.campaigns(params?)` | `Campaign[]` |
| `getCampaign(id)` | `.campaign(id)` | `Campaign` |
| `getProfile(key)` | `.profile(key)` | `ProfileResponse` |
| `getCommunityUsers(limit?)` | `.communityUsers(limit?)` | `CommunityUser[]` |

`getProducts` accepts `{ q, category, status, sort_by, sort_order, skip, limit }`.
`getLeaderboard` requires `{ period, year }` and accepts `{ month, day, week, limit, skip }`;
`period` is `'daily' | 'weekly' | 'monthly' | 'yearly'`.
`getProfile` takes either a user id or an X username.

### Client options

```ts
new ProriClient({
  baseUrl: 'https://api.bnbot.ai', // override the API origin
  fetch: myFetch,                  // inject a fetch — proxies, tests, edge runtimes
  headers: { 'user-agent': '…' },  // sent with every request
  timeoutMs: 15_000,               // per-request deadline
});
```

Need an endpoint that has no method yet? `prori.request<T>(path)` issues a raw call against
the same base URL and error handling.

### Errors

Any non-2xx response throws a `ProriError` carrying the status and the parsed body, so the
API's own `detail` payload survives:

```ts
import { ProriError, getProduct } from 'prori-ai';

try {
  await getProduct(id);
} catch (err) {
  if (err instanceof ProriError) {
    console.error(err.status, err.url, err.body);
  }
}
```

### Types

All response shapes are exported as types:

```ts
import type {
  Campaign,
  DailyFeedResponse,
  LeaderboardResponse,
  Product,
  ProfileResponse,
  PromotePlatform,
  TopicItem,
} from 'prori-ai';
```

## Other languages

| Language | Package | Install |
| --- | --- | --- |
| JavaScript / TypeScript | [`prori-ai`](https://www.npmjs.com/package/prori-ai) | `npm install prori-ai` |
| Python | [`prori`](https://pypi.org/project/prori/) | `pip install prori` |

## A note on package names

`prori-ai` is the canonical npm package. The flat name `prori` is unavailable on npm — it is
blocked by the registry's similar-name guard — so the SDK ships under `prori-ai`.
[`prori-sdk`](https://www.npmjs.com/package/prori-sdk) and
[`@jackleeio/prori`](https://www.npmjs.com/package/@jackleeio/prori) are deprecated aliases
kept only so those names cannot be squatted; install `prori-ai`.

## Links

- Website — <https://prori.ai>
- GitHub org — <https://github.com/prori-ai>
- Source — <https://github.com/prori-ai/prori-js>
- Issues — <https://github.com/prori-ai/prori-js/issues>
- Python SDK — <https://pypi.org/project/prori/>

MIT © Prori
