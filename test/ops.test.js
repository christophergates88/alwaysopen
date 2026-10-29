// The checks that watch the system: /health turns red when the cron stops, every job's run is written down, and a crash
// anywhere sends one alert with a readable page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const { watched, noteRun, cronRuns, cronAge, healthStatus, CRON_LATE_MS } = await import('../src/ops.js');

const envFor = (db, extra) => Object.assign({ DB: db, STRIPE_KEY: '', EMAIL: {}, MAIL_FROM: 'a@b.c', MAIL_TO: 'd@e.f', TWILIO_ACCOUNT_SID: 'x', TWILIO_AUTH_TOKEN: 'y', CALLROOM: {}, VOICE_KEY: 'k', AI: {} }, extra || {});

test('every background job writes down its run, failures included, and a failure sends one alert', async () => {
  const env = envFor(makeDB(), { NTFY_URL: 'https://ntfy.example.test/x' });
  const pings = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url).includes('ntfy')) { pings.push(init.body); return new Response('ok'); } return new Response('{}', { status: 404 }); };
  try {
    await watched(env, 'storm', Promise.resolve('fine'));
    await watched(env, 'map', Promise.reject(new Error('Google answered 500')));
    const runs = await cronRuns(env);
    assert.deepEqual(runs.map(r => [r.name, r.ok]).sort(), [['map', 0], ['storm', 1]]);
    assert.match(runs.find(r => r.name === 'map').note, /Google answered 500/);
    assert.equal(pings.length, 1);
    assert.match(pings[0], /Google answered 500/);
  } finally { globalThis.fetch = realFetch; }
});

test('/health is ok while the 10-minute cron keeps ticking, and not ok 25 minutes after it stops', async () => {
  const env = envFor(makeDB());
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 404 });
  try {
    const now = Date.parse('2026-10-28T12:00:00Z');
    let h = await healthStatus(env, now);
    assert.equal(h.checks.find(c => c.name === 'cron').ok, true, 'nothing recorded yet is not a failure (the minute after a deploy)');
    await noteRun(env, 'tick', true, 0, '');
    await env.DB.prepare("UPDATE cron_runs SET at = ?1 WHERE name = 'tick'").bind(new Date(now - 10 * 60000).toISOString()).run();
    h = await healthStatus(env, now);
    assert.equal(h.checks.find(c => c.name === 'cron').ok, true);
    assert.equal(h.checks.find(c => c.name === 'stripe').ok, false, 'no Stripe key in this test, so the page is still not ok');
    await env.DB.prepare("UPDATE cron_runs SET at = ?1 WHERE name = 'tick'").bind(new Date(now - CRON_LATE_MS - 60000).toISOString()).run();
    h = await healthStatus(env, now);
    assert.equal(h.checks.find(c => c.name === 'cron').ok, false);
    assert.match(h.checks.find(c => c.name === 'cron').why, /26 minutes ago/);
    assert.equal(await cronAge(env, now), CRON_LATE_MS + 60000);
  } finally { globalThis.fetch = realFetch; }
});

test('a crash anywhere: one row, one alert per route, and a page or TwiML that tells the visitor what to do', async () => {
  const { crashed, recentErrors, routeOf, crashResponse } = await import('../src/ops.js');
  const env = envFor(makeDB(), { NTFY_URL: 'https://ntfy.example.test/x' });
  const pings = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url).includes('ntfy')) { pings.push(init.headers.Title + ' | ' + init.body); return new Response('ok'); } return new Response('{}', { status: 404 }); };
  try {
    const waits = [];
    const ctx = { waitUntil: p => waits.push(p) };
    const req = (path, accept) => new Request('https://alwaysopenoffice.com' + path, { headers: accept ? { accept } : {} });
    for (let i = 0; i < 5; i++) crashed(req('/app/LZbZROIqlA85xuGEgarAuKRRO3IuO1En/calls'), env, ctx, new Error('secret sk_live_abc should not leak'));
    await Promise.all(waits);
    const rows = await recentErrors(env, 10);
    assert.equal(rows.length, 5);
    assert.equal(rows[0].route, '/app/*/calls', 'the code is stripped from the route');
    assert.equal(pings.length, 1, 'five crashes on one route: one push');
    assert.match(pings[0], /crash:\/app\/\*\/calls/);
    assert.doesNotMatch(pings[0], /sk_live/, 'keys are scrubbed from alerts');
    assert.match(rows[0].message, /\[key\] should not leak/);
    const page = crashed(req('/app/x'), env, ctx, new Error('boom'));
    assert.equal(page.status, 500);
    assert.match(await page.text(), /Something went wrong on our side/);
    const api = crashResponse('/api/state', 'application/json');
    assert.equal(api.headers.get('content-type'), 'application/json');
    assert.match(await api.text(), /call \(706\) 460-2226/);
    const twiml = crashResponse('/voice/in/key', '');
    assert.equal(twiml.status, 200, 'Twilio must get 200 so it speaks the sentence instead of playing an error tone');
    assert.match(await twiml.text(), /<Say[^>]*>Thanks for calling\. We can’t take your call right now/);
    assert.equal(routeOf('/q/ab12cd34ef56ab12cd34ef56'), '/q/*');
    assert.equal(routeOf('/i/9/pay'), '/i/*/pay');
    const { scrub } = await import('../src/ops.js');
    assert.equal(scrub('Twilio 401 for +1 (478) 555-0142, token Bearer abcdefghij1234567890 and dana@example.com'), 'Twilio 401 for [phone], token Bearer [token] and [email]');
  } finally { globalThis.fetch = realFetch; }
});

