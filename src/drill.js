// The 4 AM test call: every night the system calls Max the way a customer would and checks the whole path worked
// (Twilio, the site, Max's ears, his brain, his voice, the write-up), so a quiet failure is found by us at 4 AM and not
// by a customer at 9. It calls Always Open's own line from a test number of ours that is listed as a tester on that
// line, so the call is marked a test: no lead, no push, not counted.
//
// The test number is bought once, only after Christopher says yes (drill_meta 'buy' = 'approved'; about $1.15 a month
// plus a few cents a night). Until then nothing here runs.
// Pass: Max answered, heard the caller, replied, and the write-up says what the caller wanted. A failure is tried once
// more 15 minutes later; a second failure is an alert (silent at night, so it is in the 7 AM push), and the 7 AM push
// says how the test went either way.
const TW = 'https://api.twilio.com/2010-04-01/Accounts/';
const E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;
const OWN_ID = 'always-open';
const WAIT_MS = 4 * 60e3, RETRY_MS = 15 * 60e3;
const HOUR = 4;
const REJECT = 'https://twimlets.com/echo?Twiml=' + encodeURIComponent('<Response><Reject/></Response>');
// What the test caller says. Max's greeting runs first; the pauses leave room for him to answer.
export const SCRIPT = '<Response><Pause length="10"/><Say voice="Polly.Joanna">Hi. I run a plumbing company in Eatonton, and I would like the free audit. Can someone call me back tomorrow morning?</Say>' +
  '<Pause length="14"/><Say voice="Polly.Joanna">No, that is everything. Thank you. Goodbye.</Say><Pause length="5"/><Hangup/></Response>';
const WANTED = /plumb|audit/i;

const ready = new WeakSet();
export async function ensureDrill(env) {
  if (ready.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS drill_meta (k TEXT PRIMARY KEY, v TEXT)'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS drill_runs (day TEXT PRIMARY KEY, at TEXT, attempt INTEGER DEFAULT 1, call_sid TEXT DEFAULT '', status TEXT DEFAULT '', detail TEXT DEFAULT '')")
  ]);
  ready.add(env.DB);
}
const getMeta = async (env, k) => { const r = await env.DB.prepare('SELECT v FROM drill_meta WHERE k = ?1').bind(k).first().catch(() => null); return r ? r.v : ''; };
const setMeta = (env, k, v) => env.DB.prepare('INSERT OR REPLACE INTO drill_meta (k, v) VALUES (?1, ?2)').bind(k, String(v)).run();
function eastern(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return { day: p.year + '-' + p.month + '-' + p.day, hour: +p.hour % 24 };
}
function tw(env, h, path, form) {
  const f = (h && h.fetch) || fetch;
  const init = { method: form ? 'POST' : 'GET', headers: { authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN) } };
  if (form) { init.headers['content-type'] = 'application/x-www-form-urlencoded'; init.body = new URLSearchParams(form).toString(); }
  return f(TW + env.TWILIO_ACCOUNT_SID + path, init);
}
const ownLine = async env => env.DB.prepare('SELECT number, facts FROM voice_lines WHERE client_id = ?1 AND on_air = 1').bind(OWN_ID).first().catch(() => null);

// Put the test number on the line's tester list, so its calls are tests (voice.js incoming).
async function listAsTester(env, num) {
  const line = await ownLine(env);
  if (!line) return;
  let facts = {};
  try { facts = JSON.parse(line.facts || '{}') || {}; } catch (e) { facts = {}; }
  const list = String(facts.testers || '').split(/[,\s]+/).filter(Boolean);
  if (list.indexOf(num) > -1) return;
  facts.testers = list.concat([num]).join(', ');
  await env.DB.prepare('UPDATE voice_lines SET facts = ?1 WHERE number = ?2').bind(JSON.stringify(facts), line.number).run();
}

// Once approved: a local number that only places the test call (anyone calling it back is turned away).
async function buyNumber(env, h) {
  for (const ac of ['478', '706', '']) {
    const s = await tw(env, h, '/AvailablePhoneNumbers/US/Local.json?VoiceEnabled=true&PageSize=3' + (ac ? '&AreaCode=' + ac : ''));
    const j = await s.json().catch(() => ({}));
    for (const n of (j.available_phone_numbers || []).map(x => x.phone_number).filter(Boolean).slice(0, 2)) {
      const r = await tw(env, h, '/IncomingPhoneNumbers.json', { PhoneNumber: n, FriendlyName: 'Always Open: 4 AM test caller', VoiceUrl: REJECT, VoiceMethod: 'GET' });
      const b = await r.json().catch(() => ({}));
      if (r.ok && b.sid) return b.phone_number || n;
    }
  }
  return '';
}

async function placeCall(env, from, to, h) {
  const r = await tw(env, h, '/Calls.json', { To: to, From: from, Twiml: SCRIPT, Timeout: '25', TimeLimit: '150' });
  const j = await r.json().catch(() => ({}));
  return r.ok && j.sid ? { sid: j.sid } : { error: 'Twilio would not place the test call (' + r.status + (j.message ? ': ' + String(j.message).slice(0, 80) : '') + ')' };
}

