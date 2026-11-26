import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { VERSION } from './client.js';
import { API_BASE } from './shared.js';
import { isToolsRunPending, ProriToolsClient } from './tools.js';
import type { ToolsInspectRequest, ToolsJsonValue, ToolsRunResponse } from './tools.js';

const GLOBAL_FLAGS = ['help', 'version', 'json', 'base-url'];
const VALUE_FLAGS = new Set([
  'base-url', 'q', 'category', 'provider', 'limit', 'cursor', 'input', 'input-file',
  'wait', 'idempotency-key', 'output',
]);
const COMMANDS: Record<string, { usage: string; flags: string[] }> = {
  auth: { usage: 'auth <login|status|logout>', flags: [] },
  'auth login': { usage: 'auth login [--stdin]', flags: ['stdin'] },
  'auth status': { usage: 'auth status', flags: [] },
  'auth logout': { usage: 'auth logout', flags: [] },
  balance: { usage: 'balance', flags: [] },
  stats: { usage: 'stats', flags: [] },
  categories: { usage: 'categories', flags: [] },
  endpoints: {
    usage: 'endpoints [--q <text>] [--category <id>] [--provider <name>] [--runnable] [--limit <1-50>] [--cursor <c>]',
    flags: ['q', 'category', 'provider', 'runnable', 'limit', 'cursor'],
  },
  discover: { usage: 'discover <query> [--limit <1-20>] [--category <id>]', flags: ['limit', 'category'] },
  inspect: { usage: 'inspect <target> [endpoint] [--input <json> | --input-file <path>]', flags: ['input', 'input-file'] },
  run: {
    usage: 'run <target> [endpoint] [--input <json> | --input-file <path>]\n'
      + '         [--wait <0-55>] [--no-poll] [--idempotency-key <key>] [--output <path>]',
    flags: ['input', 'input-file', 'wait', 'no-poll', 'idempotency-key', 'output'],
  },
  runs: { usage: 'runs [--limit <1-100>]', flags: ['limit'] },
  status: { usage: 'status <runId> [--poll] [--output <path>]', flags: ['poll', 'output'] },
  stop: { usage: 'stop <runId>', flags: [] },
};
const KNOWN_FLAGS = new Set([...GLOBAL_FLAGS, ...Object.values(COMMANDS).flatMap(({ flags }) => flags)]);
const FAILED_STATUSES = new Set(['FAILED', 'BLOCKED', 'STOPPED', 'TIMED_OUT']);
const envKey = process.env.PRORI_API_KEY?.trim();
const secrets = new Set<string>();
if (envKey) secrets.add(envKey);

type Options = Map<string, string | true>;

function redact(text: string): string {
  const values = [...secrets].flatMap((key) => [key, JSON.stringify(key).slice(1, -1)]);
  for (const value of values.sort((a, b) => b.length - a.length)) {
    text = text.replaceAll(value, '[redacted]');
  }
  return text;
}

function print(text: string): void {
  process.stdout.write(`${redact(text)}\n`);
}

function redactJson(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redactJson(item)]));
  }
  return value;
}

function printJson(value: unknown, compact: boolean): void {
  const data = secrets.size ? redactJson(value) : value;
  process.stdout.write(`${JSON.stringify(data, null, compact ? undefined : 2)}\n`);
}

function help(command?: string): void {
  const lines = command
    ? [`Usage: prori ${COMMANDS[command]?.usage} [--json] [--base-url <url>]`]
    : [
      'Prori Tools Gateway',
      '',
      'Usage: prori <command> [options]',
      '',
      'Commands',
      '  auth           Manage API credentials',
      '  balance        Show your credit balance',
      '  stats          Show Gateway catalog counts',
      '  categories     List endpoint categories',
      '  endpoints      Browse the endpoint catalog',
      '  discover       Search endpoints by intent',
      '  inspect        Show endpoint schema and pricing',
      '  run            Execute an endpoint',
      '  runs           List recent runs',
      '  status         Get a run (alias: run-status)',
      '  stop           Stop an active run',
    ];

  if (command === 'inspect' || command === 'run') {
    lines.push('', 'Targets: anyapi/reddit.subreddit_search or anyapi /reddit.subreddit_search');
  }
  if (command === 'run') {
    lines.push('Pending runs are polled by default. --no-poll returns the initial response.');
  }
  if (command === 'auth login') {
    lines.push('', 'Enter a key at the hidden prompt, or pipe it to stdin with --stdin.');
  }
  lines.push(
    '', 'Global options', '  --json            Emit compact JSON',
    '  --base-url <url>  Override PRORI_API_BASE',
    '  --help, -h        Show help', '  --version         Show the CLI version',
  );
  print(lines.join('\n'));
}