test('the Twilio fallback: a sentence for the caller, and the owner’s cell first when there is one', async () => {
  const { fallbackTwiml, fallbackUrl } = await import('../src/provision.js');
  assert.equal(fallbackTwiml('Sinclair Plumbing', ''), '<Response><Say voice="Polly.Matthew">Thanks for calling Sinclair Plumbing. We can’t take your call right now. Please call back in a few minutes.</Say><Hangup/></Response>');
  assert.match(fallbackTwiml('A <b>Co</b>', '+14785550142'), /^<Response><Dial timeout="20">\+14785550142<\/Dial><Say/);
  assert.doesNotMatch(fallbackTwiml('A <b>Co</b>', ''), /<b>/);
  assert.match(fallbackUrl('X', ''), /^https:\/\/twimlets\.com\/echo\?Twiml=%3CResponse%3E/);
});

test('the hourly checks: Apple push key, ntfy, numbers on our webhook, Google; each failure is one alert and shows on /health', async () => {
  const { slowCron, healthStatus } = await import('../src/ops.js');
  const env = envFor(makeDB(), { NTFY_URL: 'https://ntfy.example.test/topic', APNS_KEY: 'k', APNS_KEY_ID: 'id', VOICE_KEY: 'vk', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't' });
  await env.DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air) VALUES ('+14785551234', 'c1', 'Sinclair Plumbing', 1)").run();
  await env.DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air) VALUES ('+14785550123', 'demo-plumbing', 'Demo Plumbing Co.', 1)").run();   // 555-01xx numbers are made up
  const pings = [];
  const world = { apple: [400, '{"reason":"BadDeviceToken"}'], ntfy: 200, voice_url: 'https://alwaysopenoffice.com/voice/in/vk', fallback: 'https://twimlets.com/echo?Twiml=x' };
  const f = async (url, init) => {
    url = String(url);
    if (url.includes('push.apple.com')) return new Response(world.apple[1], { status: world.apple[0] });
    if (url.includes('ntfy.example.test')) { if (init && init.method === 'POST') pings.push(init.headers.Title); return new Response('', { status: world.ntfy }); }
    if (url.includes('IncomingPhoneNumbers')) return new Response(JSON.stringify({ incoming_phone_numbers: [{ sid: 'PN1', voice_url: world.voice_url, voice_fallback_url: world.fallback }] }));
    return new Response('{}', { status: 404 });
  };
  const realFetch = globalThis.fetch; globalThis.fetch = f;
  try {
    const now = Date.parse('2026-10-29T12:00:00Z');
    let r = await slowCron(env, now, { fetch: f, apnsJwt: async () => 'jwt' });
    assert.deepEqual(r, { checked: 4, bad: [] });
    assert.equal(pings.length, 0);
    assert.deepEqual(await slowCron(env, now + 30 * 60000, { fetch: f, apnsJwt: async () => 'jwt' }), { skipped: true }, 'once an hour');
    world.apple = [403, '{"reason":"InvalidProviderToken"}']; world.voice_url = 'https://old.example.com/x';
    r = await slowCron(env, now + 61 * 60000, { fetch: f, apnsJwt: async () => 'jwt' });
    assert.deepEqual(r.bad, ['apple-push', 'twilio-numbers']);
    assert.deepEqual(pings, ['Always Open problem: health:apple-push', 'Always Open problem: health:twilio-numbers']);
    const h = await healthStatus(env, now + 62 * 60000);
    assert.equal(h.checks.find(c => c.name === 'apple-push').ok, false);
    assert.match(h.checks.find(c => c.name === 'twilio-numbers').why, /Sinclair Plumbing \(webhook points elsewhere\)/);
    assert.doesNotMatch(h.checks.find(c => c.name === 'twilio-numbers').why, /Demo/, 'the demo number is made up and skipped');
    const stale = await healthStatus(env, now + 5 * 3600e3);
    assert.equal(stale.checks.some(c => c.name === 'apple-push'), false, 'a result older than three hours is not shown as current');
  } finally { globalThis.fetch = realFetch; }
});
