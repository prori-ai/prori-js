import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { API_BASE, ProriClient, ProriError, ProriToolsClient, ProriToolsError, VERSION } from '../dist/index.js';

const origin = 'https://gateway.test';
const prefix = origin + '/api/v1/tools';
const apiKey = 'gateway-test-key';
const runBody = { provider: 'anyapi', endpoint: '/reddit.subreddit_search', input: { q: 'node' }, waitSeconds: 0 };

function json(value, init) {
  return new Response(JSON.stringify(value), init);
}

function scriptedFetch(...responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init, headers: new Headers(init.headers) });
    assert.ok(responses.length, `Unexpected request to ${url}`);
    return responses.shift();
  };
  return { fetch, calls };
}

test('all Gateway routes use the contract and add bearer auth only when required', async () => {
  const responses = [
    { endpointCount: 9, providerCount: 3, runnableCount: 4 },
    { items: [{ id: 'social' }] },
    { items: [{ provider: 'anyapi', endpoint: runBody.endpoint }], total: 1, cursor: null },
    { credits: 100 },
    { items: [{ endpoint: runBody.endpoint, score: 0.9 }] },
    { schema: { type: 'object' } },
    { runId: 'run #1', status: 'READY' },
    { items: [{ runId: 'run #1', status: 'RUNNING' }] },
    { runId: 'run #1', status: 'RUNNING' },
    { runId: 'run #1', status: 'STOPPED' },
  ];
  const { fetch, calls } = scriptedFetch(...responses.map((body, index) => json(body, { status: index === 6 ? 202 : 200 })));
  const tools = new ProriToolsClient({
    baseUrl: origin + '/', apiKey, fetch, headers: { Authorization: 'ignore-me', 'X-Trace': 'test' },
  });
  const discover = { query: 'reddit search', limit: 20, category: 'social' };
  const inspect = { provider: runBody.provider, endpoint: runBody.endpoint };

  assert.deepEqual([
    await tools.stats(),
    await tools.categories(),
    await tools.endpoints({ q: 'reddit /', category: 'social', provider: 'anyapi', runnable: true, cursor: 'a+b', limit: 50 }),
    await tools.balance(),
    await tools.discover(discover),
    await tools.inspect(inspect),
    await tools.run(runBody, { idempotencyKey: 'search.2026:01_a-z' }),
    await tools.listRuns({ limit: 100 }),
    await tools.getRun('run #1'),
    await tools.stopRun('run #1'),
  ], responses);
  assert.deepEqual(calls.map(({ url, method, body }) => [url.slice(prefix.length), method, body && JSON.parse(body)]), [
    ['/stats', 'GET', undefined],
    ['/categories', 'GET', undefined],
    ['/endpoints?q=reddit+%2F&category=social&provider=anyapi&runnable=true&cursor=a%2Bb&limit=50', 'GET', undefined],
    ['/balance', 'GET', undefined],
    ['/discover', 'POST', discover],
    ['/inspect', 'POST', inspect],
    ['/run', 'POST', runBody],
    ['/runs?limit=100', 'GET', undefined],
    ['/runs/run%20%231', 'GET', undefined],
    ['/runs/run%20%231/stop', 'POST', undefined],
  ]);
  for (const [index, { url, headers }] of calls.entries()) {
    assert.ok(url.startsWith(prefix));
    assert.equal(headers.get('Authorization'), index < 3 ? null : `Bearer ${apiKey}`);
    assert.equal(headers.get('X-Trace'), 'test');
    assert.equal(headers.get('Content-Type'), [4, 5, 6].includes(index) ? 'application/json' : null);
    assert.equal(headers.get('Idempotency-Key'), index === 6 ? 'search.2026:01_a-z' : null);
  }
});

test('client integration preserves catalogue behavior and exports both module formats', async () => {
  const { fetch, calls } = scriptedFetch(json({ data: [], count: 0 }), json({ credits: 10 }));
  const prori = new ProriClient({ baseUrl: origin, apiKey, fetch });
  assert.equal(prori.tools, prori.tools);
  assert.deepEqual(await prori.products({ q: 'foo' }), { data: [], count: 0 });
  assert.deepEqual(await prori.tools.balance(), { credits: 10 });
  assert.equal(calls[0].url, origin + '/api/v1/products/?q=foo');
  assert.equal(calls[0].headers.get('Authorization'), null);
  assert.equal(calls[1].url, prefix + '/balance');
  assert.equal(calls[1].headers.get('Authorization'), `Bearer ${apiKey}`);

  const require = createRequire(import.meta.url);
  const cjs = require('../dist/index.cjs');
  assert.equal(cjs.API_BASE, API_BASE);
  assert.equal(cjs.VERSION, VERSION);
  assert.equal(VERSION, '0.2.0');
  assert.equal(typeof cjs.getCommunityUsers, 'function');
  assert.equal(typeof cjs.ProriToolsClient, 'function');
  assert.ok(cjs.ProriToolsError.prototype instanceof cjs.ProriError);
});

