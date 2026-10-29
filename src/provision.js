// New clients get Max's line on their own. Right after payment we buy a phone number near them, point it at Max, and
// put the line on the air; the welcome page shows the number and the steps to forward missed calls to it. Nobody at
// Always Open has to do anything. If Twilio can't do it right then, the 10-minute timer keeps trying, and Christopher
// hears about it only if it still fails.
// When a client cancels, Max stops answering at once; the number is released 60 days later (terms say so), with a
// heads-up to Christopher a week before, unless the client is active again by then.
const SITE = 'https://alwaysopenoffice.com';
const TW = 'https://api.twilio.com/2010-04-01/Accounts/';
const MAX_TRIES = 6, RELEASE_DAYS = 60;

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
const BY_NAME = [[/\bplumb/, 'plumbing'], [/\bhvac\b|\bheating\b|\bcooling\b|\bair cond|\bheat\b/, 'hvac'], [/\belectric/, 'electrical'], [/\broof/, 'roofing'], [/\blandscap|\blawn|\bmow/, 'landscaping'], [/\bpest\b|\btermite|\bexterminat/, 'pest control'],
  [/\bpools?\b/, 'pools'], [/\bpaint/, 'painting'], [/\btrees?\b/, 'tree service'], [/\bpressure wash|\bpower wash/, 'pressure washing'], [/\bclean|\bmaids?\b/, 'cleaning'], [/\bfenc/, 'fencing'], [/\bconcrete\b|\bpaving\b/, 'concrete'],
  [/\bgarage doors?\b/, 'garage doors'], [/\bseptic\b/, 'septic'], [/\bgutters?\b/, 'gutters'], [/\bfloor/, 'flooring'], [/\bremodel|\bconstruct|\bbuilders?\b|\bbuilding\b/, 'builders'], [/\bmoving\b|\bmovers\b/, 'moving'], [/\btow(ing)?\b/, 'towing'],
  [/\bauto\b|\bautomotive\b|\btires?\b|\bmechanic|\bcollision\b|\btransmission|\bdetail/, 'auto repair'], [/\bdocks?\b/, 'docks'], [/\bmarine\b|\bmarina\b|\bboats?\b/, 'marine'], [/\bbarber/, 'barber'], [/\bsalon\b|\bhair\b|\bnails?\b|\bbeauty\b/, 'salon'], [/\bfitness\b|\bgym\b|\byoga\b|\bpilates\b/, 'fitness'],
  [/\bgroom/, 'pet grooming'], [/\bdental\b|\bdentist/, 'dental'], [/\binsurance\b/, 'insurance'], [/\blaw\b|\battorneys?\b|\blegal\b/, 'legal'], [/\bclinic\b|\bmedical\b|\bchiropract|\btherap|\bdoctors?\b/, 'medical'], [/\brestaurant\b|\bcafe\b|\bgrill\b|\bbbq\b|\bpizza\b|\bbakery\b|\bdiner\b/, 'restaurant'], [/\bfoam\b|\bparty\b|\bparties\b|\bevents?\b|\brentals?\b/, 'party rentals']];
const BY_TYPE = { 'Contractor or trade': 'contractor', 'Dock, marine or outdoor': 'marine', 'Salon, spa or fitness': 'salon', 'Restaurant or shop': 'restaurant', 'Insurance agency': 'insurance', 'Medical, dental or legal': 'medical' };
export function industryOf(business, type) {
  const n = String(business || '').toLowerCase();
  if (type === 'Insurance agency') return 'insurance';
  for (const [re, k] of BY_NAME) if (re.test(n)) return type === 'Medical, dental or legal' && !/dental|legal|medical/.test(k) ? 'medical' : k;
  return BY_TYPE[type] || '';
}

