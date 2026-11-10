// BUG: when no audit email will go out, the Worker says so ("Your request reached us. Katie follows up within one
// business day."), and the English website throws that answer away and prints its own: "Your free audit is on its way
// to your inbox now". public/index.html line 1519 uses the server's message only when the page is in Spanish
// (`es&&j.message ? ... : 'Got it... Your free audit is on its way to your inbox now...'`).
// Who is told something false: anyone whose audit is held (asked again within 30 days, the 4th request from one
// office network that day, the day's cap, a form sent within 3 seconds or left open over 3 days) and anyone whose
// address is on the do-not-email list. They wait for an email that is not coming.
//
// And for an address on the do-not-email list, Christopher's own instruction is wrong: the push and the email both
// open with "Do this: Send the free audit by hand" (index.js leadStep), which is the one thing he must not do.
//
// The page's code is run as written: the success handler is cut out of public/index.html and called with the Worker's
// real answer.
//
// SEVERITY: medium.
// CAUSE: public/index.html:1519 (the server's message is used only when `es` is true); src/index.js:587 (leadStep gives
//   every kind of hold the same instruction).
// SMALLEST FIX: show j.title + ' ' + j.message whenever the Worker sends one, in either language. In leadStep, when
//   the hold is "stopped", say "Call them. Do not email: this address asked us to stop."
//
// Run: node --test stress/prospect/page-promise.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { site, ask, L, opMail } from './_kit.mjs';

// The form's own "what to show when the server answers" code, from the page.
const page = fs.readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const src = /\.then\(function\(j\)\{\s*done\(\);([\s\S]*?)\},function\(\)\{done\(\);emailFallback/.exec(page);
assert.ok(src, 'the form’s answer handler was found in public/index.html');
function pageShows(answer, status, lang) {
  const shown = [];
  const err = { textContent: '', hidden: true };
  new Function('j', 'es', 'first', 'name', 'showSent', 'err', 'emailFallback', src[1])(
    Object.assign({}, answer, { status }), lang === 'es', 'Dana', 'Dana Whitfield', (title, text) => shown.push(text), err, (n, why) => shown.push(why));
  return shown.join(' ') || err.textContent;
}

async function stoppedAddressAsksAgain() {
  const s = site();
  await ask(s, { email: 'dana@example.com' });
  const stop = new URL(await L.stopLink(s.env, (await s.one('SELECT id FROM leads')).id));
  await s.client.call(stop.pathname + stop.search, { method: 'POST' });
  const before = { pushes: s.world.pushes.length, mail: s.world.mail.length };
  const r = await ask(s, { email: 'Dana@Example.com', phone: '478-555-0101' }, '192.0.2.77');
  return { s, r, before };
}

test('control: a normal request, and what the English page shows for it', async () => {
  const s = site();
  const r = await ask(s, { email: 'dana@example.com' });
  assert.match(r.json().message, /Your free audit is on its way to your inbox now/);
  assert.match(pageShows(r.json(), r.status, 'en'), /Your free audit is on its way to your inbox now/);
  assert.equal(s.out.length, 1);
});

test('an address that asked us to stop asks again: the English page does not promise an email', async () => {
  const { s, r } = await stoppedAddressAsksAgain();
  assert.equal(s.out.length, 1, 'control: no second audit email went out');
  assert.doesNotMatch(r.json().message, /on its way/, 'control: the Worker’s own answer is honest');
  assert.doesNotMatch(pageShows(r.json(), r.status, 'es'), /on its way|va camino/, 'control: the Spanish page shows the Worker’s answer');
  assert.doesNotMatch(pageShows(r.json(), r.status, 'en'), /on its way to your inbox/, 'the English page promises an email that is not coming');
});

test('the same person asks twice in a month: the English page does not promise a second email', async () => {
  const s = site();
  await ask(s, { email: 'dana@example.com' });
  const r = await ask(s, { email: 'dana@example.com', business: 'Sinclair Plumbing and Drain' }, '192.0.2.77');
  assert.equal(s.out.length, 1, 'control: one audit per address in 30 days');
  assert.doesNotMatch(pageShows(r.json(), r.status, 'en'), /on its way to your inbox/, 'the English page promises an email that is not coming');
});

test('an address that asked us to stop asks again: Christopher is not told to email it', async () => {
  const { s, before } = await stoppedAddressAsksAgain();
  const push = s.world.pushes.slice(before.pushes).find(p => /Always Open lead/.test(p.title));
  const mail = opMail(s.world.mail.slice(before.mail).at(-1).raw);
  assert.match(push.body, /asked us not to email it/, 'control: the push does say the address asked us to stop');
  assert.doesNotMatch(push.body.split('\n')[0], /Send the free audit by hand/, 'the push opens by telling him to email an address on the do-not-email list');
  assert.doesNotMatch(mail.html.replace(/<[^>]+>/g, ' '), /Send the free audit by hand/, 'and so does the email’s "Do this"');
});
