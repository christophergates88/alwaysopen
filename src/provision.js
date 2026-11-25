// New clients get Max's line on their own. Right after payment we buy a phone number near them, point it at Max, and
// put the line on the air; the welcome page shows the number and the steps to forward missed calls to it. Nobody at
// Always Open has to do anything. If Twilio can't do it right then, the 10-minute timer keeps trying, and Christopher
// hears about it only if it still fails.
// When a client cancels, Max stops answering at once; the number is released 60 days later (terms say so), with a
// heads-up to Christopher and the owner a week before, unless the client is active again by then.
const SITE = 'https://alwaysopenoffice.com';
const TW = 'https://api.twilio.com/2010-04-01/Accounts/';
// Nov 24, 2026: after the six quick tries (about 50 minutes) it used to stop for good, with the owner told nothing. Now it
// keeps trying once an hour; Christopher still gets his two pushes, and the owner hears once.
const MAX_TRIES = 6, SLOW_MS = 55 * 60e3, RELEASE_DAYS = 60;

let ready = false;
export async function ensureProvision(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS provision (client_id TEXT PRIMARY KEY, status TEXT DEFAULT 'queued', number TEXT DEFAULT '', number_sid TEXT DEFAULT '', tries INTEGER DEFAULT 0, error TEXT DEFAULT '', created TEXT, updated TEXT, ended TEXT DEFAULT '', warned TEXT DEFAULT '')").run();
  ready = true;
}

