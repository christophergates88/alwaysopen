// BUG: "reply to a text" texts any phone number, from the business's own number, for anyone holding an app link.
// POST /api/inbox {action:'reply', id:'msg-text-<any ten digits>'} never checks that a thread with that number exists
// (src/biz.js:479-486 -> src/sms.js replyText). A reply is also exempt from the 9 PM rule and from the hourly and daily
// ceilings (sms.js: kind 'reply'), because it is meant to answer someone who just texted. A field tech's link works too.
// Run: node --test stress/owner/inbox-reply-texts-any-number.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_setup.mjs';

test('a tech "replies" at 2 AM to a number that never texted the business', async () => {
  const T = await boot();
  try {
    clock.set('2026-11-10T15:00:00Z');
    const A = await T.signup({ plan: 'Growth', business: 'Sinclair Plumbing' });
    await T.approveTexting(A.cid);
    const t = T.as((await T.staffLink(A.cid, 'Tom Tech', 'tech')).base);
    // one real thread, so the inbox is not empty: a customer texts in and the owner's side can answer it
    await T.sms(A.number, '+14785550177', 'Do you do water softeners?');
    assert.equal((await T.all("SELECT thread FROM biz_msgs WHERE client_id = ?1", A.cid)).map(m => m.thread).join(), '4785550177');

    clock.set('2026-11-11T07:00:00Z');   // 2 AM Eastern
    const before = T.world.texts.length;
    const stranger = await t.post('/api/inbox', { action: 'reply', id: 'msg-text-4785557777', text: 'Hello from a number you never texted.' });
    const sent = T.world.texts.slice(before);
    assert.deepEqual({ status: stranger.status, textsSent: sent.length }, { status: 404, textsSent: 0 },
      'a reply to a number with no thread should be refused. Instead ' + JSON.stringify(sent[0]) + ' went out, and the app answered ' + stranger.text);
  } finally { clock.restore(); }
});

test('no ceiling: 70 strangers in one minute, though automatic texts stop at 60 an hour', async () => {
  const T = await boot();
  try {
    clock.set('2026-11-11T07:00:00Z');   // 2 AM Eastern
    const A = await T.signup({ plan: 'Growth', business: 'Sinclair Plumbing' });
    await T.approveTexting(A.cid);
    const t = T.as((await T.staffLink(A.cid, 'Tom Tech', 'tech')).base);
    let ok = 0;
    for (let i = 0; i < 70; i++) { const r = await t.post('/api/inbox', { action: 'reply', id: 'msg-text-47855571' + String(i).padStart(2, '0'), text: 'Big sale this week, call now.' }); if (r.status === 200) ok++; }
    const out = T.world.texts.filter(x => /Big sale/.test(x.Body));
    assert.equal(out.length, 0, out.length + ' texts went to ' + new Set(out.map(x => x.To)).size + ' numbers that never texted this business, at 2 AM, from ' + (out[0] && out[0].From) + ' (' + ok + ' of 70 requests answered ok)');
  } finally { clock.restore(); }
});
