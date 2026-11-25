// Your business name on Max's calls (Nov 25, 2026). When Max calls a customer (a call-back, a three-day check-in), the
// call comes from Max's number, which the customer has never seen. With nothing vouching for it, phones show a bare
// number or "Spam Likely", and the call goes unanswered. Twilio's Trust Hub fixes three things, all free:
//   SHAKEN/STIR      the carrier signs the call as really from this business (A attestation): the strongest signal
//                    against spam labels;
//   Voice Integrity  the number is registered with the analytics companies AT&T and T-Mobile use to label spam;
//   CNAM             the business's name (15 characters) shows on phones that look names up: landlines, and the mobiles
//                    whose carriers do.
// Each one needs the business's own approved business profile in Trust Hub, which the texting registration (a2p.js)
// already makes and gets approved. So once that profile is approved, Max's number is added to it and the three are
// filed and watched here, one step per pass, nothing for the owner to do. Sole proprietors' starter profiles don't
// qualify: their calls go out without a name, and the texting page says so.
// Always Open's own line, (706) 460-2226, is filed the same way under our primary profile, as "ALWAYS OPEN".
// https://www.twilio.com/docs/voice/brand-your-calls-using-cnam and the Trust Hub guides for SHAKEN/STIR and Voice Integrity.
const TH = 'https://trusthub.twilio.com/v1/';
const TW = 'https://api.twilio.com/2010-04-01/Accounts/';
export const POLICY = { shaken: 'RN7a97559effdf62d00f4298208492a5ea', vi: 'RN5b3660f9598883b1df4e77f77acefba0', cnam: 'RNf3db3cd1fe25fcfd3c3ded065c8fea53' };
const KINDS = ['shaken', 'vi', 'cnam'];
const OWN_ID = 'always-open', OWN_NUMBER = '+17064602226';
const PER_PASS = 4;                 // businesses moved forward each 10-minute pass
const WAIT_MS = 3600e3;             // a filing under review is looked at hourly
const MAX_TRIES = 5;                // the same step failing this many times goes to Christopher
const iso = t => new Date(t).toISOString();
const one = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

const ready = new WeakSet();
export async function ensureCallerId(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS caller_id (client_id TEXT PRIMARY KEY, number TEXT DEFAULT '', display TEXT DEFAULT '', status TEXT DEFAULT 'waiting', step TEXT DEFAULT 'start', sids TEXT DEFAULT '{}', error TEXT DEFAULT '', tries INTEGER DEFAULT 0, updated TEXT)").run();
  ready.add(env.DB);
}

// The name callers see: at most 15 letters, numbers, periods, commas and spaces, starting with a letter (Twilio's CNAM
// rules). Trade words are shortened before anything is cut: "Sinclair Plumbing" is "SINCLAIR PLUMB", not "SINCLAIR PLUMBI".
const SHORT = [[/\bplumbing\b/gi, 'Plumb'], [/\bheating\b/gi, 'Htg'], [/\bcooling\b/gi, 'Clg'], [/\bair conditioning\b/gi, 'AC'], [/\belectrical\b|\belectric\b/gi, 'Elec'],
  [/\bservices?\b/gi, 'Svc'], [/\bconstruction\b/gi, 'Constr'], [/\bcontracting\b|\bcontractors?\b/gi, 'Contr'], [/\broofing\b/gi, 'Roof'], [/\blandscaping\b/gi, 'Lndscp'],
  [/\bautomotive\b/gi, 'Auto'], [/\brepairs?\b/gi, 'Rpr'], [/\bmechanical\b/gi, 'Mech'], [/\binsurance\b/gi, 'Ins'], [/\bagency\b/gi, 'Agcy'], [/\bmanagement\b/gi, 'Mgmt'],
  [/\bsolutions\b/gi, 'Sol'], [/\bcleaning\b/gi, 'Clean'], [/\bpainting\b/gi, 'Paint'], [/\bmountain\b/gi, 'Mtn'], [/\bbrothers\b/gi, 'Bros']];