const ph10 = s => { let d = String(s || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? d : ''; };
export const pretty = e => { const d = ph10(e); return d ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : ''; };
const STATES = { AL: 1, AK: 1, AZ: 1, AR: 1, CA: 1, CO: 1, CT: 1, DE: 1, DC: 1, FL: 1, GA: 1, HI: 1, ID: 1, IL: 1, IN: 1, IA: 1, KS: 1, KY: 1, LA: 1, ME: 1, MD: 1, MA: 1, MI: 1, MN: 1, MS: 1, MO: 1, MT: 1, NE: 1, NV: 1, NH: 1, NJ: 1, NM: 1, NY: 1, NC: 1, ND: 1, OH: 1, OK: 1, OR: 1, PA: 1, RI: 1, SC: 1, SD: 1, TN: 1, TX: 1, UT: 1, VT: 1, VA: 1, WA: 1, WV: 1, WI: 1, WY: 1 };
export function stateOf(town) { const m = /,\s*([A-Za-z]{2})\s*$/.exec(String(town || '').trim()); const s = m ? m[1].toUpperCase() : ''; return STATES[s] ? s : ''; }

// The kind of work, for Max's instructions, hand-offs and the texting registration. The name says more than the signup box.
// Regulated kinds first, so a word like "harbor" or "auto" in a dental office's, agency's or law firm's name can never
// make it a trade (a trade's Max books jobs; theirs only takes messages).
const BY_NAME = [[/\bdental\b|\bdentist/, 'dental'], [/\binsurance\b/, 'insurance'], [/\blaw\b|\battorneys?\b|\blegal\b/, 'legal'], [/\bplumb/, 'plumbing'], [/\bhvac\b|\bheating\b|\bcooling\b|\bair cond|\bheat\b/, 'hvac'], [/\belectric/, 'electrical'], [/\broof/, 'roofing'], [/\blandscap|\blawn|\bmow/, 'landscaping'], [/\bpest\b|\btermite|\bexterminat/, 'pest control'],
  [/\bpools?\b/, 'pools'], [/\bpaint/, 'painting'], [/\btrees?\b/, 'tree service'], [/\bpressure wash|\bpower wash/, 'pressure washing'], [/\bclean|\bmaids?\b/, 'cleaning'], [/\bfenc/, 'fencing'], [/\bconcrete\b|\bpaving\b/, 'concrete'],
  [/\bgarage doors?\b/, 'garage doors'], [/\bseptic\b/, 'septic'], [/\bgutters?\b/, 'gutters'], [/\bfloor/, 'flooring'], [/\bremodel|\bconstruct|\bbuilders?\b|\bbuilding\b/, 'builders'], [/\bmoving\b|\bmovers\b/, 'moving'], [/\btow(ing)?\b/, 'towing'],
  [/\bauto\b|\bautomotive\b|\btires?\b|\bmechanic|\bcollision\b|\btransmission|\bdetail/, 'auto repair'], [/\bdocks?\b/, 'docks'], [/\bmarinas?\b(?!['’]s)|\byacht club\b|\bboat rentals?\b/, 'marina'], [/\bmarine\b|\bboats?\b/, 'marine'], [/\bbarber/, 'barber'], [/\bsalon\b|\bhair\b|\bnails?\b|\bbeauty\b/, 'salon'], [/\bfitness\b|\bgym\b|\byoga\b|\bpilates\b/, 'fitness'],
  [/\bgroom/, 'pet grooming'], [/\bclinic\b|\bmedical\b|\bchiropract|\btherap|\bdoctors?\b/, 'medical'], [/\brestaurant\b|\bcafe\b|\bgrill\b|\bbbq\b|\bpizza\b|\bbakery\b|\bdiner\b/, 'restaurant'], [/\bfoam\b|\bparty\b|\bparties\b|\bevents?\b|\brentals?\b/, 'party rentals']];
const BY_TYPE = { 'Contractor or trade': 'contractor', 'Dock, marine or outdoor': 'marine', 'Salon, spa or fitness': 'salon', 'Restaurant or shop': 'restaurant', 'Insurance agency': 'insurance', 'Medical, dental or legal': 'medical', 'Law office': 'legal', 'Medical or dental office': 'medical', 'Medical, dental or vet': 'medical' };
export function industryOf(business, type) {
  const n = String(business || '').toLowerCase();
  if (type === 'Insurance agency') return 'insurance';
  if (type === 'Law office') return 'legal';
  const med = /^Medical, dental or (legal|vet)$/.test(String(type || ''));
  for (const [re, k] of BY_NAME) if (re.test(n)) return med && !/dental|legal|medical/.test(k) ? 'medical' : k;
  return BY_TYPE[type] || '';
}

// Where to look for a number, nearest first.
// What a caller hears if our webhook ever fails: the voicemail backup, served by Twilio itself so it works when we are
// down (voicemail.js). It never rings the owner's cell: at 3 AM that woke them because our server was down.
import { voicemailTwiml, fallbackUrl } from './voicemail.js';
import { ensureLineTz, zoneGuess, stateOfTown, zonesOfState, zonesOfNumber } from './callbacks.js';
export { voicemailTwiml as fallbackTwiml, fallbackUrl };

export function searches(phone, town) {
  const d = ph10(phone), st = stateOf(town) || stateOfTown(town), out = [];
  // Nov 24, 2026: a Phoenix shop whose owner kept a Georgia cell got a Georgia number. When the town's state is known and
  // the cell's area code sits in none of that state's time zones, the town's state is searched first.
  const zs = st ? zonesOfState(st) : [], cz = d ? zonesOfNumber(d) : [];
  const away = !!(st && d && zs.length && cz.length && !cz.some(z => zs.indexOf(z) > -1));
  if (away) out.push('InRegion=' + st);
  if (d) out.push('AreaCode=' + d.slice(0, 3));
  if (d) out.push('NearNumber=' + encodeURIComponent('+1' + d) + '&Distance=60');
  if (st && !away) out.push('InRegion=' + st);
  out.push('');
  return out;
}

async function tw(env, method, path, form) {
  const r = await fetch(TW + env.TWILIO_ACCOUNT_SID + path, { method, headers: Object.assign({ authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN) }, form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), body: form ? new URLSearchParams(form).toString() : undefined });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

async function row(env, cid) { await ensureProvision(env); return env.DB.prepare('SELECT * FROM provision WHERE client_id = ?1').bind(cid).first(); }
export async function queueLine(env, cid) {
  await ensureProvision(env);
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT OR IGNORE INTO provision (client_id, status, created, updated) VALUES (?1, 'queued', ?2, ?2)").bind(cid, now).run();
}

// Buy and connect. Safe to call from the webhook, the welcome page and the timer at once: only one gets the claim.
// Returns { status: 'live' | 'working' | 'failed' | 'queued', number, numberText }.
export async function provisionLine(env, cid) {
  await queueLine(env, cid);
  const have = await env.DB.prepare('SELECT number FROM voice_lines WHERE client_id = ?1 LIMIT 1').bind(cid).first();
  if (have) {
    await env.DB.prepare("UPDATE provision SET status = 'live', number = CASE WHEN number = '' THEN ?1 ELSE number END, updated = ?2 WHERE client_id = ?3 AND status != 'live'").bind(have.number, new Date().toISOString(), cid).run();
    return { status: 'live', number: have.number, numberText: pretty(have.number) };
  }
  const now = new Date().toISOString();
  const claim = await env.DB.prepare("UPDATE provision SET status = 'working', tries = tries + 1, updated = ?1 WHERE client_id = ?2 AND (status IN ('queued', 'failed') OR (status = 'working' AND updated < ?3)) AND (tries < ?4 OR updated < ?5)")
    .bind(now, cid, new Date(Date.now() - 5 * 60e3).toISOString(), MAX_TRIES, new Date(Date.now() - SLOW_MS).toISOString()).run();
  if (!(claim.meta && claim.meta.changes)) { const r = await row(env, cid); return { status: (r && r.status) || 'queued', number: (r && r.number) || '', numberText: pretty(r && r.number) }; }
  const fail = async why => {
    await env.DB.prepare("UPDATE provision SET status = 'failed', error = ?1, updated = ?2 WHERE client_id = ?3").bind(String(why).slice(0, 300), new Date().toISOString(), cid).run().catch(() => null);
    const r = await env.DB.prepare('SELECT tries FROM provision WHERE client_id = ?1').bind(cid).first().catch(() => null);
    const tries = r ? +r.tries : 0;
    if (tries === 2 || tries === MAX_TRIES) { try { await (await import('./app.js')).opsPing(env, 'Always Open: could not set up Max’s line', 'For ' + ((b && b.business) || cid) + ': ' + why + (tries >= MAX_TRIES ? ' It keeps trying once an hour, and the owner was told it is taking longer than usual. Fix it in Twilio, or set the line up by hand.' : ' It keeps trying every 10 minutes.'), 'high', 'warning'); } catch (e) {} }
    if (tries === MAX_TRIES && c) await slowNote(env, cid, b).catch(() => null);
    return { status: 'failed', number: '', numberText: '', error: why };
  };
  const b = await env.DB.prepare('SELECT business, phone, town, type, email FROM billing WHERE client_id = ?1').bind(cid).first().catch(() => null);
  const c = await env.DB.prepare('SELECT business, phone, regulated FROM app_clients WHERE client_id = ?1').bind(cid).first();
  if (!c) return fail('no such client');
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.VOICE_KEY)) return fail('The Twilio keys are not set on the worker.');
  const business = (b && b.business) || c.business || '', town = (b && b.town) || '';
  // Every number is named with the client's id. If an earlier try bought one but stopped before writing it down, that
  // number is found here and used, never a second one bought.
  const fname = ('Always Open ' + cid + ': ' + business).slice(0, 64);
  let bought = null, lastErr = '';
  try {
    const mine = await tw(env, 'GET', '/IncomingPhoneNumbers.json?PageSize=5&FriendlyName=' + encodeURIComponent(fname));
    const n0 = ((mine.j && mine.j.incoming_phone_numbers) || []).find(x => x.phone_number && x.sid);
    if (n0) bought = { number: n0.phone_number, sid: n0.sid };
  } catch (e) { /* buying below still works */ }
  for (const q of (bought ? [] : searches((b && b.phone) || c.phone, town))) {
    const s = await tw(env, 'GET', '/AvailablePhoneNumbers/US/Local.json?VoiceEnabled=true&SmsEnabled=true&ExcludeAllAddressRequired=true&PageSize=5' + (q ? '&' + q : ''));
    const list = (s.j.available_phone_numbers || []).map(x => x.phone_number).filter(Boolean);
    for (const num of list.slice(0, 3)) {
      const r = await tw(env, 'POST', '/IncomingPhoneNumbers.json', {
        PhoneNumber: num, FriendlyName: fname,
        VoiceUrl: SITE + '/voice/in/' + env.VOICE_KEY, VoiceMethod: 'POST', StatusCallback: SITE + '/voice/status/' + env.VOICE_KEY, StatusCallbackMethod: 'POST',
        VoiceFallbackUrl: fallbackUrl(business, env.VOICE_KEY), VoiceFallbackMethod: 'GET',
        SmsUrl: SITE + '/voice/sms/' + env.VOICE_KEY, SmsMethod: 'POST'
      });
      if (r.ok && r.j.sid) { bought = { number: r.j.phone_number || num, sid: r.j.sid }; break; }
      lastErr = String((r.j && r.j.message) || ('Twilio answered ' + r.status)).slice(0, 160);
      if (r.status === 401 || r.status === 403 || /balance|funds|suspended/i.test(lastErr)) break;
    }
    if (bought || /balance|funds|suspended/i.test(lastErr)) break;
  }
  if (!bought) return fail(lastErr ? 'Twilio would not sell a number: ' + lastErr : 'No numbers with calls and texts were available near them.');
  const at = new Date().toISOString();
  // The business's time zone, for its call-back times, check-in calls, open slots and quiet hours: from its state, or
  // its own phone's area code, or the number we just bought near it.
  await ensureLineTz(env);
  const zg = zoneGuess({ town, phone: (b && b.phone) || c.phone, number: bought.number }), tz = zg.tz;
  // Nov 24, 2026: no state could be read from the town, so the zone came from a phone number or the Eastern default.
  // Call hours, quiet hours and after-hours all hang on it, so the operator is told once and can set it right.
  if (zg.guessed) { try { await (await import('./ops.js')).opsAlert(env, 'zone-unknown', cid, 'Could not tell which state ' + business + ' is in from the town they typed ("' + String(town || '').slice(0, 60) + '"). Their clock was set to ' + tz + ' from a phone number or the default. If that is wrong, set the right zone on their line.'); } catch (e) { /* the line is still set up */ } }
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO voice_lines (number, client_id, business, on_air, regulated, industry, town, facts, transfer_to, transfer_when, spanish, updated, owner_set, tz) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, '{}', '', 'never', 1, ?7, '{}', ?8)")
      .bind(bought.number, cid, business, +c.regulated ? 1 : 0, industryOf(business, b && b.type), town, at, tz),
    env.DB.prepare("UPDATE provision SET status = 'live', number = ?1, number_sid = ?2, error = '', updated = ?3 WHERE client_id = ?4").bind(bought.number, bought.sid, at, cid)
  ]);
  // Every line answers Spanish-speaking callers in Spanish (the site sells it on every plan); the owner can turn it off.
  // Kept for lines made before that default: an owner who wrote from the Spanish page always gets it.
  try { if (b && b.email) await env.DB.prepare("UPDATE voice_lines SET spanish = 1 WHERE number = ?1 AND EXISTS (SELECT 1 FROM leads WHERE lang = 'es' AND lower(email) = lower(?2))").bind(bought.number, String(b.email)).run(); } catch (e) { /* older leads table without lang: the owner can turn it on */ }
  const text = pretty(bought.number);
  try {
    const a = await import('./app.js');
    await a.opsPing(env, 'Max is live for ' + (business || 'a new client'), 'Number ' + text + ' bought and connected on its own. The owner sees it on the welcome page and in the app. Nothing for you to do.', 'default', 'telephone_receiver');
    await a.pushClient(env, cid, { aps: { alert: { title: 'Max’s number is ready', body: 'Forward the calls you miss to ' + text + ' and Max answers them. The steps for your phone are in the app.' }, sound: 'default' }, screen: 'home' });
  } catch (e) { /* the line works without the notes */ }
  return { status: 'live', number: bought.number, numberText: text };
}

