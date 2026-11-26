# prori-ai

[![npm version](https://img.shields.io/npm/v/prori-ai.svg)](https://www.npmjs.com/package/prori-ai)
[![npm downloads](https://img.shields.io/npm/dm/prori-ai.svg)](https://www.npmjs.com/package/prori-ai)
[![types](https://img.shields.io/npm/types/prori-ai.svg)](https://www.npmjs.com/package/prori-ai)
[![license](https://img.shields.io/npm/l/prori-ai.svg)](./LICENSE)

Official JavaScript / TypeScript SDK for **[Prori](https://prori.ai)**.

Prori (`prori.ai`) connects brands, creators, and AI agents to grow great products. This
package is a typed client for the public read API behind prori.ai (product catalogue,
daily launch feed, leaderboards, topics, public profiles, and live creator campaigns), and
includes the **Prori Tools Gateway** SDK and `prori` CLI to discover, inspect, and run
third-party API endpoints.

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

## Tools Gateway CLI

The CLI requires Node 18 or later.

```bash
npm install -g prori-ai
prori --help

# Run without a global install
npx prori-ai --help
```

Explore the public catalog, then authenticate to discover by intent, inspect or execute endpoints.

```bash
prori stats
prori categories --json
prori endpoints --q reddit --runnable --limit 10
prori auth login
prori discover 'search Reddit posts' --limit 5 --json
prori inspect anyapi/reddit.subreddit_search --json
prori run anyapi /reddit.subreddit_search --input-file input.json --wait 10 --json
```

`prori auth login` hides key entry in a terminal and verifies the key against the balance endpoint.
For scripts, pipe a key from a secret store to `prori auth login --stdin`, or supply `PRORI_API_KEY`
in the process environment. The environment takes precedence over saved credentials.
Credentials are stored with mode `0600` in `$XDG_CONFIG_HOME/prori/credentials.json` or
`~/.config/prori/credentials.json` when `XDG_CONFIG_HOME` is unset. `auth status` reports the
configured source, and `auth logout` removes the saved file.

| Command | Options and behavior |
| --- | --- |
| `auth login`, `auth status`, `auth logout` | Login accepts `--stdin`. |
| `balance` | Show your Gateway credit balance. |
| `stats`, `categories` | Read public counts and category metadata. |
| `endpoints` | `--q <text>`, `--category <id>`, `--provider <name>`, `--runnable`, `--limit <1–50>`, `--cursor <c>`. Defaults to 24 endpoints per page. |
| `discover <query>` | `--limit <1–20>`, `--category <id>`. Quote multi-word queries. |
| `inspect <target> [endpoint]` | `--input <json>` or `--input-file <path>`. |
| `run <target> [endpoint]` | `--input <json>` or `--input-file <path>`, `--wait <0–55>`, `--no-poll`, `--idempotency-key <key>`, `--output <path>`. |
| `runs` | `--limit <1–100>`. |
| `status <runId>` | `--poll`, `--output <path>`. Also available as `run-status`. |
| `stop <runId>` | Request cancellation of an active run. |

Both `anyapi/reddit.subreddit_search` and `anyapi /reddit.subreddit_search` resolve to the same
endpoint. Use `prori <command> --help` for usage, and `prori --version` for the installed version.
Use `--json` for compact JSON on stdout. Override the default Gateway origin
(`https://api.bnbot.ai`) with `PRORI_API_BASE` or `--base-url <url>`. The flag takes precedence.

`run` generates a UUIDv4 idempotency key. Pass your own key to reuse it for the same submission
after a timeout or interruption. Pending runs are polled until terminal unless you pass
`--no-poll`. With `--no-poll`, use the returned run ID with `prori status <runId> --poll`.
The terminal summary includes `credits.charged`. A failed terminal status or provider error
sets a nonzero exit code for `run` and `status`.

Use `--output <path>` to save inline output as JSON or stream a presigned artifact to disk.
Otherwise, the CLI includes the downloaded value in `output` for JSON or text artifacts.
Binary downloads are represented as a base64 string with `outputEncoding: "base64"`.
Presigned downloads omit the Gateway Authorization header.

## Tools Gateway SDK

```ts
import { randomUUID } from 'node:crypto';
import { ProriToolsClient, ProriToolsError } from 'prori-ai';

const tools = new ProriToolsClient(); // Reads PRORI_API_KEY and PRORI_API_BASE in Node
const target = { provider: 'anyapi', endpoint: '/reddit.subreddit_search' };

try {
  const info = await tools.inspect(target);
  console.log(info);
  const started = await tools.run(
    { ...target, input: { query: 'typescript' }, waitSeconds: 5 },
    { idempotencyKey: randomUUID() },
  );
  const run = await tools.waitForRun(started);
  if (run.output === null && run.outputUrl) {
    const artifact = await tools.downloadOutput(run.outputUrl);
    console.log(await artifact.text());
  } else {
    console.log(run.status, run.credits?.charged, run.output);
  }
} catch (error) {
  if (!(error instanceof ProriToolsError)) throw error;
  console.error(error.status, error.errorType, error.retryAfter, error.details);
}
```

| SDK methods | Purpose |
| --- | --- |
| `stats()`, `categories()`, `endpoints(params?)` | Public counts, category metadata and filtered catalog pages. |
| `balance()`, `discover(request)`, `inspect(request)` | Credits, intent-based search, and endpoint metadata. |
| `run(request, { idempotencyKey })` | Submit an endpoint call and receive a pending or terminal run. |
| `listRuns(params?)`, `getRun(runId)`, `stopRun(runId)` | Run history, status and cancellation. |
| `waitForRun(runOrId, options?)` | Poll with exponential backoff and server retry hints. Accepts an `AbortSignal`. |
| `downloadOutput(outputUrl)` | Return a Fetch `Response` for streaming or decoding an artifact. |

Pass `{ apiKey, baseUrl, fetch, timeoutMs }` to configure the client, or use
`new ProriClient({ apiKey }).tools` alongside the public catalogue methods. The SDK uses
options and environment variables for credentials. The CLI also supports its saved credentials file.
Request and response types are exported from `prori-ai`. HTTP failures throw
`ProriToolsError`, a `ProriError` with the Gateway error type, retry delay in seconds and parsed details.

## Quick start

The public catalogue and campaign methods require no API key.

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