// Where to look for a number, nearest first.
// What a caller hears if our webhook ever fails: a sentence, not Twilio's error tone. It is TwiML served by Twilio's
// own echo service (twimlets.com), so it works when we are down. With a transfer number, the call rings there first.
export function fallbackTwiml(business, transferTo) {
  const biz = String(business || '').replace(/[<>&"]/g, '').slice(0, 60);
  const to = /^\+1\d{10}$/.test(transferTo || '') ? transferTo : '';
  const sorry = 'Thanks for calling' + (biz ? ' ' + biz : '') + '. We can’t take your call right now. Please call back in a few minutes.';
  return '<Response>' + (to ? '<Dial timeout="20">' + to + '</Dial>' : '') + '<Say voice="Polly.Matthew">' + sorry + '</Say><Hangup/></Response>';
}
export function fallbackUrl(business, transferTo) { return 'https://twimlets.com/echo?Twiml=' + encodeURIComponent(fallbackTwiml(business, transferTo)); }

export function searches(phone, town) {
  const d = ph10(phone), st = stateOf(town), out = [];
  if (d) out.push('AreaCode=' + d.slice(0, 3));
  if (d) out.push('NearNumber=' + encodeURIComponent('+1' + d) + '&Distance=60');
  if (st) out.push('InRegion=' + st);
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
  const claim = await env.DB.prepare("UPDATE provision SET status = 'working', tries = tries + 1, updated = ?1 WHERE client_id = ?2 AND (status IN ('queued', 'failed') OR (status = 'working' AND updated < ?3)) AND tries < ?4")
    .bind(now, cid, new Date(Date.now() - 5 * 60e3).toISOString(), MAX_TRIES).run();
  if (!(claim.meta && claim.meta.changes)) { const r = await row(env, cid); return { status: (r && r.status) || 'queued', number: (r && r.number) || '', numberText: pretty(r && r.number) }; }
  const fail = async why => {
    await env.DB.prepare("UPDATE provision SET status = 'failed', error = ?1, updated = ?2 WHERE client_id = ?3").bind(String(why).slice(0, 300), new Date().toISOString(), cid).run().catch(() => null);
    const r = await env.DB.prepare('SELECT tries FROM provision WHERE client_id = ?1').bind(cid).first().catch(() => null);
    const tries = r ? +r.tries : 0;
    if (tries === 2 || tries === MAX_TRIES) { try { await (await import('./app.js')).opsPing(env, 'Always Open: could not set up Max’s line', 'For ' + ((b && b.business) || cid) + ': ' + why + (tries >= MAX_TRIES ? ' It stopped trying. Fix it in Twilio, then set the line up by hand.' : ' It keeps trying every 10 minutes.'), 'high', 'warning'); } catch (e) {} }
    return { status: 'failed', number: '', numberText: '', error: why };
  };
  const b = await env.DB.prepare('SELECT business, phone, town, type, email FROM billing WHERE client_id = ?1').bind(cid).first().catch(() => null);
  const c = await env.DB.prepare('SELECT business, phone, regulated FROM app_clients WHERE client_id = ?1').bind(cid).first();
  if (!c) return fail('no such client');
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.VOICE_KEY)) return fail('The Twilio keys are not set on the worker.');
  const business = (b && b.business) || c.business || '', town = (b && b.town) || '';
  let bought = null, lastErr = '';
  for (const q of searches((b && b.phone) || c.phone, town)) {
    const s = await tw(env, 'GET', '/AvailablePhoneNumbers/US/Local.json?VoiceEnabled=true&SmsEnabled=true&ExcludeAllAddressRequired=true&PageSize=5' + (q ? '&' + q : ''));
    const list = (s.j.available_phone_numbers || []).map(x => x.phone_number).filter(Boolean);
    for (const num of list.slice(0, 3)) {
      const r = await tw(env, 'POST', '/IncomingPhoneNumbers.json', {
        PhoneNumber: num, FriendlyName: ('Always Open: ' + business).slice(0, 64),
        VoiceUrl: SITE + '/voice/in/' + env.VOICE_KEY, VoiceMethod: 'POST', StatusCallback: SITE + '/voice/status/' + env.VOICE_KEY, StatusCallbackMethod: 'POST',
        VoiceFallbackUrl: fallbackUrl(business, (c && c.phone) || ''), VoiceFallbackMethod: 'GET',
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
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO voice_lines (number, client_id, business, on_air, regulated, industry, town, facts, transfer_to, transfer_when, spanish, updated, owner_set) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, '{}', '', 'never', 0, ?7, '{}')")
      .bind(bought.number, cid, business, +c.regulated ? 1 : 0, industryOf(business, b && b.type), town, at),
    env.DB.prepare("UPDATE provision SET status = 'live', number = ?1, number_sid = ?2, error = '', updated = ?3 WHERE client_id = ?4").bind(bought.number, bought.sid, at, cid)
  ]);
  // An owner who wrote to us from the Spanish page gets a line that answers Spanish-speaking callers in Spanish from day one.
  try { if (b && b.email) await env.DB.prepare("UPDATE voice_lines SET spanish = 1 WHERE number = ?1 AND EXISTS (SELECT 1 FROM leads WHERE lang = 'es' AND lower(email) = lower(?2))").bind(bought.number, String(b.email)).run(); } catch (e) { /* older leads table without lang: the owner can turn it on */ }
  const text = pretty(bought.number);
  try {
    const a = await import('./app.js');
    await a.opsPing(env, 'Max is live for ' + (business || 'a new client'), 'Number ' + text + ' bought and connected on its own. The owner sees it on the welcome page and in the app. Nothing for you to do.', 'default', 'telephone_receiver');
    await a.pushClient(env, cid, { aps: { alert: { title: 'Max’s number is ready', body: 'Forward the calls you miss to ' + text + ' and Max answers them. The steps for your phone are in the app.' }, sound: 'default' }, screen: 'home' });
  } catch (e) { /* the line works without the notes */ }
  return { status: 'live', number: bought.number, numberText: text };
}

// The owner ended their plan: Max stops answering now; the number is kept 60 days in case they come back.
export async function lineEnded(env, cid) {
  await ensureProvision(env);
  const at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE voice_lines SET on_air = 0, updated = ?1 WHERE client_id = ?2').bind(at, cid),
    env.DB.prepare("UPDATE provision SET ended = ?1, warned = '', updated = ?1 WHERE client_id = ?2 AND status = 'live'").bind(at, cid)
  ]);
}