// The six quick tries failed: the owner hears once (app push and email) that it is in hand, so the welcome page's
// promise isn't left hanging.
async function slowNote(env, cid, b) {
  const words = 'Max’s number is taking longer than usual. Chris has been told. Nothing for you to do.';
  try { await (await import('./app.js')).pushClient(env, cid, { aps: { alert: { title: 'Max’s number is taking longer than usual', body: 'Chris has been told. Nothing for you to do. It shows up in your app when it is ready.' }, sound: 'default' }, screen: 'home' }); } catch (e) { /* the email still goes */ }
  if (!b || !b.email) return 'no email';
  const { sendNeon } = await import('./clientmail.js'), { neonEmail } = await import('./neonmail.js');
  return sendNeon(env, b.email, Object.assign({ subject: 'Max’s number is taking longer than usual' }, neonEmail({
    tone: 'info', sign: 'IN HAND', title: words, who: b.business || '', preheader: words,
    lines: [{ v: 'It shows up in your app as soon as it is ready, with the steps to forward the calls you miss to Max. Your app and your request link work in the meantime.' }],
    note: 'Questions? Text or call Chris: (706) 460-2226.'
  })));
}

// The owner ended their plan: Max stops answering now; the number is kept 60 days in case they come back.
export async function lineEnded(env, cid) {
  await ensureProvision(env);
  const at = new Date().toISOString();
  const was = await env.DB.prepare('SELECT status, ended FROM provision WHERE client_id = ?1').bind(cid).first().catch(() => null);
  await env.DB.batch([
    env.DB.prepare('UPDATE voice_lines SET on_air = 0, updated = ?1 WHERE client_id = ?2').bind(at, cid),
    env.DB.prepare("UPDATE provision SET ended = ?1, warned = '', updated = ?1 WHERE client_id = ?2 AND status = 'live'").bind(at, cid)
  ]);
  // told once per ending: the cancellation webhook and the daily Stripe check can both get here
  if (was && was.status === 'live' && !was.ended) await forwardingOff(env, cid, 'ended', Date.parse(at) + RELEASE_DAYS * 864e5).catch(() => null);
}

