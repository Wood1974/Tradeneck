// Browser check of the Messages screen against a mocked Supabase client (no network, no real data).
//   cd shield-app && npm ci          # provides playwright-core
//   PW_CHROMIUM_PATH=/path/to/chrome node tests/messaging-ui.mjs
// Covers the two review findings that live in assets/app.js: a failed request-list load must not
// look like an empty inbox, and an open thread must follow accept/decline events.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(root, 'shield-app', 'package.json'))('playwright-core');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = createServer(async (req, res) => {
  let path = new URL(req.url, 'http://x').pathname;
  const file = join(root, path === '/' || !extname(path) ? 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// Stands in for supabase-js. Everything the test varies lives on window.__m.
const SUPABASE_STUB = `
window.__m = { rpc: {}, handlers: {}, subscribed: null, alerts: [], fire(table){ (this.handlers[table]||[]).forEach(f => f({})); } };
const chain = (result) => { const c = new Proxy(function(){}, { get: (_, k) => k === 'then' ? (ok) => ok(result) : (k === 'single' ? () => Promise.resolve({ data: { id: 'me', tier: 1 }, error: null }) : () => c) }); return c; };
window.supabase = { createClient: () => ({
  from: () => chain({ data: [], error: null }),
  rpc: (name, args) => Promise.resolve((window.__m.rpc[name] || (() => ({ data: [], error: null })))(args)),
  channel: () => { const ch = { on: (t, f, cb) => { (window.__m.handlers[f.table] ||= []).push(cb); return ch; }, subscribe: (cb) => { window.__m.subscribed = cb; return ch; } }; return ch; },
  auth: { signOut: async () => ({}), getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
}) };`;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const context = await browser.newContext({ serviceWorkers: 'block' });
const page = await context.newPage();
await page.route('**/*', (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  if (url.includes('supabase-js')) return route.fulfill({ contentType: 'text/javascript', body: SUPABASE_STUB });
  if (url.includes('posthog')) return route.fulfill({ contentType: 'text/javascript', body: 'window.posthog = new Proxy({}, { get: () => () => {} });' });
  return route.abort();
});
page.on('pageerror', (e) => { console.log('PAGE ERROR', e.message); process.exitCode = 1; });
await page.goto(base + '/');
await page.evaluate(() => { window.alert = (m) => window.__m.alerts.push(m); });

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failed++; };
const text = (sel) => page.locator(sel).innerText();
const visible = (sel) => page.locator(sel).isVisible();

await page.evaluate(() => onLogin({ id: 'me', email: 'me@example.com' }));

// Finding 2: the request list fails to load.
await page.evaluate(() => {
  __m.rpc.my_conversations = () => ({ data: [], error: null });
  __m.rpc.my_message_requests = () => ({ data: null, error: { message: 'boom' } });
  switchTab('messages');
});
await page.waitForFunction(() => document.getElementById('msg-inbox').innerText.includes('Could not load message requests'));
check('failed requests call is reported', (await text('#msg-inbox')).includes('boom'));
check('failed requests call is not shown as an empty inbox', !(await text('#msg-inbox')).includes('No messages yet'));
await page.evaluate(() => { __m.rpc.my_message_requests = () => ({ data: [], error: null }); });
await page.getByRole('button', { name: 'Retry' }).click();
await page.waitForFunction(() => document.getElementById('msg-inbox').innerText.includes('No messages yet'));
check('retry recovers once the call works', !(await text('#msg-inbox')).includes('Could not load'));

// Finding 3: a thread opened while pending follows an accept from elsewhere.
const pendingReq = (status) => ({ conversation_id: 'c1', direction: 'outgoing', status, other_name: 'Bob', other_trade: 'Plumbing' });
const acceptedConvo = { conversation_id: 'c1', other_name: 'Bob', other_trade: 'Plumbing', unread: 0, last_at: new Date().toISOString() };
async function openPending(status) {
  await page.evaluate((r) => {
    __m.rpc.my_conversations = () => ({ data: [], error: null });
    __m.rpc.my_message_requests = () => ({ data: [r], error: null });
    showInbox();
    return loadInbox().then(() => openConversation('c1'));
  }, pendingReq(status));
}
await openPending('pending');
check('pending thread hides the composer', !(await visible('#msg-composer')));
check('pending thread says the request was sent', (await text('#msg-status')).includes('Request sent'));
await page.evaluate((c) => {
  __m.rpc.my_conversations = () => ({ data: [c], error: null });
  __m.rpc.my_message_requests = () => ({ data: [], error: null });
  __m.fire('conversations');
}, acceptedConvo);
await page.waitForFunction(() => getComputedStyle(document.getElementById('msg-composer')).display !== 'none');
check('accept elsewhere reveals the composer without reopening', await visible('#msg-composer'));

// Decline while open.
await openPending('pending');
await page.evaluate(() => {
  __m.rpc.my_conversations = () => ({ data: [], error: null });
  __m.rpc.my_message_requests = () => ({ data: [{ conversation_id: 'c1', direction: 'outgoing', status: 'declined', other_name: 'Bob' }], error: null });
  __m.fire('conversations');
});
await page.waitForFunction(() => document.getElementById('msg-status').innerText.includes('declined'));
check('decline elsewhere shows the declined note', !(await visible('#msg-composer')));

// A dropped and re-established channel re-reads the truth.
await openPending('pending');
await page.evaluate((c) => {
  __m.rpc.my_conversations = () => ({ data: [c], error: null });
  __m.rpc.my_message_requests = () => ({ data: [], error: null });
  __m.subscribed('SUBSCRIBED');
}, acceptedConvo);
await page.waitForFunction(() => getComputedStyle(document.getElementById('msg-composer')).display !== 'none');
check('re-subscribe refreshes the open thread', await visible('#msg-composer'));

await browser.close();
server.close();
console.log(failed ? `${failed} FAILED` : 'ALL MESSAGING UI CHECKS PASSED');
process.exit(failed ? 1 : process.exitCode || 0);