// Every 10 minutes: retry lines that failed, and release numbers 60 days after a plan ended.
export async function provisionCron(env, at) {
  await ensureProvision(env);
  const now = at || Date.now(), out = { tried: 0, live: 0, released: 0 };
  const queued = ((await env.DB.prepare("SELECT p.client_id FROM provision p JOIN app_clients c ON c.client_id = p.client_id WHERE p.status IN ('queued', 'failed', 'working') AND p.tries < ?1 AND p.updated < ?2 AND c.active = 1 LIMIT 5")
    .bind(MAX_TRIES, new Date(now - 9 * 60e3).toISOString()).all()).results) || [];
  for (const q of queued) { out.tried++; const r = await provisionLine(env, q.client_id).catch(() => null); if (r && r.status === 'live') out.live++; }
  const ended = ((await env.DB.prepare("SELECT p.*, c.business, c.active FROM provision p LEFT JOIN app_clients c ON c.client_id = p.client_id WHERE p.status = 'live' AND p.ended != '' LIMIT 20").all()).results) || [];
  for (const e of ended) {
    if (+e.active) { await env.DB.prepare("UPDATE provision SET ended = '', warned = '' WHERE client_id = ?1").bind(e.client_id).run(); continue; }   // they came back
    const days = (now - Date.parse(e.ended)) / 864e5;
    if (days >= RELEASE_DAYS - 7 && !e.warned) {
      await env.DB.prepare('UPDATE provision SET warned = ?1 WHERE client_id = ?2').bind(new Date(now).toISOString(), e.client_id).run();
      try { await (await import('./app.js')).opsPing(env, 'Always Open: a Max number is released in a week', (e.business || e.client_id) + ' ended their plan ' + Math.floor(days) + ' days ago. Their number ' + pretty(e.number) + ' is released in 7 days, as the terms say. If they are coming back, mark them active before then.', 'default', 'telephone_receiver'); } catch (x) {}
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
  return rows.map(r => ({ key: 'line:' + r.client_id + ':' + r.tries, group: 'Max’s line could not be set up on its own', title: r.biz, detail: (r.error || 'Unknown error') + (r.tries >= MAX_TRIES ? '. It stopped trying' : '. Still trying every 10 minutes') }));
}
// For the app and the welcome page.
export async function lineStatus(env, cid) {
  try { const r = await row(env, cid); return r ? { status: r.status, numberText: pretty(r.number) } : null; } catch (e) { return null; }
}
