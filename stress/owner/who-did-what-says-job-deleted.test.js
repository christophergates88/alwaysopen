// BUG: the owner's "Who did what" list records things that did not happen.
// The wording comes from ACT in src/biz.js:95-112, and it is written whenever the request answers 200:
//   - /api/work: anything that is not stage/add/amount reads "Deleted job #N". So "Text them I'm on the way" and
//     "Cancel visit" are both logged as the job being deleted.
//   - /api/inbox: every request reads "Sent a Facebook reply", including marking a text thread as read.
//   - /api/invoice with a wrong id answers 200 {"ok":false} and is still logged as "Marked invoice #N paid".
// Run: node --test stress/owner/who-did-what-says-job-deleted.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_setup.mjs';

test('a tech taps "on the way"; the owner reads that the tech deleted the job', async () => {
  const T = await boot();
  try {
    clock.set('2026-11-10T15:00:00Z');
    const A = await T.signup({ plan: 'Pro', business: 'Sinclair Plumbing' });
    await T.approveTexting(A.cid);
    const a = T.as(A.base), t = T.as((await T.staffLink(A.cid, 'Tom Tech', 'tech')).base);
    const job = (await a.post('/api/work', { action: 'add', name: 'Jo Job', phone: '478-555-0111', title: 'Sink' })).json().job.id;
    await a.post('/api/work', { action: 'stage', id: job, stage: 'booked' });

    const r = await t.post('/api/work', { action: 'onway', id: job, minutes: 20 });
    assert.equal(r.status, 200, r.text);
    assert.match(T.world.texts.at(-1).Body, /^Tom Tech from Sinclair Plumbing is on the way/);
    assert.ok(await T.get('SELECT id FROM biz_jobs WHERE id = ?1', job), 'the job is still there');

    await t.post('/api/inbox', { action: 'read', id: 'msg-text-4785550111' });      // only marks a thread as read
    await a.post('/api/invoice', { action: 'paid', id: 987654 });                   // no such invoice: {"ok":false}

    const log = (await a.state()).activity.map(x => x.who + ': ' + x.what);
    const wrong = log.filter(x => /Deleted job|Facebook reply|Marked invoice #987654 paid/.test(x));
    assert.deepEqual(wrong, [], 'lines in the owner’s "Who did what" for things that never happened');
  } finally { clock.restore(); }
});
