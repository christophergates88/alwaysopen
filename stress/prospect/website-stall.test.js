// BUG: the audit's website check gives up after 9 seconds only while waiting for the first byte. audit.js checkSite
// clears its 9-second timer as soon as the response headers arrive (line 33) and then reads the whole page with no
// time limit and no size limit (line 38: `(await r.text()).slice(0, 600000)` reads everything before it cuts).
// A listed website that answers at once and then trickles, stalls, or is simply enormous hangs the audit:
//   - the lead gets no email at all (not the audit, not the "one quick question" email),
//   - Christopher's push has already said "Their free audit already went to their inbox", and nothing corrects it,
//   - the row is never marked, so the retry job picks it up again every 10 minutes and hangs on it again, and every
//     other lead waiting for a retry sits behind it (auditRetryCron works through its five rows one at a time).
// The same check runs for the public score box (/audit/score) and the texted audit page (/your-audit/...), which hang
// with it.
//
// SEVERITY: medium.
// CAUSE: src/audit.js:33 and 38; the retry job works through its rows one at a time (src/leadmail.js:407-410).
// SMALLEST FIX: move clearTimeout(timer) to after the body has been read, and read at most 600 KB from the stream
//   instead of all of it.
//
// The harness fakes Google and Twilio but not a business's own website, so this test answers for one made-up site
// (stall.example) and passes everything else to the harness untouched. The test waits 11 real seconds, to be past the
// 9 the code promises.
//
// Run: node --test stress/prospect/website-stall.test.js     (takes about 12 seconds)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { site, ask, L, PLACE, sleep } from './_kit.mjs';

// A site that sends its headers at once and then one kilobyte every 200 ms, without ever finishing.
function stallingWebsite(s) {
  const harnessFetch = globalThis.fetch;
  const seen = { opened: 0, bytes: 0 };
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/^https:\/\/stall\.example\//.test(url)) {
      seen.opened++;
      const signal = init && init.signal;
      const body = new ReadableStream({ pull(c) { return new Promise((ok, no) => setTimeout(() => { if (signal && signal.aborted) return no(new DOMException('aborted', 'AbortError')); seen.bytes += 1024; c.enqueue(new Uint8Array(1024).fill(32)); ok(); }, 200)); } });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/places\.googleapis\.com/.test(url)) {
      // Google: the slow site belongs to "Slowpoke Pools"; every other name gets the usual plumber.
      const slow = /Slowpoke/.test(String(init && init.body));
      return new Response(JSON.stringify({ places: [slow ? Object.assign({}, PLACE, { id: 'ChIJslow', displayName: { text: 'Slowpoke Pools' }, websiteUri: 'https://stall.example/' }) : PLACE] }), { headers: { 'content-type': 'application/json' } });
    }
    return harnessFetch(input, init);
  };
  return seen;
}

test('control: a listed website that loads normally: the audit email goes out at once', async () => {
  const s = site();
  const harnessFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/^https:\/\/quick\.example\//.test(url)) return new Response('<html><head><meta name="viewport" content="width=device-width"><title>Quick Pools</title></head><body><a href="tel:+14785550101">Call</a></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    return harnessFetch(input, init);
  };
  s.world.places = { places: [Object.assign({}, PLACE, { displayName: { text: 'Quick Pools' }, websiteUri: 'https://quick.example/' })] };
  await ask(s, { name: 'Pat Pool', email: 'pat@quick.example', business: 'Quick Pools', town: 'Eatonton, GA' });
  assert.equal(s.out.length, 1);
  assert.equal((await s.one('SELECT audit FROM leads')).audit, 'sent');
  assert.match(s.out[0].text, /Website A\n/, 'the site was read and found in good order');
});

test('a listed website that never finishes loading does not hang the audit, the lead, or the retry queue', async () => {
  const s = site();
  const web = stallingWebsite(s);
  // 1. A real lead whose listed website stalls.
  const posted = ask(s, { name: 'Pat Pool', email: 'pat@slowpoke.example', business: 'Slowpoke Pools', town: 'Eatonton, GA' });
  await sleep(300);
  assert.equal((await s.one("SELECT COUNT(*) AS n FROM leads WHERE email = 'pat@slowpoke.example'")).n, 1, 'control: the lead was saved');
  assert.ok(s.world.pushes.some(p => /Their free audit already went to their inbox/.test(p.body)), 'control: Christopher was told the audit already went');
  // 2. Twenty minutes on, the retry job runs with another lead behind this one (its first send never happened).
  const twentyMin = 20 * 60e3;
  await s.DB.prepare("UPDATE leads SET at = ?1 WHERE email = 'pat@slowpoke.example'").bind(new Date(Date.now() - twentyMin).toISOString()).run();
  await s.DB.prepare("INSERT INTO leads (at, name, email, business, town, status) VALUES (?1, 'Dana Whitfield', 'dana@example.com', 'Sinclair Plumbing', 'Eatonton, GA', 'new')").bind(new Date(Date.now() - twentyMin).toISOString()).run();
  const retry = L.auditRetryCron(s.env, Date.now(), {});
  let retryDone = false; retry.then(() => { retryDone = true; }, () => { retryDone = true; });
  let postDone = false; posted.then(() => { postDone = true; }, () => { postDone = true; });

  await sleep(11000);   // past the 9 seconds checkSite allows a website

  const pat = await s.one("SELECT audit FROM leads WHERE email = 'pat@slowpoke.example'");
  const dana = await s.one("SELECT audit FROM leads WHERE email = 'dana@example.com'");
  const got = { patEmailed: s.out.some(m => m.to === 'pat@slowpoke.example'), patMarked: !!(pat.audit), danaEmailed: s.out.some(m => m.to === 'dana@example.com'), danaMarked: !!(dana.audit), retryJobFinished: retryDone, formWorkFinished: postDone };
  assert.ok(web.opened >= 1 && web.bytes > 20 * 1024, 'control: the website was opened and was still being read after 11 seconds (' + web.bytes + ' bytes so far)');
  assert.deepEqual(got, { patEmailed: true, patMarked: true, danaEmailed: true, danaMarked: true, retryJobFinished: true, formWorkFinished: true },
    'after 11 seconds: the stalled lead has no email and no mark, the lead behind it in the retry queue has not been touched, and neither job has returned');
});
