import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { addrReadback, callerNotes, callLang, leadIn, systemPrompt, lineView, transferMissedLine, callTextBody, openHoursNow, addDuties } = await import('../src/voice.js');
const { unsafeAdvice, gradeOf, failuresOf } = await import('../src/grades.js');
const { KINDS } = await import('../src/outcalls.js');

const line = (extra) => Object.assign({ business: "Mike's Plumbing", town: 'Eatonton', client_id: 'c1', facts: JSON.stringify({ services: 'Plumbing', next: 'On an emergency Mike calls back within 15 minutes.' }), owner_set: '{}' }, extra || {});
const st = (msgs) => ({ msgs: msgs || [], line: lineView(line()), urgent: false, upset: false, wantPerson: 0 });

test('the address read back is the one the caller said, worked out in code (the Nov 1 "Eighty-eight-twelve Main" call)', () => {
  assert.deepEqual(addrReadback('Eleven forty Oak Lane, Eatonton.'), { digits: '1140', street: 'Oak Lane', say: 'One-one-four-oh Oak Lane' });
  assert.equal(addrReadback('eight eight twelve Main Street').digits, '8812');
  assert.equal(addrReadback('one hundred twelve north oak drive').say, 'One-one-two North Oak Drive');
  assert.equal(addrReadback('one oh five cedar ct').say, 'One-oh-five Cedar Court');
  assert.equal(addrReadback('I live on Main Street'), null);
  assert.equal(addrReadback('the one on Main Street'), null);
  const note = callerNotes(st([{ r: 'a', t: 'Hi' }, { r: 'u', t: 'My basement is flooding.' }, { r: 'a', t: 'What is the address?' }]), 'Eleven forty Oak Lane, Eatonton.');
  assert.match(note, /"One-one-four-oh Oak Lane, right\?"/);
  assert.doesNotMatch(note, /Main|Eight-eight/);
});

test('Spanish stays Spanish: quick reactions follow the call, not just the last line', () => {
  const msgs = [{ r: 'a', t: 'Hi' }, { r: 'u', t: 'Hola, huele a gas en mi cocina.' }, { r: 'a', t: 'Salga de la casa.' }];
  assert.equal(callLang('en-US', msgs, 'Estoy en cuatro doce Pine Street, Eatonton.'), 'es-US');
  const lead = leadIn('Estoy en cuatro doce Pine Street, Eatonton.', callLang('en-US', msgs, 'x'), [], () => 0);
  assert.ok(lead && !/^(Sure|Right|Got it|Okay|Gotcha|Alright)/.test(lead.text), lead && lead.text);
  assert.equal(callLang('en-US', [{ r: 'u', t: 'My sink is leaking' }], 'It is under the cabinet'), 'en-US');
  const es = callerNotes(Object.assign(st(msgs), { lang: 'en-US' }), 'Estoy en cuatro doce Pine Street, Eatonton.');
  assert.match(es, /every word of your answer in Spanish, no English fillers/);
  assert.doesNotMatch(callerNotes(Object.assign(st([{ r: 'u', t: 'My sink leaks' }]), { lang: 'en-US' }), 'It is under the cabinet'), /Spanish/);
});

test('Max is told never to send anyone into water or near electricity or gas', () => {
  const p = systemPrompt(lineView(line()), '', 'en-US', false);
  assert.match(p, /never into water or touch power or gas/);
  const after = callerNotes(st([{ r: 'u', t: 'My panel is buzzing' }, { r: 'a', t: "We don't do electrical work. We're a plumbing company, so I can't send anyone for the panel." }]), 'Yes please send someone, 55 Cedar Ct Eatonton.');
  assert.match(after, /never imply anyone from here will come for it/i);
  const danger = callerNotes(st([{ r: 'a', t: 'Hi' }]), 'I smell smoke and my electric panel is sparking, also do you do electrical?');
  assert.match(danger, /danger call/);
  assert.match(danger, /Never tell them to touch, switch or shut off anything/);
  const wet = callerNotes(st([{ r: 'a', t: 'Hi' }]), 'Water is coming up through the floor drain near the outlets.');
  assert.match(wet, /stay out of the water and away from outlets/);
});