function parseArgs(argv: string[]): { args: string[]; options: Options } {
  const args: string[] = [];
  const options: Options = new Map();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === '--') {
      args.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith('--') && arg !== '-h') {
      args.push(arg);
      continue;
    }
    const [name, ...parts] = (arg === '-h' ? 'help' : arg.slice(2)).split('=');
    if (!name || !KNOWN_FLAGS.has(name)) throw new Error(`Unknown option ${arg.split('=')[0]}.`);
    if (options.has(name)) throw new Error(`Option --${name} was specified twice.`);
    if (VALUE_FLAGS.has(name)) {
      const value = parts.length ? parts.join('=') : argv[index + 1];
      if (!value || (!parts.length && (value.startsWith('--') || value === '-h'))) {
        throw new Error(`Option --${name} requires a value.`);
      }
      if (!parts.length) index++;
      options.set(name, value);
    } else {
      if (parts.length) throw new Error(`Option --${name} does not take a value.`);
      options.set(name, true);
    }
  }
  return { args, options };
}

function textOption(options: Options, name: string): string | undefined {
  const value = options.get(name);
  return typeof value === 'string' ? value : undefined;
}

function numberOption(options: Options, name: string, min: number, max: number): number | undefined {
  const value = textOption(options, name);
  if (value === undefined) return;
  const number = Number(value);
  if (!/^\d+$/.test(value) || number < min || number > max) {
    throw new Error(`Option --${name} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

function expectArgs(args: string[], count: number, command: string): void {
  if (args.length !== count || args.some((arg) => !arg.trim())) {
    throw new Error(`Usage: prori ${COMMANDS[command]?.usage}`);
  }
}

function parseTarget(args: string[]): Pick<ToolsInspectRequest, 'provider' | 'endpoint'> {
  const [target, endpoint] = args;
  if (args.length === 2 && target && endpoint) return { provider: target, endpoint };
  const slash = target?.indexOf('/') ?? -1;
  if (args.length === 1 && target && slash > 0 && slash < target.length - 1) {
    return { provider: target.slice(0, slash), endpoint: target.slice(slash) };
  }
  throw new Error('Specify a target such as anyapi/reddit.subreddit_search or anyapi /reddit.subreddit_search.');
}

async function readInput(options: Options): Promise<ToolsJsonValue | undefined> {
  const inline = textOption(options, 'input');
  const file = textOption(options, 'input-file');
  if (inline !== undefined && file !== undefined) throw new Error('Use only one of --input and --input-file.');
  const text = file === undefined ? inline : await readFile(file, 'utf8');
  if (text === undefined) return;
  try {
    return JSON.parse(text) as ToolsJsonValue;
  } catch {
    throw new Error('Input must be valid JSON.');
  }
}

function configPath(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'prori', 'credentials.json');
}

async function readCredentials(): Promise<{ apiKey: string; source: 'environment' | 'file' } | undefined> {
  if (envKey) return { apiKey: envKey, source: 'environment' };
  try {
    const data = JSON.parse(await readFile(configPath(), 'utf8')) as { apiKey?: unknown } | null;
    if (typeof data?.apiKey !== 'string' || !data.apiKey.trim()) throw new Error();
    const apiKey = data.apiKey.trim();
    secrets.add(apiKey);
    return { apiKey, source: 'file' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new Error('Could not read Prori credentials. Run prori auth login to replace them.');
  }
}

async function readLoginKey(fromStdin: boolean): Promise<string> {
  const terminal = process.stdin.isTTY === true;
  if (!terminal && !fromStdin) throw new Error('Use prori auth login --stdin when piping a key.');
  const silentOutput = terminal ? new Writable({
    write(_chunk, _encoding, callback) { callback(); },
  }) : undefined;
  const reader = createInterface({ input: process.stdin, output: silentOutput, terminal });
  reader.on('SIGINT', () => reader.close());
  if (terminal) process.stderr.write('Prori API key: ');
  try {
    for await (const line of reader) {
      const key = line.trim();
      if (key) return key;
      break;
    }
    throw new Error('No Prori API key received.');
  } finally {
    reader.close();
    if (terminal) process.stderr.write('\n');
  }
}

async function writeAtomically(path: string, write: (file: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(dirname(path), '.prori-'));
  const file = join(directory, 'data');
  try {
    await write(file);
    await rename(file, path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function saveCredentials(apiKey: string): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeAtomically(path, (file) => writeFile(file, `${JSON.stringify({ apiKey })}\n`, { mode: 0o600 }));
}

function baseUrl(options: Options): string {
  const value = textOption(options, 'base-url') ?? (process.env.PRORI_API_BASE || API_BASE);
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) {
      return url.href;
    }
  } catch {
    // Report the option without echoing the input.
  }
  throw new Error('Base URL must be an HTTP or HTTPS URL without credentials, a query or a fragment.');
}

async function handleAuth(command: string, options: Options): Promise<number> {
  const json = options.has('json');
  switch (command) {
    case 'auth login': {
      const origin = baseUrl(options);
      const apiKey = await readLoginKey(options.has('stdin'));
      secrets.add(apiKey);
      await new ProriToolsClient({ apiKey, baseUrl: origin }).balance();
      await saveCredentials(apiKey);
      if (json) printJson({ authenticated: true, source: 'file' }, true);
      else print('Credentials verified and saved.');
      return 0;
    }
    case 'auth status': {
      const credentials = await readCredentials();
      if (json) printJson({ authenticated: Boolean(credentials), source: credentials?.source ?? null }, true);
      else print(credentials ? `Credentials configured via ${credentials.source}.` : 'No Prori credentials configured.');
      return 0;
    }
    case 'auth logout': {
      let removed = true;
      try {
        await unlink(configPath());
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        removed = false;
      }
      if (json) printJson({ removed }, true);
      else print(removed ? 'Saved credentials removed.' : 'No saved credentials to remove.');
      return 0;
    }
    default:
      throw new Error('Usage: prori auth <login|status|logout>');
  }
}

async function downloadResult(response: Response, run: ToolsRunResponse): Promise<ToolsRunResponse> {
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type && !type.startsWith('text/') && !type.endsWith('/json') && !type.endsWith('+json')) {
    const output = Buffer.from(await response.arrayBuffer()).toString('base64');
    return { ...run, output, outputEncoding: 'base64' };
  }
  const text = await response.text();
  try {
    return { ...run, output: JSON.parse(text) as ToolsJsonValue };
  } catch {
    return { ...run, output: text };
  }
}

async function showRun(client: ProriToolsClient, run: ToolsRunResponse, options: Options): Promise<number> {
  const outputPath = textOption(options, 'output');
  let saved = false;
  if (!isToolsRunPending(run)) {
    if (run.output === null && run.outputUrl) {
      const response = await client.downloadOutput(run.outputUrl);
      if (outputPath) {
        await writeAtomically(outputPath, async (file) => {
          const body = response.body as NodeReadableStream<Uint8Array> | null;
          await pipeline(body ? Readable.fromWeb(body) : Readable.from([]), createWriteStream(file));
        });
        saved = true;
      } else {
        run = await downloadResult(response, run);
      }
    } else if (outputPath && run.output !== undefined) {
      const output = run.output;
      await writeAtomically(outputPath, (file) => writeFile(file, `${JSON.stringify(output, null, 2)}\n`));
      saved = true;
    }
  }

  const providerHttpError = (run.providerHttpStatus ?? 0) >= 400;
  const providerError = providerHttpError || Boolean(run.providerError);
  if (options.has('json')) {
    printJson(run, true);
  } else {
    const provider = providerHttpError ? ` · provider HTTP ${run.providerHttpStatus}` : providerError ? ' · provider error' : '';
    print(`${run.runId}  ${run.status}  · credits.charged: ${run.credits?.charged ?? 'unknown'}${provider}`);
    if (saved) print(`Output saved to ${outputPath}`);
    else if (run.output != null) printJson(run.output, false);
  }
  return FAILED_STATUSES.has(run.status) || providerError ? 1 : 0;
}

async function main(argv: string[]): Promise<number> {
  const { args, options } = parseArgs(argv);
  if (options.has('version')) {
    print(VERSION);
    return 0;
  }
  let command = args.shift();
  if (!command) {
    help();
    return 0;
  }
  if (command === 'auth' && args[0]) command += ` ${args.shift()}`;
  if (command === 'run-status') command = 'status';
  if (!Object.hasOwn(COMMANDS, command)) throw new Error('Unknown command. Run prori --help.');
  if (options.has('help')) {
    help(command);
    return 0;
  }
  const flags = COMMANDS[command]!.flags;
  for (const name of options.keys()) {
    if (!GLOBAL_FLAGS.includes(name) && !flags.includes(name)) {
      throw new Error(`Option --${name} is unavailable for prori ${command}.`);
    }
  }

  if (command === 'auth' || command.startsWith('auth ')) {
    expectArgs(args, 0, command);
    return handleAuth(command, options);
  }

  const publicCommand = ['stats', 'categories', 'endpoints'].includes(command);
  const origin = baseUrl(options);
  const credentials = publicCommand ? undefined : await readCredentials();
  if (!publicCommand && !credentials) throw new Error('Set PRORI_API_KEY or run prori auth login.');
  const client = new ProriToolsClient({ baseUrl: origin, apiKey: credentials?.apiKey });
  const json = options.has('json');

  switch (command) {
    case 'balance':
      expectArgs(args, 0, command);
      printJson(await client.balance(), json);
      break;
    case 'stats': {
      expectArgs(args, 0, command);
      const stats = await client.stats();
      if (json) printJson(stats, true);
      else print(`${stats.endpointCount} endpoints · ${stats.providerCount} providers · ${stats.runnableCount} runnable`);
      break;
    }
    case 'categories':
      expectArgs(args, 0, command);
      printJson(await client.categories(), json);
      break;
    case 'endpoints':
      expectArgs(args, 0, command);
      printJson(await client.endpoints({
        q: textOption(options, 'q'),
        category: textOption(options, 'category'),
        provider: textOption(options, 'provider'),
        runnable: options.has('runnable') || undefined,
        limit: numberOption(options, 'limit', 1, 50),
        cursor: textOption(options, 'cursor'),
      }), json);
      break;
    case 'discover':
      expectArgs(args, 1, command);
      printJson(await client.discover({
        query: args[0]!,
        limit: numberOption(options, 'limit', 1, 20),
        category: textOption(options, 'category'),
      }), json);
      break;
    case 'inspect': {
      const target = parseTarget(args);
      printJson(await client.inspect({ ...target, input: await readInput(options) }), json);
      break;
    }
    case 'run': {
      const target = parseTarget(args);
      const input = await readInput(options);
      const started = await client.run({
        ...target,
        input: input === undefined ? {} : input,
        waitSeconds: numberOption(options, 'wait', 0, 55),
      }, { idempotencyKey: textOption(options, 'idempotency-key') ?? randomUUID() });
      const run = options.has('no-poll') ? started : await client.waitForRun(started);
      return showRun(client, run, options);
    }
    case 'runs':
      expectArgs(args, 0, command);
      printJson(await client.listRuns({ limit: numberOption(options, 'limit', 1, 100) }), json);
      break;
    case 'status': {
      expectArgs(args, 1, command);
      const run = options.has('poll') ? await client.waitForRun(args[0]!) : await client.getRun(args[0]!);
      return showRun(client, run, options);
    }
    case 'stop':
      expectArgs(args, 1, command);
      printJson(await client.stopRun(args[0]!), json);
      break;
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    process.stderr.write(`${redact(error instanceof Error ? error.message : 'Prori command failed.')}\n`);
    process.exitCode = 1;
  },
);
