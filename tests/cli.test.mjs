import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const mock = fileURLToPath(new URL('./fixtures/mock-fetch.cjs', import.meta.url));
const origin = 'https://gateway.test';
const prefix = origin + '/api/v1/tools';
const apiKey = 'cli-test-secret-123';
const target = { provider: 'anyapi', endpoint: '/reddit.subreddit_search' };

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'prori-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const credentialFile = join(dir, 'prori', 'credentials.json');
  let commandCount = 0;

  async function run(args, responses = [], { key, stdin, baseUrl = origin } = {}) {
    const log = join(dir, `requests-${++commandCount}.jsonl`);
    const env = {
      ...process.env,
      PRORI_API_BASE: baseUrl,
      PRORI_API_KEY: key ?? '',
      XDG_CONFIG_HOME: dir,
      PRORI_TEST_RESPONSES: JSON.stringify(responses),
      PRORI_TEST_REQUESTS: log,
    };
    const child = spawn(process.execPath, ['--require', mock, cli, ...args], {
      env, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => signal ? reject(new Error(`CLI terminated with ${signal}`)) : resolve(code));
      child.stdin.end(stdin);
    });
    const entries = await readFile(log, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    const calls = entries.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return { code, stdout, stderr, calls };
  }

  return { dir, credentialFile, run };
}

function result(command) {
  assert.equal(command.code, 0, command.stderr);
  assert.equal(command.stderr, '');
  return JSON.parse(command.stdout);
}

test('help, version and executable entry point', async (t) => {
  const { run } = await setup(t);
  assert.match(await readFile(cli, 'utf8'), /^#!\/usr\/bin\/env node\n/);
  if (process.platform !== 'win32') assert.ok((await stat(cli)).mode & 0o111);
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: prori <command>/);
  assert.match((await run(['run', '--help'])).stdout, /--idempotency-key/);
  assert.match((await run(['auth', 'login', '--help'])).stdout, /hidden prompt/);
  assert.equal((await run(['--version'])).stdout, '0.2.0\n');
});

test('public stats, categories and endpoints work with global flags and no auth', async (t) => {
  const { run } = await setup(t);
  const stats = { endpointCount: 4, providerCount: 2, runnableCount: 3 };
  const statsCommand = await run(['--json', 'stats', '--base-url=https://other.test/'], [{ json: stats }], { key: apiKey });
  assert.deepEqual(result(statsCommand), stats);
  assert.equal(statsCommand.calls[0].url, 'https://other.test/api/v1/tools/stats');
  assert.equal(statsCommand.calls[0].headers.authorization, undefined);
  const human = await run(['stats'], [{ json: stats }]);
  assert.equal(human.stdout, '4 endpoints · 2 providers · 3 runnable\n');
  const items = { items: [{ id: 'social', name: 'Social' }] };
  const categories = await run(['categories', '--json'], [{ json: items }]);
  assert.deepEqual(result(categories), items);
  assert.equal(categories.calls[0].url, prefix + '/categories');

  const endpoints = await run([
    'endpoints', '--q', 'reddit api', '--category', 'social', '--provider=anyapi', '--runnable',
    '--limit', '50', '--cursor', 'a+b', '--json',
  ], [{ json: { items: [target], cursor: null, total: 1 } }]);
  assert.equal(result(endpoints).total, 1);
  const url = new URL(endpoints.calls[0].url);
  assert.equal(url.pathname, '/api/v1/tools/endpoints');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    q: 'reddit api', category: 'social', provider: 'anyapi', runnable: 'true', cursor: 'a+b', limit: '50',
  });
  assert.equal(endpoints.calls[0].headers.authorization, undefined);
});