export function cnamName(business) {
  let s = String(business || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/['’`]/g, '')
    .replace(/\b(l\.?l\.?c|inc|incorporated|corp|corporation|co|company|ltd|pllc|plc)\b\.?/gi, ' ').replace(/[^A-Za-z0-9., ]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[^A-Za-z]+/, '').replace(/^the\s+/i, '');
  if (s.length > 15) s = s.replace(/\s+and\s+/gi, ' ');
  for (const [re, to] of SHORT) { if (s.length <= 15) break; s = s.replace(re, to); }
  s = s.replace(/[.,\s]+$/, '');
  if (s.length > 15) { const cut = s.slice(0, 16).replace(/\s+\S*$/, ''); s = cut.length >= 6 ? cut : s.slice(0, 15); }
  return s.replace(/[.,\s]+$/, '').toUpperCase();
}

async function tw(env, method, url, params) {
  const body = params ? new URLSearchParams(Object.entries(params).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])).toString() : undefined;
  const r = await fetch(url, { method, headers: { Authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN), 'content-type': 'application/x-www-form-urlencoded' }, body: method === 'GET' ? undefined : body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(String(j.message || ('Twilio answered ' + r.status)).slice(0, 240)); e.status = r.status; e.code = j.code; throw e; }
  return j;
}
const assign = (env, tp, obj) => tw(env, 'POST', TH + 'TrustProducts/' + tp + '/EntityAssignments', { ObjectSid: obj });
function evalWhy(ev) {
  const bad = [];
  for (const r of (ev.results || [])) for (const f of (r.fields || [])) if (f.passed === false) bad.push((f.friendly_name || f.object_field || 'a field') + (f.failure_reason ? ': ' + f.failure_reason : ''));
  return bad.length ? 'Twilio flagged: ' + bad.slice(0, 3).join('; ') : 'Twilio did not accept the details.';
}

// Where the business stands, for one business: { profile, numberSid } when ready to file, { wait } or { not } when not.
async function profileFor(env, cid, row) {
  if (cid === OWN_ID) {
    if (!env.TWILIO_PRIMARY_PROFILE_SID) return { not: 'TWILIO_PRIMARY_PROFILE_SID is not set' };
    return { profile: env.TWILIO_PRIMARY_PROFILE_SID };
  }
  const a = await env.DB.prepare('SELECT status, step, form, sids FROM a2p_reg WHERE client_id = ?1').bind(cid).first().catch(() => null);
  if (!a) return { wait: 'the texting registration has not been sent' };
  let f = {}, s = {}; try { f = JSON.parse(a.form || '{}'); s = JSON.parse(a.sids || '{}'); } catch (e) { /* as empty */ }
  if (f.noEin) return { not: 'sole proprietor' };
  if (!s.profile) return { wait: 'the business profile is not made yet' };
  // past the profile's own review (a2p.js steps after wait_profile), or approved outright
  if (a.status === 'approved' || ['trust', 'brand', 'wait_brand', 'campaign', 'wait_campaign', 'number'].includes(a.step)) return { profile: s.profile };
  return { wait: 'the business profile is still in review' };
}
async function numberSid(env, number) {
  const j = await tw(env, 'GET', TW + env.TWILIO_ACCOUNT_SID + '/IncomingPhoneNumbers.json?PhoneNumber=' + encodeURIComponent(number));
  const n = (j.incoming_phone_numbers || [])[0];
  return n && n.sid ? n.sid : '';
}

