const { appendFileSync } = require('node:fs');

const responses = JSON.parse(process.env.PRORI_TEST_RESPONSES);
globalThis.fetch = async (url, init) => {
  appendFileSync(process.env.PRORI_TEST_REQUESTS, JSON.stringify({
    url, method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)),
    body: init.body === undefined ? undefined : JSON.parse(init.body), at: Date.now(),
  }) + '\n');

  const next = responses.shift();
  if (!next) throw new Error('Unexpected fetch in CLI test.');
  const body = next.bytes ? Buffer.from(next.bytes) : next.text ?? JSON.stringify(next.json);
  return new Response(body, { status: next.status ?? 200, headers: next.headers });
};