test('discover and either inspect target syntax send the documented bodies', async (t) => {
  const { dir, run } = await setup(t);
  const discovered = { items: [{ ...target, score: 0.95 }] };
  const request = await run(['discover', 'find Reddit posts', '--limit', '20', '--category', 'social', '--json'],
    [{ json: discovered }], { key: apiKey });
  assert.deepEqual(result(request), discovered);
  assert.equal(request.calls[0].url, prefix + '/discover');
  assert.deepEqual(request.calls[0].body, { query: 'find Reddit posts', limit: 20, category: 'social' });
  assert.equal(request.calls[0].headers.authorization, `Bearer ${apiKey}`);
  const file = join(dir, 'input.json');
  await writeFile(file, '{"query":"node"}');
  for (const args of [
    ['anyapi/reddit.subreddit_search', '--input', '{"query":"node"}'],
    ['anyapi', '/reddit.subreddit_search', '--input-file', file],
  ]) {
    const inspected = await run(['inspect', ...args, '--json'], [{ json: { ...target, inputSchema: {} } }], { key: apiKey });
    assert.deepEqual(result(inspected), { ...target, inputSchema: {} });
    assert.equal(inspected.calls[0].method, 'POST');
    assert.equal(inspected.calls[0].url, prefix + '/inspect');
    assert.deepEqual(inspected.calls[0].body, { ...target, input: { query: 'node' } });
  }
});