// One step for one business. Returns the new { status, step, error } (sids are changed in place).
async function step(env, r, sids, now) {
  if (r.step === 'start') {
    const p = await profileFor(env, r.client_id, r);
    if (p.not) return { status: 'not_eligible', step: 'start', error: p.not };
    if (p.wait) return { status: 'waiting', step: 'start', error: p.wait };
    sids.profile = p.profile;
    if (!sids.number) sids.number = r.client_id === OWN_ID ? await numberSid(env, r.number) : (((await env.DB.prepare('SELECT number_sid FROM provision WHERE client_id = ?1').bind(r.client_id).first().catch(() => null)) || {}).number_sid || '');
    if (!sids.number) return { status: 'waiting', step: 'start', error: 'no phone number yet' };
    return { status: 'filing', step: 'assign' };
  }
  if (r.step === 'assign') {
    // the number must belong to the business profile before any of the three can carry it
    const have = await tw(env, 'GET', TH + 'CustomerProfiles/' + sids.profile + '/ChannelEndpointAssignments?ChannelEndpointSid=' + sids.number + '&PageSize=50');
    if (!(have.results || []).some(x => x.channel_endpoint_sid === sids.number)) await tw(env, 'POST', TH + 'CustomerProfiles/' + sids.profile + '/ChannelEndpointAssignments', { ChannelEndpointType: 'phone-number', ChannelEndpointSid: sids.number });
    return { status: 'filing', step: 'shaken' };
  }
  if (KINDS.includes(r.step)) {
    const k = r.step, name = one(r.display) || 'Business';
    if (!sids[k]) sids[k] = (await tw(env, 'POST', TH + 'TrustProducts', { FriendlyName: (name + ' ' + ({ shaken: 'SHAKEN/STIR', vi: 'Voice Integrity', cnam: 'CNAM' }[k])).slice(0, 64), Email: env.MAIL_TO || 'hello@alwaysopenoffice.com', PolicySid: POLICY[k] })).sid;
    if (!sids[k + 'Linked']) {
      if (k === 'vi') {
        // what the calls from this number really are, said plainly to the carriers' analytics companies
        const own = r.client_id === OWN_ID;
        const eu = sids.viEU || (sids.viEU = (await tw(env, 'POST', TH + 'EndUsers', { Type: 'voice_integrity_information', FriendlyName: name + ' calling', Attributes: {
          use_case: own ? 'Customer Support' : 'Appointment Scheduling', business_employee_count: own ? '2' : '5', average_business_day_call_volume: '5',
          notes: own ? 'Always Open, a phone answering and reviews service for local businesses. Calls from this number are call-backs to business owners who asked about the service or need help with their account.'
            : 'A local service business. Its phone assistant calls its own customers back when they asked for a call-back, and three days after a job to check the work held up; only if the owner turns it on, brief calls to other businesses on a list the owner supplies.' } })).sid);
        await assign(env, sids[k], eu);
      }
      if (k === 'cnam') {
        const eu = sids.cnamEU || (sids.cnamEU = (await tw(env, 'POST', TH + 'EndUsers', { Type: 'cnam_information', FriendlyName: name + ' caller name', Attributes: { cnam_display_name: cnamName(name) } })).sid);
        await assign(env, sids[k], eu);
      }
      await assign(env, sids[k], sids.profile);
      await tw(env, 'POST', TH + 'TrustProducts/' + sids[k] + '/ChannelEndpointAssignments', { ChannelEndpointType: 'phone-number', ChannelEndpointSid: sids.number });
      sids[k + 'Linked'] = 1;
    }
    // a retry after the status went through already: on to the next
    const tp = await tw(env, 'GET', TH + 'TrustProducts/' + sids[k]);
    if (!tp.status || tp.status === 'draft') {
      const ev = await tw(env, 'POST', TH + 'TrustProducts/' + sids[k] + '/Evaluations', { PolicySid: POLICY[k] });
      if (ev.status && ev.status !== 'compliant') return { status: 'needs_fix', step: k, error: evalWhy(ev) };
      await tw(env, 'POST', TH + 'TrustProducts/' + sids[k], { Status: 'pending-review' });
    }
    const next = KINDS[KINDS.indexOf(k) + 1];
    return next ? { status: 'filing', step: next } : { status: 'in_review', step: 'wait' };
  }
  if (r.step === 'wait') {
    const st = {};
    for (const k of KINDS) st[k] = (await tw(env, 'GET', TH + 'TrustProducts/' + sids[k])).status || '';
    sids.seen = st;
    const bad = KINDS.filter(k => st[k] === 'twilio-rejected');
    if (bad.length) return { status: 'needs_fix', step: 'wait', error: bad.map(k => ({ shaken: 'SHAKEN/STIR', vi: 'Voice Integrity', cnam: 'the caller name' }[k])).join(' and ') + ' was turned down. Open Trust Hub in the Twilio console to see why.' };
    if (KINDS.every(k => st[k] === 'twilio-approved')) return { status: 'live', step: 'done' };
    return { status: 'in_review', step: 'wait' };
  }
  return { status: r.status, step: r.step };
}

