// Call grades: what each call earns, which calls become rehearsals, and the Monday summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDB } from './rehearsal/harness.js';
import { gradeOf, failuresOf, median, saveGrade, queueFromCall, queueSet, statsFor, weeklyGrade, weekLine, maxBoard, ownerStats } from '../src/grades.js';

const DAY = 864e5;

test('median ignores zeros and junk', () => {
  assert.equal(median([600, 400, 0, 'x', 900]), 600);
  assert.equal(median([400, 800]), 600);
  assert.equal(median([]), 0);
});

test('a booked call with a clean next step has no failures', () => {
  const g = gradeOf({ outcome: 'done', heard: 4, seconds: 95, lat: [500, 700, 650], note: { name: 'Dana', callback: '+14785550142', booked: 'yes', nextStep: true }, booked: true });
  assert.equal(g.booked, 1); assert.equal(g.hangup_early, 0); assert.equal(g.next_step, 1); assert.equal(g.first_word_ms, 650); assert.equal(g.max_word_ms, 700);
  assert.deepEqual(failuresOf(g), []);
});

test('a silent hang-up counts as hung up early and is never rehearsed', () => {
  const g = gradeOf({ outcome: 'hangup', heard: 0, seconds: 4, lat: [], note: null });
  assert.equal(g.hangup_early, 1); assert.equal(g.turns, 0);
  assert.deepEqual(failuresOf(g), []);
});

test('one short turn with no name, number or next step counts as hung up early', () => {
  const g = gradeOf({ outcome: 'done', heard: 1, seconds: 12, lat: [600], note: { name: '', callback: '', nextStep: false } });
  assert.equal(g.hangup_early, 1);
});

test('a misheard number and a repeated question become failures; spam never does', () => {
  const g = gradeOf({ outcome: 'done', heard: 5, seconds: 120, lat: [600], note: { name: 'Al', misheard: true, askedTwice: true, nextStep: false } });
  assert.deepEqual(failuresOf(g), ['misheard', 'asked twice', 'no next step']);
  const sp = gradeOf({ outcome: 'spam', heard: 5, seconds: 60, lat: [], note: { spam: true, misheard: true } });
  assert.equal(sp.spam, 1); assert.deepEqual(failuresOf(sp), []);
});

test('grades save, failing calls queue rehearsals (at most three a day), the set keeps 20 and replays', async () => {
  const DB = makeDB(); const env = { DB };
  const msgs = [{ r: 'a', t: 'Hi' }, { r: 'u', t: 'My water heater is leaking' }, { r: 'a', t: 'Name?' }, { r: 'u', t: 'Dana, four seven eight' }];
  for (let i = 0; i < 5; i++) {
    const call = { id: 'CA' + String(i).padStart(32, '0'), client_id: 'c1', number: '+14785550100', at: new Date().toISOString() };
    const g = gradeOf({ outcome: 'done', heard: 2, seconds: 50, lat: [600], note: { name: 'Dana', misheard: true } });
    await saveGrade(env, call, g);
    await queueFromCall(env, call, msgs, failuresOf(g));
  }
  const req = (await DB.prepare("SELECT detail FROM voice_log WHERE kind = 'rehearse-request'").all()).results;
  assert.equal(req.length, 3, 'three automatic rehearsals a day at most');
  const j = JSON.parse(req[0].detail);
  assert.deepEqual(j.calls, [['My water heater is leaking', 'Dana, four seven eight']], 'only the caller\'s own lines are replayed');
  assert.equal(j.number, '+14785550100');
  const set = (await DB.prepare("SELECT COUNT(*) AS n FROM voice_log WHERE kind = 'rehearse-set'").first()).n;
  assert.equal(set, 5);
  assert.equal(await queueSet(env), 5, 'the whole set can be replayed after a change');
  const graded = (await DB.prepare('SELECT COUNT(*) AS n FROM call_grades').first()).n;
  assert.equal(graded, 5);
  const row = await DB.prepare('SELECT * FROM call_grades LIMIT 1').first();
  assert.equal(Object.keys(row).some(k => /name|caller|phone|transcript/.test(k)), false, 'grades hold no names, numbers or words');
});

test('Monday: week against week, text only when hang-ups rise by more than 10 points', async () => {
  const DB = makeDB(); const env = { DB };
  const now = Date.parse('2026-11-02T12:17:00Z');
  const put = async (i, daysAgo, early, booked) => saveGrade(env, { id: 'CA' + String(i).padStart(32, '0'), client_id: 'c1', at: new Date(now - daysAgo * DAY).toISOString() },
    gradeOf({ outcome: early ? 'hangup' : 'done', heard: early ? 0 : 3, seconds: 60, lat: early ? [] : [600, 900], note: early ? null : { name: 'X', booked: booked ? 'yes' : '', nextStep: true } }));
  let i = 0;
  for (let k = 0; k < 4; k++) await put(i++, 10, k === 0, k === 1);   // last week: 1 of 4 hung up (25%)
  for (let k = 0; k < 4; k++) await put(i++, 2, k < 3, k === 3);       // this week: 3 of 4 hung up (75%)
  const pings = [];
  const out = await weeklyGrade(env, now, async (t, b) => { pings.push([t, b]); });
  assert.equal(out.week.calls, 4); assert.equal(out.week.hungUp, 3); assert.equal(out.week.hangupShare, 75); assert.equal(out.prev.hangupShare, 25);
  assert.equal(pings.length, 1); assert.match(pings[0][1], /25% to 75%/);
  assert.equal(await weeklyGrade(env, now, async () => pings.push(1)), null, 'once per Monday');
  const board = await maxBoard(env);
  assert.equal(board.length, 1); assert.match(board[0].detail, /4 calls, 1 booked, 3 hung up early/);
  const mine = await ownerStats(env, 'c1', now);
  assert.equal(mine.calls, 8); assert.equal(mine.booked, 2);
  const quiet = await weeklyGrade(makeDBEnv(), now, async () => { throw new Error('should not text'); });
  assert.equal(quiet.pinged, false);
});

test('the week line reads plainly', () => {
  assert.equal(weekLine({ calls: 0 }), 'No calls this week.');
  assert.match(weekLine({ calls: 1, booked: 0, hungUp: 0, hangupShare: 0, firstWordMs: 640 }), /^1 call, 0 booked, 0 hung up early \(0%\)\. Max's answers start about 0\.6 s/);
});

function makeDBEnv() { return { DB: makeDB() }; }
