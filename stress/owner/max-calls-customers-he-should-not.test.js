// BUG: Max phones a customer about something the owner already closed.
//  1. An appointment the owner removed (the customer cancelled): Max's second "confirm your appointment" try still goes
//     out. outCallsCron dials every pending row in outcalls and place() never looks back at the follow-up it came from
//     (src/outcalls.js:99-123 and the loop at the end of outCallsCron).
//  2. A call-back the owner already marked Done: "30 more minutes" on it (a second tap, or a second person whose screen
//     has not refreshed) puts it back to pending and Max calls the customer to say the owner needs thirty more minutes
//     (src/callbacks.js:250-262: the row's status is never checked).
// Run: node --test stress/owner/max-calls-customers-he-should-not.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_setup.mjs';

test('the customer cancels and the owner removes the appointment; three hours later Max calls her to confirm it', async () => {
  const T = await boot();
  try {
    let now = Date.parse('2026-11-10T15:00:00Z'); clock.set(now);   // Tuesday 10 AM Eastern
    const A = await T.signup({ plan: 'Pro', business: 'Sinclair Plumbing' });
    const a = T.as(A.base);
    await T.approveTexting(A.cid);
    const fu = (await a.post('/api/followup', { kind: 'appointment', name: 'Cara Customer', phone: '478-555-0188', due: '2026-11-11', time: '14:00', consent: true, by: 'Dana' })).json().followup;
    now += 10 * 60e3; clock.set(now); await T.cron();
    assert.deepEqual(T.world.dialed.map(d => d.To), ['+14785550188'], 'the day before, Max calls to confirm: as designed');
    const oc = await T.get("SELECT id FROM outcalls WHERE kind = 'confirm'");
    await T.hook('ocstatus', { CallSid: T.world.dialed[0].sid, CallStatus: 'no-answer' }, 'id=' + oc.id);   // she did not pick up

    assert.equal((await a.post('/api/followup', { action: 'remove', id: fu.id })).json().status, 'removed', 'she rang the shop and cancelled; the owner removes it');
    now += 3 * 3600e3 + 10 * 60e3; clock.set(now); await T.cron();
    const again = T.world.dialed.slice(1);
    let heard = '';
    if (again.length) heard = (await T.hook('oc', { CallSid: again[0].sid, AnsweredBy: 'human' }, 'id=' + oc.id)).text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    assert.equal(again.length, 0, 'Max called ' + (again[0] && again[0].To) + ' again about the removed appointment and said: "' + heard + '"');
  } finally { clock.restore(); }
});

test('the owner calls the customer back and taps Done; "30 more minutes" on the same card still has Max ring the customer', async () => {
  const T = await boot();
  try {
    clock.set('2026-11-10T15:00:00Z');
    const A = await T.signup({ plan: 'Growth', business: 'Sinclair Plumbing' });
    const a = T.as(A.base), office = T.as((await T.staffLink(A.cid, 'Olive Office', 'manager')).base);
    await T.fullCall(A.number, '+14785550142', 'Please have someone call me back', { name: 'Vic', callback: '+14785550142', reason: 'Leak', details: '', when: '', urgent: false, callback_wanted: true, callback_at: '', booked: '', spam: false, summary: 'Wants a call back.' });
    const cb = (await office.state()).callbacks.list[0];
    assert.ok(cb, 'the call-back promise shows on both phones');
    assert.equal((await a.post('/api/callbacks', { action: 'done', id: cb.id })).json().ok, true, 'the owner calls Vic and taps Done');

    const before = T.world.dialed.length;
    const later = await office.post('/api/callbacks', { action: 'later', id: cb.id });   // the office phone still shows the card
    const row = await T.get('SELECT status FROM callbacks WHERE id = ?1', cb.id);
    assert.deepEqual({ callsToVic: T.world.dialed.slice(before).length, status: row.status }, { callsToVic: 0, status: 'done' }, 'the app answered: ' + later.text);
  } finally { clock.restore(); }
});