// Nov 24, 2026: after a cancel the owner was never told to turn call forwarding off, and the number was released 60 days
// later without a word, so their own customers reached a dead line. They hear at the cancel (stage 'cancel', with the
// day the plan ends), when the plan ends ('ended') and a week before the number goes ('week'): app push and email. The
// off steps are read from the forwarding help page (onboard.js), so they are the same codes we gave them to turn it on.
const dayOf = ms => new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
export async function forwardingOff(env, cid, stage, goneMs, endMs) {
  const line = await env.DB.prepare('SELECT number FROM voice_lines WHERE client_id = ?1 ORDER BY number LIMIT 1').bind(cid).first().catch(() => null);
  if (!line) return 'no number';
  const b = await env.DB.prepare('SELECT business, email, plan FROM billing WHERE client_id = ?1').bind(cid).first().catch(() => null);
  const num = pretty(line.number), gone = dayOf(goneMs);
  const plain = x => String(x).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  const steps = [];
  try {
    const html = await (await import('./onboard.js')).helpPage(env, { client_id: cid }, 'forwarding', '/');
    for (const m of String(html || '').matchAll(/<h2>([^<]+)<\/h2><ol>([\s\S]*?)<\/ol>/g)) {
      const off = [...m[2].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(x => plain(x[1])).find(x => /turn (it|them) off/i.test(x));
      if (off) steps.push({ k: plain(m[1]), v: off });
    }
  } catch (e) { /* the plain line below still goes */ }
  steps.push({ k: steps.length ? 'Any other phone' : 'Your phone', v: 'Call your carrier and ask them to turn off call forwarding.' });
  // Nov 24, 2026: Max's number stays Always Open's. It is never handed to the owner, so the email no longer offers it.
  const title = stage === 'cancel' ? 'Your plan ends ' + dayOf(endMs) + '.' : (stage === 'week' ? 'Max’s number goes away in a week.' : 'Your plan has ended, so Max no longer answers.');
  const first = 'Turn off call forwarding so your callers reach you.' + (stage === 'cancel' ? ' Do it when the plan ends. Max answers until then.' : '');
  const lines = steps.concat([{ k: 'Max’s number', v: num + ' goes away on ' + gone + '.' }]);
  try {
    await (await import('./app.js')).pushClient(env, cid, { aps: { alert: { title: 'Turn off call forwarding', body: 'So your callers reach you. Max’s number ' + num + ' goes away on ' + gone + '. The steps are in your email.' }, sound: 'default' }, screen: 'home' }, { evenIfEnded: true });   // the plan has usually ended by now: this is the one push that still goes
  } catch (e) { /* the email still goes */ }
  if (!b || !b.email) return 'no email';
  const { sendNeon } = await import('./clientmail.js'), { neonEmail } = await import('./neonmail.js');
  const r = await sendNeon(env, b.email, Object.assign({ subject: 'Turn off call forwarding' + (b.business ? ': ' + b.business : '') }, neonEmail({
    tone: 'bad', sign: 'FORWARDING', title, who: b.business || '', preheader: first,
    doThis: [first], lines, note: 'Questions? Text or call Chris: (706) 460-2226.'
  }))).catch(e => 'failed: ' + String((e && e.message) || e).slice(0, 120));
  if (r !== 'sent') { try { await (await import('./ops.js')).opsAlert(env, 'mail-send', cid, 'The turn-off-forwarding email (' + stage + ') to ' + ((b && b.business) || cid) + ' did not go out (' + r + '). Tell them to turn off call forwarding before ' + gone + '.'); } catch (e) {} }
  return r;
}

// Every 10 minutes: retry lines that failed, and release numbers 60 days after a plan ended.
export async function provisionCron(env, at) {
  await ensureProvision(env);
  const now = at || Date.now(), out = { tried: 0, live: 0, released: 0 };
  const queued = ((await env.DB.prepare("SELECT p.client_id FROM provision p JOIN app_clients c ON c.client_id = p.client_id WHERE p.status IN ('queued', 'failed', 'working') AND ((p.tries < ?1 AND p.updated < ?2) OR (p.tries >= ?1 AND p.updated < ?3)) AND c.active = 1 LIMIT 5")
    .bind(MAX_TRIES, new Date(now - 9 * 60e3).toISOString(), new Date(now - 59 * 60e3).toISOString()).all()).results) || [];
  for (const q of queued) { out.tried++; const r = await provisionLine(env, q.client_id).catch(() => null); if (r && r.status === 'live') out.live++; }
  const ended = ((await env.DB.prepare("SELECT p.*, c.business, c.active FROM provision p LEFT JOIN app_clients c ON c.client_id = p.client_id WHERE p.status = 'live' AND p.ended != '' LIMIT 20").all()).results) || [];
  for (const e of ended) {
    if (+e.active) { await env.DB.prepare("UPDATE provision SET ended = '', warned = '' WHERE client_id = ?1").bind(e.client_id).run(); continue; }   // they came back
    const days = (now - Date.parse(e.ended)) / 864e5;
    if (days >= RELEASE_DAYS - 7 && !e.warned) {
      await env.DB.prepare('UPDATE provision SET warned = ?1 WHERE client_id = ?2').bind(new Date(now).toISOString(), e.client_id).run();
      try { await (await import('./app.js')).opsPing(env, 'Always Open: a Max number is released in a week', (e.business || e.client_id) + ' ended their plan ' + Math.floor(days) + ' days ago. Their number ' + pretty(e.number) + ' is released in 7 days, as the terms say. If they are coming back, mark them active before then.', 'default', 'telephone_receiver'); } catch (x) {}
      await forwardingOff(env, e.client_id, 'week', Date.parse(e.ended) + RELEASE_DAYS * 864e5).catch(() => null);
    }
    if (days >= RELEASE_DAYS && e.number_sid && env.TWILIO_ACCOUNT_SID) {
      const r = await tw(env, 'DELETE', '/IncomingPhoneNumbers/' + e.number_sid + '.json');
      if (r.ok || r.status === 404) {
        await env.DB.batch([
          env.DB.prepare("UPDATE provision SET status = 'released', updated = ?1 WHERE client_id = ?2").bind(new Date(now).toISOString(), e.client_id),
          env.DB.prepare('DELETE FROM voice_lines WHERE client_id = ?1 AND number = ?2 AND on_air = 0').bind(e.client_id, e.number)
        ]);
        out.released++;
      }
    }
  }
  return out;
}

// For the HQ board: only what needs a person.
export async function provisionBoard(env) {
  await ensureProvision(env);
  const rows = ((await env.DB.prepare("SELECT p.client_id, p.error, p.tries, COALESCE(c.business, p.client_id) AS biz FROM provision p LEFT JOIN app_clients c ON c.client_id = p.client_id WHERE p.status = 'failed' AND p.tries >= 2 LIMIT 20").all()).results) || [];
  return rows.map(r => ({ key: 'line:' + r.client_id + ':' + r.tries, group: 'Max’s line could not be set up on its own', title: r.biz, detail: (r.error || 'Unknown error') + (r.tries >= MAX_TRIES ? '. Still trying once an hour' : '. Still trying every 10 minutes') }));
}
// For the app and the welcome page.
export async function lineStatus(env, cid) {
  try { const r = await row(env, cid); return r ? { status: r.status, numberText: pretty(r.number) } : null; } catch (e) { return null; }
}