// Every 10 minutes: new businesses join (a live number on an active plan), then up to PER_PASS move one step each.
// h: { now, tell(cid, title, body), alert(type, who, text) } for tests.
export async function callerIdCron(env, h) {
  h = h || {};
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)) return { skipped: true };
  await ensureCallerId(env);
  const now = h.now || Date.now();
  try {
    // a new row has no time yet, so this same pass takes its first step (the hourly wait is only for rows already looked at)
    await env.DB.prepare("INSERT OR IGNORE INTO caller_id (client_id, number, display, updated) SELECT p.client_id, p.number, c.business, '' FROM provision p JOIN app_clients c ON c.client_id = p.client_id WHERE p.status = 'live' AND p.number != '' AND c.active = 1 AND c.client_id != 'demo-plumbing'").run();
  } catch (e) { /* no provision table yet */ }
  await env.DB.prepare("INSERT OR IGNORE INTO caller_id (client_id, number, display, updated) VALUES (?1, ?2, 'Always Open', '')").bind(OWN_ID, OWN_NUMBER).run();
  const rows = ((await env.DB.prepare("SELECT * FROM caller_id WHERE status NOT IN ('live', 'not_eligible', 'needs_fix') AND (status != 'in_review' OR updated < ?1) AND (status != 'waiting' OR updated < ?2) ORDER BY updated LIMIT ?3")
    .bind(iso(now - WAIT_MS), iso(now - WAIT_MS), PER_PASS).all()).results) || [];
  const out = { moved: 0, live: 0, fix: 0 };
  for (const r of rows) {
    let sids = {}; try { sids = JSON.parse(r.sids || '{}') || {}; } catch (e) { sids = {}; }
    let res, tries = 0;
    try { res = await step(env, r, sids, now); }
    catch (e) {
      tries = (+r.tries || 0) + 1;
      res = tries >= MAX_TRIES ? { status: 'needs_fix', step: r.step, error: 'Twilio kept refusing: ' + one((e && e.message) || e).slice(0, 200) } : { status: r.status, step: r.step, error: one((e && e.message) || e).slice(0, 200) };
    }
    await env.DB.prepare('UPDATE caller_id SET status = ?1, step = ?2, sids = ?3, error = ?4, tries = ?5, updated = ?6 WHERE client_id = ?7')
      .bind(res.status, res.step, JSON.stringify(sids), res.error || '', tries, iso(now), r.client_id).run();
    out.moved++;
    if (res.status === 'live' && r.status !== 'live') {
      out.live++;
      const words = 'The carriers approved it: Max\'s calls now go out signed as ' + (r.client_id === OWN_ID ? 'Always Open' : 'your business') + ', and phones that show names show "' + cnamName(r.display) + '".';
      try {
        if (h.tell) await h.tell(r.client_id, 'Your name is on Max\'s calls', words);
        else if (r.client_id !== OWN_ID) await (await import('./app.js')).pushClient(env, r.client_id, { aps: { alert: { title: 'Your name is on Max\'s calls', body: words }, sound: 'default' }, screen: 'home' });
        else await (await import('./app.js')).opsPing(env, 'Caller ID approved for (706) 460-2226', words, 'default', 'telephone_receiver');
      } catch (e) { /* the status shows in the app either way */ }
    }
    if (res.status === 'needs_fix' && r.status !== 'needs_fix') {
      out.fix++;
      const text = 'Caller ID for ' + (one(r.display) || r.client_id) + ' needs a look: ' + (res.error || 'unknown') + '. Max\'s calls still go out, just without the name. Fix it in Twilio\'s Trust Hub, then set the row in caller_id back to step "' + res.step + '" and status "filing".';
      try { if (h.alert) await h.alert('caller-id', r.client_id, text); else await (await import('./ops.js')).opsAlert(env, 'caller-id', r.client_id, text); } catch (e) { /* the row keeps the error */ }
    }
  }
  return out;
}

// For the owner's texting page and the app: where their name on Max's calls stands, in a line.
export async function callerIdState(env, cid) {
  await ensureCallerId(env);
  const r = await env.DB.prepare('SELECT status, display FROM caller_id WHERE client_id = ?1').bind(cid).first().catch(() => null);
  if (!r) return null;
  const name = cnamName(r.display);
  const label = { live: 'On: Max\'s calls show "' + name + '" and are signed as your business.', in_review: 'Filed: the carriers are checking "' + name + '" (usually 2 to 3 days).',
    filing: 'Being filed now as "' + name + '".', waiting: 'Starts by itself once your texting registration\'s business check is approved.',
    not_eligible: 'Not available for sole proprietors yet: Max\'s calls go out with your number and no name.', needs_fix: 'We\'re fixing a detail with the carriers. Max\'s calls still go out.' }[r.status] || '';
  return { status: r.status, name, label };
}