test('Tools environment fallback and explicit overrides do not change the catalogue origin', async (t) => {
  const original = { PRORI_API_BASE: process.env.PRORI_API_BASE, PRORI_API_KEY: process.env.PRORI_API_KEY };
  t.after(() => {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.PRORI_API_BASE = origin + '/';
  process.env.PRORI_API_KEY = 'from-environment';
  const { fetch, calls } = scriptedFetch(json({}), json({}));
  const prori = new ProriClient({ fetch });
  assert.equal(prori.baseUrl, API_BASE);
  await prori.tools.balance();
  await new ProriToolsClient({ baseUrl: API_BASE, apiKey, fetch }).balance();
  assert.equal(calls[0].url, prefix + '/balance');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer from-environment');
  assert.equal(calls[1].url, API_BASE + '/api/v1/tools/balance');
  assert.equal(calls[1].headers.get('Authorization'), `Bearer ${apiKey}`);
});

test('HTTP error types and extra details survive the response', async () => {
  const cases = [
    [402, 'insufficient_credits'],
    [403, 'endpoint_not_enabled'],
    [400, 'price_unsupported'],
    [400, 'invalid_input'],
    [409, 'idempotency_conflict'],
    [409, 'run_not_stoppable'],
    [429, 'rate_limited'],
    [429, 'too_many_active_runs'],
    [429, 'daily_credit_limit_exceeded'],
    [501, 'route_not_available'],
  ];
  for (const [status, type] of cases) {
    const details = { type, message: 'Gateway explanation', retry_after: 2, info: { permitted: false } };
    const body = { detail: { error: details } };
    const { fetch, calls } = scriptedFetch(json(body, { status, headers: { 'Retry-After': '3' } }));
    await assert.rejects(new ProriToolsClient({ apiKey, fetch }).balance(), (error) => {
      assert.ok(error instanceof ProriError);
      assert.ok(error instanceof ProriToolsError);
      assert.equal(error.status, status);
      assert.equal(error.errorType, type);
      assert.equal(error.retryAfter, 3);
      assert.deepEqual(error.details, details);
      assert.deepEqual(error.body, body);
      assert.match(error.message, /Gateway explanation/);
      return true;
    });
    assert.equal(calls.length, 1);
  }
});

test('plain details, validation arrays and non-JSON 5xx have readable errors', async () => {
  const issues = [{ loc: ['body', 'target'], msg: 'Field required', type: 'missing' }];
  const { fetch } = scriptedFetch(
    json({ detail: `rejected ${apiKey}` }, { status: 401 }),
    json({ detail: issues }, { status: 422 }),
    new Response('<body>unavailable</body>', { status: 503, statusText: 'Service Unavailable' }),
  );
  const tools = new ProriToolsClient({ apiKey, fetch });
  await assert.rejects(tools.balance(), { status: 401, message: 'Prori Tools API 401: rejected [redacted]' });
  await assert.rejects(tools.inspect(runBody), { status: 422, details: issues, message: /Field required/ });
  await assert.rejects(tools.stats(), { status: 503, body: '<body>unavailable</body>', message: /Service Unavailable/ });
});

test('waitForRun respects successful Retry-After headers, body delays and rate limiting', { timeout: 3000 }, async () => {
  const done = { runId: 'test', status: 'COMPLETED', output: { ok: true } };
  const { fetch, calls } = scriptedFetch(
    json({ runId: 'test', status: 'READY' }, { status: 202, headers: { 'Retry-After': '0.05' } }),
    json({ runId: 'test', status: 'RUNNING', retry_after: 0.04 }),
    json({ detail: { error: { type: 'rate_limited', retry_after: 0.03 } } }, { status: 429 }),
    json(done),
  );
  const times = [];
  const tools = new ProriToolsClient({ baseUrl: origin, apiKey, fetch: (...args) => {
    times.push(performance.now());
    return fetch(...args);
  } });
  const started = await tools.run(runBody, { idempotencyKey: 'valid' });
  assert.deepEqual(await tools.waitForRun(started, { initialDelayMs: 1, maxDelayMs: 2 }), done);
  assert.deepEqual(calls.map(({ method, url }) => [method, url]), [
    ['POST', prefix + '/run'],
    ['GET', prefix + '/runs/test'],
    ['GET', prefix + '/runs/test'],
    ['GET', prefix + '/runs/test'],
  ]);
  for (const [index, minimum] of [45, 35, 25].entries()) {
    assert.ok(times[index + 1] - times[index] >= minimum);
  }
  assert.strictEqual(await tools.waitForRun(done), done);
});

test('waitForRun aborts promptly, and returns non-retryable failures directly', async () => {
  const { fetch, calls } = scriptedFetch(
    json({ detail: { error: { type: 'daily_credit_limit_exceeded', retry_after: 60 } } }, { status: 429 }),
  );
  const tools = new ProriToolsClient({ baseUrl: origin, apiKey, fetch });
  const controller = new AbortController();
  const pending = tools.waitForRun({ runId: 'test', status: 'RUNNING', retry_after: 60 }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls.length, 0);
  await assert.rejects(tools.waitForRun('test'), { status: 429, errorType: 'daily_credit_limit_exceeded' });
  assert.equal(calls.length, 1);
  assert.throws(() => tools.run(runBody, { idempotencyKey: '-bad' }), /Invalid idempotency key/);
});

test('presigned downloads use the exact URL and omit all Gateway credentials', async () => {
  const { fetch, calls } = scriptedFetch(new Response(new Uint8Array([0, 128, 255])));
  const tools = new ProriToolsClient({ apiKey, fetch, headers: { AUTHORIZATION: 'another-key', 'X-Token': 'private' } });
  const url = 'https://artifact.test/report?sig=a%2Bb';
  assert.deepEqual(new Uint8Array(await (await tools.downloadOutput(url)).arrayBuffer()), new Uint8Array([0, 128, 255]));
  assert.equal(calls[0].url, url);
  assert.equal(calls[0].headers.has('Authorization'), false);
  assert.equal(calls[0].headers.has('X-Token'), false);
  assert.equal(calls[0].credentials, 'omit');
});