// How the call went, from Max's own write-up of it.
export async function judge(env, from, line, since) {
  const c = await env.DB.prepare('SELECT outcome, transcript, summary, details, reason, ai_model FROM app_calls WHERE number = ?1 AND caller = ?2 AND at >= ?3 ORDER BY at DESC LIMIT 1')
    .bind(line, from, new Date(since - 60e3).toISOString()).first().catch(() => null);
  if (!c) return { ok: false, why: 'the test call never reached Max (nothing was written up)' };
  let t = [];
  try { t = JSON.parse(c.transcript || '[]') || []; } catch (e) { t = []; }
  // The greeting is Max's first line; a reply is anything he said after the caller spoke.
  const first = t.findIndex(x => x.w === 'caller');
  const heard = t.filter(x => x.w === 'caller').length, replied = first < 0 ? 0 : t.slice(first + 1).filter(x => x.w === 'ai').length;
  const model = c.ai_model ? ' (' + c.ai_model + ')' : '';
  if (c.outcome === 'live') return { ok: false, why: 'the call never finished its write-up' };
  if (c.outcome === 'failed') return { ok: false, why: 'Max’s line failed on the test call' };
  if (!heard) return { ok: false, why: 'Max answered but heard nothing the caller said' };
  if (!replied) return { ok: false, why: 'Max heard the caller but never answered' + model };
  if (!WANTED.test([c.summary, c.details, c.reason].join(' '))) return { ok: false, why: 'Max’s write-up missed what the caller wanted: “' + String(c.summary || '').slice(0, 120) + '”' + model };
  return { ok: true, why: 'Max answered, heard the caller, replied ' + replied + (replied === 1 ? ' time' : ' times') + ' and wrote it up' + model };
}

// Every 10 minutes; does something only in the 4 AM hour (Eastern) and while a test call is waiting to be judged.
export async function drillCron(env, now, h) {
  now = now || Date.now(); h = h || {};
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)) return { off: true };
  await ensureDrill(env);
  let from = await getMeta(env, 'from');
  if (!E164.test(from)) {
    if (await getMeta(env, 'buy') !== 'approved') return { off: 'no test number yet' };
    from = await buyNumber(env, h);
    if (!from) { await setMeta(env, 'buy', 'failed ' + new Date(now).toISOString()); return { off: 'could not buy a test number' }; }
    await setMeta(env, 'from', from);
  }
  const line = await ownLine(env);
  if (!line || !E164.test(line.number)) return { off: 'no line to call' };
  await listAsTester(env, from);
  const e = eastern(now);
  let run = await env.DB.prepare('SELECT * FROM drill_runs WHERE day = ?1').bind(e.day).first();
  const call = async attempt => {
    const p = await placeCall(env, from, line.number, h);
    await env.DB.prepare("INSERT OR REPLACE INTO drill_runs (day, at, attempt, call_sid, status, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(e.day, new Date(now).toISOString(), attempt, p.sid || '', p.sid ? 'calling' : (attempt === 1 ? 'retry' : 'failed'), p.error || '').run();
    if (!p.sid && attempt > 1) await alert(env, h, p.error);
    return p.sid ? 'calling' : 'could not call';
  };
  if (!run) return e.hour === HOUR ? { placed: await call(1) } : { waiting: 'not the hour' };
  if (run.status === 'retry' && now - Date.parse(run.at) >= RETRY_MS) return { placed: await call(2) };
  if (run.status !== 'calling' || now - Date.parse(run.at) < WAIT_MS) return { status: run.status };
  const v = await judge(env, from, line.number, Date.parse(run.at));
  if (v.ok) { await env.DB.prepare("UPDATE drill_runs SET status = 'passed', detail = ?1 WHERE day = ?2").bind(v.why, e.day).run(); return { passed: v.why }; }
  if (run.attempt < 2) { await env.DB.prepare("UPDATE drill_runs SET status = 'retry', detail = ?1 WHERE day = ?2").bind(v.why, e.day).run(); return { retry: v.why }; }
  await env.DB.prepare("UPDATE drill_runs SET status = 'failed', detail = ?1 WHERE day = ?2").bind(v.why, e.day).run();
  await alert(env, h, v.why);
  return { failed: v.why };
}
async function alert(env, h, why) {
  const send = h.alert || (async (t, d) => (await import('./ops.js')).opsAlert(env, t, '', d));
  await send('drill', 'The 4 AM test call to Max failed twice: ' + why + '. Real callers still reach Max or the voicemail backup; check the call in the ops board before the day starts.');
}

// For the 7 AM push: how last night's test call went, in a few words (or '' before there is a test number).
export async function drillLine(env, now) {
  try {
    await ensureDrill(env);
    const r = await env.DB.prepare('SELECT status, detail FROM drill_runs WHERE day = ?1').bind(eastern(now || Date.now()).day).first();
    if (!r) return (await getMeta(env, 'from')) ? 'The 4 AM test call did not run.' : '';
    if (r.status === 'passed') return 'The 4 AM test call passed.';
    if (r.status === 'failed') return 'The 4 AM test call failed: ' + r.detail + '.';
    return 'The 4 AM test call is still being checked.';
  } catch (e) { return ''; }
}
