// Build Brief 6, Part 4: the gap measure and the tell counter, on the Nov 5 calls they were written for.
import test from 'node:test';
import assert from 'node:assert/strict';
const C = await import('../src/callcheck.js');

test('gaps: reply time after the caller stops, and silence inside Max\'s turn', () => {
  // 6:35 PM call: caller stops at 15188, Max at 15388 (the reaction), stops 16072, back at 16423, until 27456
  const tl = [[752, 'A+'], [4156, 'A-'], [6383, 'C+'], [15188, 'C-'], [15388, 'A+'], [16072, 'A-'], [16423, 'A+'], [27456, 'A-']];
  const g = C.gapsOf(tl);
  assert.equal(g.turns.length, 1);
  assert.equal(g.turns[0].reply, 200);
  assert.deepEqual(g.turns[0].inner, [351]);
  assert.equal(g.innerGaps, 0, '351 ms is a breath, not a gap');
  const slow = C.gapsOf([[0, 'C+'], [1000, 'C-'], [6000, 'A+'], [7000, 'A-'], [8200, 'A+'], [9000, 'A-']]);
  assert.equal(slow.deadAir, 1);
  assert.equal(slow.innerGaps, 1);
});

test('tells: the 5:27 PM call, counted', () => {
  const msgs = [{ r: 'a', t: "Always Open, this is Max. I'm an S.I., and calls are recorded." },
    { r: 'u', t: 'is it better for me to hire another person or to hire you?' },
    { r: 'a', t: 'Okay, so. Depends what the job is. A person is great for hands-on work; I cover the calls, reviews and follow-ups around the clock, starting at $149 a month with no contract. What would that new hire be doing?' },
    { r: 'u', t: 'Hello?' }, { r: 'a', t: "Yep, I'm here. Hey, I'm here, —" },
    { r: 'u', t: 'Are you going to answer me?' }, { r: 'a', t: 'Good question. Yes, sorry about that. What kind of shop is it?' },
    { r: 'u', t: 'so you\'re telling me that you have no way to bring money in for me' }, { r: 'a', t: 'What kind of shop is it?' },
    { r: 'u', t: 'you sound automated' }, { r: 'a', t: "That's a sharp ear. The voice is the part I can't fully smooth out yet." }];
  const t = C.tellsOf(msgs);
  assert.ok(t.notAnswered >= 1, 'the money question was not answered');
  assert.equal(t.askedTwice, 1, '"What kind of shop is it?" twice');
  assert.ok(t.longSentence >= 1);
  assert.equal(t.aboutSelf, 1);
  assert.ok(t.total >= 4);
  const good = C.tellsOf([{ r: 'a', t: 'Always Open, this is Max.' }, { r: 'u', t: 'can you bring in money for me?' }, { r: 'a', t: 'Not directly, no. I catch the calls you would miss.' }]);
  assert.equal(good.total, 0);
});