test('risky advice is caught in what Max said (the Nov 1 rehearsal lines), and saying not to is fine', () => {
  for (const t of [
    'If you can, stay out of the water and shut off the power to the basement if it\'s near the flooding.',
    'If you can do it safely, shut off the main breaker and get everyone out of the house.',
    'No prenda ni apague luces, y si puede, cierre la válvula de gas del medidor.',
    'Head down into the basement and check the drain.'
  ]) assert.ok(unsafeAdvice(t), t);
  for (const t of [
    'Please keep your distance from the panel and don\'t touch it.',
    'Keep out of the water near any outlets.',
    'Shut the main water valve if you can reach it safely.',
    'Get everyone out of the house and call 911 right now.'
  ]) assert.equal(unsafeAdvice(t), '', t);
  const g = gradeOf({ outcome: 'ended', heard: 4, note: { nextStep: true }, maxText: 'Okay. Shut off the main breaker.' });
  assert.equal(g.unsafe, 1);
  assert.ok(failuresOf(g).includes('unsafe advice'));
  assert.equal(gradeOf({ outcome: 'ended', heard: 4, note: { nextStep: true }, maxText: 'Stay away from the panel.' }).unsafe, 0);
});

test('a put-through nobody answers ends with the business\'s own callback promise', () => {
  assert.equal(transferMissedLine(lineView(line()), 'en-US'), 'They could not pick up right now, but they have your message as urgent. On an emergency Mike calls back within 15 minutes. Goodbye.');
  assert.match(transferMissedLine(null, 'en-US'), /as soon as they can/);
  assert.match(transferMissedLine(null, 'es-US'), /devolverán la llamada/);
});

test('the owner\'s after-call text: who, what, how urgent, the number', () => {
  const t = callTextBody({ max: 'Max', name: 'Dave Miller', callback: '+14785550199', urgent: true, what: 'Basement flooding at 1140 Oak Lane, water coming up the floor drain.' });
  assert.equal(t, 'Max: URGENT call from Dave Miller.\nBasement flooding at 1140 Oak Lane, water coming up the floor drain.\nCall back: (478) 555-0199');
  assert.match(callTextBody({ callback: '+14785550123', missed: true, what: 'They hung up before leaving a message.' }), /^Max: Missed call from \(478\) 555-0123\./);
  assert.ok(callTextBody({ name: 'A', what: 'x '.repeat(300) }).length < 300);
  assert.equal(KINDS.summary.def, 1);
  assert.ok(KINDS.summary.owner);
});

test('daytime overflow: weekdays 8 to 6 in the business\'s time', () => {
  assert.ok(openHoursNow('America/New_York', Date.parse('2026-11-04T15:00:00Z')));   // Wed 10 AM
  assert.ok(!openHoursNow('America/New_York', Date.parse('2026-11-04T23:30:00Z')));  // Wed 6:30 PM
  assert.ok(!openHoursNow('America/New_York', Date.parse('2026-11-07T15:00:00Z')));  // Sat
});

test('the owner\'s job description goes into Max\'s instructions; Teach-tab prices survive until it is saved', async () => {
  const L = lineView(line({ facts: JSON.stringify({ prices: 'Service call $89' }) }));
  await addDuties(L, line({ facts: JSON.stringify({ prices: 'Service call $89' }) }));
  assert.ok(Array.isArray(L.duties) && L.duties.length > 2);
  assert.ok(!L.duties.some(x => /^Never give a price/.test(x)));
  const p = systemPrompt(L, '', 'en-US', false);
  assert.match(p, /Your job description, set by the owner/);
  const L2 = lineView(line({ owner_set: JSON.stringify({ duties: { prices: false } }) }));
  await addDuties(L2, line({ owner_set: JSON.stringify({ duties: { prices: false } }) }));
  assert.ok(L2.duties.some(x => /^Never give a price/.test(x)));
});