test('run polls a 202 and downloads an output URL without Authorization', async (t) => {
  const { run } = await setup(t);
  const artifact = 'https://artifact.test/result?sig=a%2Bb';
  const complete = {
    runId: 'run-1', status: 'COMPLETED', credits: { charged: 3 },
    output: null, outputUrl: artifact, outputUrlExpiresIn: 42,
  };
  const command = await run(['run', 'anyapi/reddit.subreddit_search', '--wait', '0', '--json'], [
    { status: 202, headers: { 'Retry-After': '1' }, json: { runId: 'run-1', status: 'READY' } },
    { json: complete },
    { json: { matches: ['node'] }, headers: { 'Content-Type': 'application/json' } },
  ], { key: apiKey });
  assert.deepEqual(result(command), { ...complete, output: { matches: ['node'] } });
  const [start, poll, download] = command.calls;
  assert.equal(command.calls.length, 3);
  assert.deepEqual([start.url, poll.url, download.url], [prefix + '/run', prefix + '/runs/run-1', artifact]);
  assert.equal(start.method, 'POST');
  assert.deepEqual(start.body, { ...target, input: {}, waitSeconds: 0 });
  assert.match(start.headers['idempotency-key'], /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  assert.equal(poll.headers.authorization, `Bearer ${apiKey}`);
  assert.ok(poll.at - start.at >= 950);
  assert.equal(download.headers.authorization, undefined);
});

test('no-poll returns immediately and status can stream the resulting file', async (t) => {
  const { dir, run } = await setup(t);
  const ready = { runId: 'run-1', status: 'READY' };
  const started = await run(['run', 'anyapi', target.endpoint, '--no-poll', '--idempotency-key', 'batch:check', '--json'],
    [{ status: 202, json: ready }], { key: apiKey });
  assert.deepEqual(result(started), ready);
  assert.equal(started.calls.length, 1);
  assert.equal(started.calls[0].headers['idempotency-key'], 'batch:check');

  const outputPath = join(dir, 'result.bin');
  const artifact = 'https://artifact.test/binary';
  const bytes = [0, 128, 255];
  const command = await run(['run-status', 'run-1', '--poll', '--output', outputPath], [
    { json: { runId: 'run-1', status: 'RUNNING', retry_after: 0 } },
    { json: { runId: 'run-1', status: 'COMPLETED', output: null, outputUrl: artifact, credits: { charged: 3 } } },
    { bytes, headers: { 'Content-Type': 'application/octet-stream' } },
  ], { key: apiKey });
  assert.equal(command.code, 0, command.stderr);
  assert.match(command.stdout, /COMPLETED.*credits.charged: 3/);
  assert.ok(command.stdout.includes(`Output saved to ${outputPath}`));
  assert.deepEqual([...await readFile(outputPath)], bytes);
  assert.deepEqual(command.calls.map(({ url }) => url), [prefix + '/runs/run-1', prefix + '/runs/run-1', artifact]);
  assert.equal(command.calls[2].headers.authorization, undefined);
});

test('run exits non-zero for terminal failures and provider errors, with valid JSON', async (t) => {
  const { run } = await setup(t);
  const cases = [
    { status: 'FAILED' }, { status: 'BLOCKED' }, { status: 'STOPPED' }, { status: 'TIMED_OUT' },
    { status: 'COMPLETED', providerHttpStatus: 502 },
    { status: 'COMPLETED', providerError: { message: 'Provider failed' } },
  ];
  for (const fields of cases) {
    const failure = { runId: 'run-2', credits: { charged: 0 }, ...fields };
    const command = await run(['run', 'anyapi/reddit.subreddit_search', '--json'], [{ json: failure }], { key: apiKey });
    assert.equal(command.code, 1);
    assert.deepEqual(JSON.parse(command.stdout), failure);
    assert.equal(command.calls.length, 1);
  }
});

test('runs, stop, and local argument validation', async (t) => {
  const { run } = await setup(t);
  const stopped = { status: 'STOPPED', runId: 'test:1' };
  const history = await run(['runs', '--limit', '100', '--json'], [{ json: { items: [stopped] } }], { key: apiKey });
  assert.deepEqual(result(history), { items: [stopped] });
  assert.equal(history.calls[0].url, prefix + '/runs?limit=100');
  const stop = await run(['stop', 'test:1', '--json'], [{ json: stopped }], { key: apiKey });
  assert.deepEqual(result(stop), stopped);
  assert.equal(stop.calls[0].url, prefix + '/runs/test%3A1/stop');
  assert.equal(stop.calls[0].method, 'POST');
  for (const args of [
    ['endpoints', '--limit', '51'], ['discover', 'search', '--limit', '0'], ['runs', '--limit', '101'],
    ['run', 'anyapi/reddit.subreddit_search', '--wait', '56'],
    ['run', 'anyapi/reddit.subreddit_search', '--idempotency-key', 'x'.repeat(129)],
    ['inspect', 'missing-endpoint'], ['inspect', 'anyapi/reddit.subreddit_search', '--input', 'invalid'],
  ]) {
    const command = await run(args, [], { key: apiKey });
    assert.equal(command.code, 1);
    assert.equal(command.calls.length, 0);
    assert.equal(command.stdout, '');
    assert.ok(command.stderr);
  }
});

test('login verifies before saving privately, environment takes priority, and logout removes the file', async (t) => {
  const { credentialFile, run } = await setup(t);
  const envKey = 'cli-environment-secret';
  const balance = { credits: 13 };
  const login = await run(['auth', 'login', '--stdin', '--json'], [{ json: balance }], { key: envKey, stdin: apiKey });
  assert.deepEqual(result(login), { authenticated: true, source: 'file' });
  assert.equal(login.calls[0].url, prefix + '/balance');
  assert.equal(login.calls[0].headers.authorization, `Bearer ${apiKey}`);
  assert.deepEqual(JSON.parse(await readFile(credentialFile, 'utf8')), { apiKey });
  if (process.platform !== 'win32') assert.equal((await stat(credentialFile)).mode & 0o777, 0o600);
  assert.deepEqual(result(await run(['auth', 'status', '--json'])), { authenticated: true, source: 'file' });
  assert.deepEqual(result(await run(['auth', 'status', '--json'], [], { key: envKey })),
    { authenticated: true, source: 'environment' });
  const fromFile = await run(['balance', '--json'], [{ json: balance }]);
  assert.deepEqual(result(fromFile), balance);
  assert.equal(fromFile.calls[0].headers.authorization, `Bearer ${apiKey}`);
  const fromEnv = await run(['balance', '--json'], [{ json: { apiKey: envKey } }], { key: envKey });
  assert.deepEqual(result(fromEnv), { apiKey: '[redacted]' });
  assert.equal(fromEnv.calls[0].headers.authorization, `Bearer ${envKey}`);
  const rejectedKey = 'cli-rejected-secret';
  const rejected = await run(['auth', 'login', '--stdin'], [
    { status: 401, json: { detail: `Rejected key ${rejectedKey}` } },
  ], { stdin: rejectedKey + '\n' });
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /401.*Rejected key \[redacted\]/);
  assert.deepEqual(JSON.parse(await readFile(credentialFile, 'utf8')), { apiKey });
  for (const command of [login, fromFile, fromEnv, rejected]) {
    for (const secret of [apiKey, envKey, rejectedKey]) {
      assert.equal((command.stdout + command.stderr).includes(secret), false);
    }
  }
  assert.deepEqual(result(await run(['auth', 'logout', '--json'])), { removed: true });
  await assert.rejects(stat(credentialFile), { code: 'ENOENT' });
  assert.deepEqual(result(await run(['auth', 'status', '--json'])), { authenticated: false, source: null });
});
