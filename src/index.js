// Always Open on Cloudflare: serves the website (public/), and receives the website form.
// Each request is checked for spam, saved to D1, pushed to Christopher's phone (ntfy) and emailed to him.
// The Always Open check (scheduled task) reads new requests from that email, or from /leads with a key.
import { rivalsWeekly, ensureRivals, purgeGoogle, isoWeek as rivalWeek } from './rivals.js';
import { ensureReviews } from './reviews.js';
import { seedDemo } from './demo.js';
import { handleOpsBoard, boardWeekly } from './opsboard.js';
import { ensureBiz } from './biz.js';
import { opsAlert, watched, healthCron, healthDetail } from './ops.js';
import { EmailMessage } from 'cloudflare:email';
import { handleApp, aasa, photoGet, appCron, handleQuote, handleLocations, opsPing } from './app.js';
import { handleVoice, voiceCron, CallRoom } from './voice.js';
import { handleAudit } from './audit.js';
import { handleBilling, stripe as stripeCall } from './billing.js';
import { referralCron } from './referral.js';
import { handleGoogle } from './gcal.js';
import { handleBooking, handleInvoicePage, handleMeta, invoiceCron, ensureInvoices } from './extras.js';
import { handleOptOut } from './past.js';
import { sendText, setBrand } from './sms.js';
import { callbackCron } from './callbacks.js';
import { checkinCron } from './checkin.js';
import { fullMaxCron } from './fullmax.js';
import { a2pCron } from './a2p.js';
import { fundingCron } from './funding.js';
import { handleMapApi, mapCron } from './map.js';
import { handleEstimate, handleInvoicePay, handleStripe, metaWebhook, bizCron } from './biz.js';
import { launchCron, launchState, launchLines, rewritePage } from './launch.js';
import { gbpCron } from './gbp.js';
import { provisionCron } from './provision.js';
import { autoCron } from './autotext.js';

// The AI phone line keeps each live call in a CallRoom (a Durable Object), so the class is exported from here.
export { CallRoom };

const MAX_BODY = 12000;          // bytes
const MIN_FILL_MS = 3000;        // faster than this is a bot
const MAX_AGE_MS = 3 * 86400000; // a form left open for days is stale
const PER_HOUR = 5;              // requests per sender per hour
const LIMITS = { name: 80, email: 120, phone: 40, business: 120, town: 80, type: 60, plan: 40, link: 300, notes: 1500, sms_ok: 3, ref: 40 };
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
let migrated = false;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === '/health') {
      const k = req.headers.get('x-key') || '';
      if (k && env.LEADS_KEY && await sameKey(k, env.LEADS_KEY)) return json(await healthDetail(env), 200);
      return new Response('ok', { headers: { 'cache-control': 'no-store' } });
    }
    if (path === '/ops' || path === '/ops/done' || path === '/ops/map' || path === '/ops/compliance-pack') return handleOpsBoard(req, env, url);
    if (path === '/api/map') return handleMapApi(req, env, url, ctx);
    if (path === '/ops/twilio-setup') {
      // Points every Always Open number's "A message comes in" at our webhook and adds it to the Messaging Service, so replies and STOP reach us.
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.VOICE_KEY)) return json({ ok: false, error: 'Twilio keys missing' }, 400);
      const auth = 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN), base = 'https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID;
      const nums = ((await env.DB.prepare('SELECT number, business FROM voice_lines').all()).results) || [];
      const out = [];
      for (const n of nums) {
        const row = { number: n.number, business: n.business || '' };
        try {
          const l = await fetch(base + '/IncomingPhoneNumbers.json?PhoneNumber=' + encodeURIComponent(n.number), { headers: { authorization: auth } }).then(r => r.json());
          const pn = l.incoming_phone_numbers && l.incoming_phone_numbers[0];
          if (!pn) { row.result = 'not in this Twilio account'; out.push(row); continue; }
          const u = await fetch(base + '/IncomingPhoneNumbers/' + pn.sid + '.json', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ SmsUrl: 'https://alwaysopenoffice.com/voice/sms/' + env.VOICE_KEY, SmsMethod: 'POST' }).toString() });
          row.webhook = u.ok ? 'set' : 'failed ' + u.status;
          const own = await env.DB.prepare('SELECT client_id FROM voice_lines WHERE number = ?1').bind(n.number).first();
          const brand = own && own.client_id === 'always-open' ? { messaging_sid: env.TWILIO_MESSAGING_SID } : await env.DB.prepare("SELECT messaging_sid FROM sms_brands WHERE client_id = ?1 AND status = 'approved'").bind(own && own.client_id).first().catch(() => null);
          if (!brand || !brand.messaging_sid) row.senderPool = 'waiting for this business to have its own texting registration';
          else {
            const m = await fetch('https://messaging.twilio.com/v1/Services/' + brand.messaging_sid + '/PhoneNumbers', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ PhoneNumberSid: pn.sid }).toString() });
            const mj = await m.json().catch(() => ({}));
            row.senderPool = m.ok ? 'added' : (mj.code === 21712 || /already/i.test(mj.message || '') ? 'already there' : 'failed: ' + String(mj.message || m.status).slice(0, 80));
          }
        } catch (e) { row.result = 'error'; }
        out.push(row);
      }
      return json({ ok: true, numbers: out }, 200);
    }
    if (path === '/ops/launch-check') {
      // HQ: check Google and Meta now (normally hourly) and say where each stands.
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      const now = await launchCron(env, { force: true });
      return json({ ok: true, now, board: await launchLines(env) }, 200);
    }
    if (path === '/ops/funding-test') {
      // HQ: read every balance now and send one test push, so the alert path is proven.
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      const f = await import('./funding.js');
      await env.DB.prepare("DELETE FROM funding_log WHERE service = 'tick'").run().catch(() => {});
      const r = await f.fundingCron(env);
      const st = await f.fundingState(env);
      await opsPing(env, 'Always Open: funding watch is on', 'Test push. Twilio: ' + st.twilio + '. You will get a push like this when a balance runs low, credits run out, Google refuses lookups, or a renewal is coming.', 'high', 'moneybag');
      return json({ ok: true, now: r, board: st }, 200);
    }
    if (path === '/ops/twilio-profiles') {
      // HQ, read-only: the Trust Hub profiles on the account, so we can find the primary (ISV) profile.
      const k = req.headers.get('x-key') || '';
      if (!env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)) return json({ ok: false, error: 'Twilio keys missing' }, 400);
      const auth = 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN);
      const get = async u => { try { return await (await fetch(u, { headers: { authorization: auth } })).json(); } catch (e) { return {}; } };
      const cps = (await get('https://trusthub.twilio.com/v1/CustomerProfiles?PageSize=50')).results || [];
      const out = [];
      for (const p of cps) {
        const ents = (await get('https://trusthub.twilio.com/v1/CustomerProfiles/' + p.sid + '/EntityAssignments?PageSize=50')).results || [];
        let identity = '', type = '', name = '';
        for (const e of ents) { if (!/^IT/.test(e.object_sid || '')) continue; const eu = await get('https://trusthub.twilio.com/v1/EndUsers/' + e.object_sid); if (eu.type === 'customer_profile_business_information') { identity = (eu.attributes || {}).business_identity || ''; type = (eu.attributes || {}).business_type || ''; name = (eu.attributes || {}).business_name || ''; } }
        out.push({ sid: p.sid, name: p.friendly_name, status: p.status, policy: p.policy_sid, business_name: name, business_identity: identity, business_type: type });
      }
      const brands = ((await get('https://messaging.twilio.com/v1/a2p/BrandRegistrations?PageSize=50')).data || []).map(b => ({ sid: b.sid, status: b.status, profile: b.customer_profile_bundle_sid, type: b.brand_type }));
      return json({ ok: true, profiles: out, brands }, 200);
    }
    if (path === '/ops/sms-brand') {
      // HQ: record a client's own texting registration (their Messaging Service SID, once their brand and campaign are approved).
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      let b = {}; try { b = await req.json(); } catch (e) {}
      const cid = String(b.client || ''), mg = String(b.mg || ''), st = b.status === 'approved' ? 'approved' : (b.status === 'off' ? 'off' : 'pending');
      if (!cid || (st === 'approved' && !/^MG[0-9a-f]{32}$/i.test(mg))) return json({ ok: false, error: 'client and a Messaging Service SID (MG...) are needed' }, 400);
      await setBrand(env, cid, mg, st);
      return json({ ok: true, client: cid, status: st }, 200);
    }
    if (path === '/ops/text-test') {
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      let b = {}; try { b = await req.json(); } catch (e) {}
      const r = await sendText(env, { clientId: String(b.client || 'always-open'), to: String(b.to || ''), body: String(b.body || 'Always Open texting is on. This is the only test.'), kind: 'test' });
      return json(r, r.ok ? 200 : 400);
    }
    if (path === '/ops/seed-demo') {
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      try { return json(await seedDemo(env, { ensureBiz, ensureInvoices, ensureRivals, ensureReviews, isoWeek: rivalWeek })); } catch (e) { return json({ ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500); }
    }
    if (path === '/ops/deploy-failed') {
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      const r = await opsAlert(env, 'deploy', '', 'A GitHub deploy failed. Open the Actions tab of christophergates88/alwaysopen to see why.');
      return json({ ok: true, alert: r }, 200);
    }
    if (path === '/lead') {
      if (req.method === 'POST') return lead(req, env, ctx, url);
      return Response.redirect(url.origin + '/#contact', 303);
    }
    if (path === '/leads') return leadsList(req, env, url);
    if (path === '/storms') return stormsList(req, env, url);
    if (path === '/start' || path === '/welcome' || path.startsWith('/billing/')) {
      try { const r = await handleBilling(req, env, url, { json, sameKey, notify: (t, b, pr) => billingNotify(env, ctx, t, b, pr), later: p => ctx.waitUntil(p) }); if (r && r.status >= 500) ctx.waitUntil(opsAlert(env, 'stripe-checkout', '', 'Checkout/billing answered ' + r.status + ' on ' + path)); return r; }
      catch (e) { ctx.waitUntil(opsAlert(env, 'stripe-checkout', '', ((e && e.message) || 'threw') + ' on ' + path)); return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500); }
    }
    if (path === '/audit/tool' || path === '/audit/run' || path === '/audit/score') return handleAudit(req, env, url, { json, sameKey, ipHash: (r, e) => hash((r.headers.get('cf-connecting-ip') || '') + '|' + (e.IP_SALT || 'salt')) });
    if (path === '/radar') return radarRun(req, env, url);
    if (path === '/.well-known/apple-app-site-association') return aasa();
    if (path === '/locations') { const k = req.headers.get('x-key') || ''; return handleLocations(req, env, !!env.LEADS_KEY && await sameKey(k, env.LEADS_KEY)); }
    if (path.startsWith('/google/')) return handleGoogle(req, env, url);
    if (path === '/app' || path.startsWith('/app/')) return handleApp(req, env, ctx, url);
    if (path.startsWith('/p/')) return photoGet(env, url);
    if (path.startsWith('/q/')) return handleQuote(req, env, ctx, url);
    if (path.startsWith('/b/')) return handleBooking(req, env, ctx, url);
    if (/^\/i\/[A-Za-z0-9]{24}\/pay$/.test(path)) return handleInvoicePay(req, env, url);
    if (path.startsWith('/i/')) return handleInvoicePage(req, env, url);
    if (path.startsWith('/e/')) return handleEstimate(req, env, ctx, url);
    if (path.startsWith('/u/')) return handleOptOut(req, env, url);
    if (path.startsWith('/stripe/')) {
      try { const r = await handleStripe(req, env, ctx, url); if (r && r.status >= 500) ctx.waitUntil(opsAlert(env, 'stripe-webhook', '', 'The Stripe webhook answered ' + r.status)); return r; }
      catch (e) { ctx.waitUntil(opsAlert(env, 'stripe-webhook', '', (e && e.message) || 'threw')); return json({ ok: false }, 500); }
    }
    if (path === '/meta/webhook') return metaWebhook(req, env, ctx, url);
    if (path.startsWith('/meta/')) return handleMeta(req, env, url);
    if (path.startsWith('/voice/')) return handleVoice(req, env, ctx, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    const res = env.ASSETS ? await env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
    // "Coming soon" labels drop off by themselves once Google or Meta approves (launch.js).
    let page = res;
    try { page = rewritePage(res, await launchState(env)); } catch (e) { page = res; }
    return withSiteHeaders(page, url);
  },
  // Storm Desk: every 10 minutes, look for new National Weather Service warnings in our counties.
  async scheduled(event, env, ctx) {
    if (event && event.cron === RADAR_CRON) { ctx.waitUntil(watched(env, 'radar', radarWatch(env))); ctx.waitUntil(watched(env, 'rivals', rivalsWeekly(env))); ctx.waitUntil(watched(env, 'board', boardWeekly(env))); }
    else { ctx.waitUntil(watched(env, 'storm', stormWatch(env))); ctx.waitUntil(watched(env, 'app', appCron(env))); ctx.waitUntil(watched(env, 'invoices', invoiceCron(env))); ctx.waitUntil(watched(env, 'map', mapCron(env))); ctx.waitUntil(watched(env, 'business', bizCron(env))); ctx.waitUntil(watched(env, 'referrals', referralCron(env, { stripe: stripeCall, notify: (t, b) => opsPing(env, t, b, 'default', 'gift'), alert: (type, subject, body) => opsAlert(env, type, subject, body) }))); ctx.waitUntil(watched(env, 'callbacks', callbackCron(env))); ctx.waitUntil(watched(env, 'checkins', checkinCron(env))); ctx.waitUntil(purgeGoogle(env).catch(() => {})); ctx.waitUntil(watched(env, 'fullmax', fullMaxCron(env))); ctx.waitUntil(watched(env, 'texting-registration', a2pCron(env))); ctx.waitUntil(watched(env, 'funding', fundingCron(env))); ctx.waitUntil(watched(env, 'launch-watch', launchCron(env))); ctx.waitUntil(watched(env, 'google-profile', gbpCron(env))); ctx.waitUntil(watched(env, 'max-line-setup', provisionCron(env))); ctx.waitUntil(watched(env, 'texts-for-owners', autoCron(env))); ctx.waitUntil(healthCron(env).catch(() => {})); if (env.CALLROOM) ctx.waitUntil(watched(env, 'voice', voiceCron(env))); }
  }
};

// ---------- Storm Desk ----------
// Counties we watch (Georgia FIPS county codes), set in wrangler.toml as STORM_COUNTIES = "237:Putnam,009:Baldwin,...".
const STORM_EVENTS = /^(Tornado Warning|Severe Thunderstorm Warning|Flash Flood Warning|Flood Warning|Hurricane Warning|Tropical Storm Warning|High Wind Warning|Extreme Wind Warning|Ice Storm Warning|Winter Storm Warning|Hard Freeze Warning|Freeze Warning|Extreme Cold Warning)$/;
function stormGroup(ev) {
  if (/Flood/.test(ev)) return 'flood';
  if (/Freeze|Cold|Ice|Winter/.test(ev)) return 'freeze';
  return 'severe';
}
function stormCounties(env) {
  const m = {};
  String(env.STORM_COUNTIES || '').split(',').forEach(x => { const [code, name] = x.split(':'); if (code && name) m['013' + code.trim()] = name.trim(); });
  return m;
}
async function stormWatch(env) {
  const counties = stormCounties(env);
  if (!Object.keys(counties).length) return;
  try { await env.DB.prepare('CREATE TABLE IF NOT EXISTS storms (id TEXT PRIMARY KEY, at TEXT, event TEXT, grp TEXT, counties TEXT, headline TEXT, ends TEXT, link TEXT, sent TEXT)').run(); } catch (e) {}
  let data;
  try {
    const r = await fetch('https://api.weather.gov/alerts/active?area=GA', { headers: { 'User-Agent': 'AlwaysOpen Storm Desk (hello@alwaysopenoffice.com)', 'Accept': 'application/geo+json' } });
    if (!r.ok) return;
    data = await r.json();
  } catch (e) { return; }
  const feats = (data && data.features) || [];
  let sentNow = 0;
  for (const f of feats) {
    const p = f.properties || {};
    if (!STORM_EVENTS.test(p.event || '') || p.status !== 'Actual' || p.messageType === 'Cancel') continue;
    const same = ((p.geocode && p.geocode.SAME) || []).filter(c => counties[c]);
    if (!same.length) continue;
    const id = String(p.id || f.id || '').slice(-120);
    if (!id) continue;
    const seen = await env.DB.prepare('SELECT id FROM storms WHERE id = ?1').bind(id).first();
    if (seen) continue;
    // An update of a warning we already sent: remember it, don't send again.
    const refs = (p.references || []).map(x => String(x.identifier || x['@id'] || '').slice(-120)).filter(Boolean);
    let isUpdate = false;
    for (const ref of refs) { if (await env.DB.prepare('SELECT id FROM storms WHERE id = ?1').bind(ref).first()) { isUpdate = true; break; } }
    const names = [...new Set(same.map(c => counties[c]))];
    const row = { id, at: new Date().toISOString(), event: p.event, grp: stormGroup(p.event), counties: names.join(', '), headline: oneLine(p.headline || '').slice(0, 300), ends: p.ends || p.expires || '', link: 'https://alerts.weather.gov' };
    let sent = isUpdate ? 'update' : 'new';
    if (!isUpdate && sentNow < 6) {
      sentNow++;
      await Promise.all([stormPush(env, row), stormMail(env, row).then(st => { sent = st; })]);
    }
    await env.DB.prepare('INSERT OR IGNORE INTO storms (id, at, event, grp, counties, headline, ends, link, sent) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)')
      .bind(row.id, row.at, row.event, row.grp, row.counties, row.headline, row.ends, row.link, sent).run().catch(() => {});
  }
}
async function stormPush(env, s) {
  if (!env.NTFY_URL) return;
  try {
    await fetch(env.NTFY_URL, { method: 'POST', headers: { 'Title': ascii('Storm Desk: ' + s.event + ' - ' + s.counties), 'Priority': 'high', 'Tags': 'cloud_with_lightning_and_rain' },
      body: (s.headline || s.event) + '\nOpen Always Open HQ > Today > Storm Desk to draft storm posts for clients there.' });
  } catch (e) {}
}
async function stormMail(env, s) {
  if (!env.EMAIL || !env.MAIL_FROM || !env.MAIL_TO) return 'off';
  const domain = env.MAIL_FROM.split('@')[1] || 'localhost';
  const text = ['National Weather Service warning in a county we watch.', '',
    'Storm ID: ' + s.id, 'Event: ' + s.event, 'Group: ' + s.grp, 'Counties: ' + s.counties, 'Ends: ' + s.ends, 'Headline: ' + s.headline, 'Source: ' + s.link, '',
    'The Always Open check drafts storm posts for Storm Desk clients in these counties. Nothing posts until the client approves it.'].join('\r\n');
  const raw = ['From: "Always Open Storm Desk" <' + env.MAIL_FROM + '>', 'To: <' + env.MAIL_TO + '>',
    'Subject: ' + encodeHeader('Always Open storm alert: ' + s.event + ': ' + s.counties),
    'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>', 'Date: ' + new Date().toUTCString(),
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit'].join('\r\n') + '\r\n\r\n' + text;
  try { await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw)); return 'sent'; }
  catch (e) { return 'failed: ' + String((e && e.message) || e).slice(0, 180); }
}
async function stormsList(req, env, url) {
  const key = url.searchParams.get('key') || '';
  if (!env.LEADS_KEY || !(await sameKey(key, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
  try { await env.DB.prepare('CREATE TABLE IF NOT EXISTS storms (id TEXT PRIMARY KEY, at TEXT, event TEXT, grp TEXT, counties TEXT, headline TEXT, ends TEXT, link TEXT, sent TEXT)').run(); } catch (e) {}
  const rows = await env.DB.prepare('SELECT * FROM storms ORDER BY at DESC LIMIT 30').all();
  return json({ ok: true, storms: (rows && rows.results) || [] }, 200);
}

function withSiteHeaders(res, url) {
  const out = new Response(res.body, res);
  out.headers.set('x-content-type-options', 'nosniff');
  out.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  out.headers.set('x-frame-options', 'SAMEORIGIN');
  // Keep search engines off the temporary workers.dev address; the real domain is indexed.
  if (url.hostname.endsWith('.workers.dev')) out.headers.set('x-robots-tag', 'noindex');
  return out;
}

async function migrate(env) {
  if (migrated) return;
  migrated = true;
  for (const col of ['mail', 'sms_ok', 'ref']) {
    try { await env.DB.prepare('ALTER TABLE leads ADD COLUMN ' + col + ' TEXT').run(); } catch (e) { /* already there */ }
  }
}

async function lead(req, env, ctx, url) {
  const wantsJson = (req.headers.get('accept') || '').includes('application/json');
  const len = +(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) return reply(wantsJson, 413, false, 'That was too long', 'Please shorten your note and send it again.');
  let form;
  try { form = await req.formData(); } catch { return reply(wantsJson, 400, false, 'Something went wrong', 'Please go back and send the form again.'); }

  const f = {};
  for (const k of Object.keys(LIMITS)) f[k] = clean(form.get(k), LIMITS[k]);
  f.sms_ok = f.sms_ok === 'yes' ? 'yes' : 'no';
  f.ref = /^[A-Za-z0-9_-]{4,40}$/.test(f.ref) ? f.ref : '';
  const trap = String(form.get('company_site') || '').trim();
  const t = +form.get('t') || 0;
  const now = Date.now();
  const at = new Date(now).toISOString();
  const origin = clean(req.headers.get('origin') || '', 200);
  const ipHash = await hash((req.headers.get('cf-connecting-ip') || '') + '|' + (env.IP_SALT || 'salt'));

  // Quiet drops: a bot gets the normal thank-you, so it learns nothing.
  let reason = '';
  if (trap) reason = 'trap field filled';
  else if (!t || now - t < MIN_FILL_MS) reason = 'sent too fast';
  else if (now - t > MAX_AGE_MS) reason = 'form too old';
  else if ((f.notes.match(/https?:\/\//g) || []).length > 2) reason = 'links in note';

  if (!reason) {
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE ip_hash = ?1 AND at > ?2')
      .bind(ipHash, new Date(now - 3600000).toISOString()).first();
    if (recent && recent.n >= PER_HOUR) reason = 'too many from one sender';
  }
  if (!reason) {
    const problems = [];
    if (!f.name) problems.push('your name');
    if (!EMAIL_RE.test(f.email)) problems.push('a valid email');
    if (problems.length) return reply(wantsJson, 400, false, 'Almost there', 'Please add ' + problems.join(' and ') + '.');
  }

  await migrate(env);
  const status = reason ? 'spam' : 'new';
  const ins = await env.DB.prepare(
    'INSERT INTO leads (at, name, email, phone, business, town, type, plan, link, notes, origin, ip_hash, status, reason, sms_ok, ref) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)'
  ).bind(at, f.name, f.email, f.phone, f.business, f.town, f.type, f.plan, f.link, f.notes, origin, ipHash, status, reason || null, f.sms_ok, f.ref).run();
  const id = ins && ins.meta && ins.meta.last_row_id;

  if (!reason && f.ref) {
    try {
      const r = await env.DB.prepare('SELECT business FROM app_clients WHERE ref = ?1').bind(f.ref).first();
      f.referredBy = r && r.business ? r.business : 'unknown link (' + f.ref + ')';
    } catch (e) { f.referredBy = 'link ' + f.ref; }
  }
  if (!reason) {
    ctx.waitUntil(Promise.all([
      push(env, f, id),
      mail(env, f, id, at).then(state => id ? env.DB.prepare('UPDATE leads SET mail = ?1 WHERE id = ?2').bind(state, id).run().catch(() => {}) : null)
    ]));
  }
  const first = (f.name || '').split(/\s+/)[0];
  return reply(wantsJson, 200, true, 'Got it' + (first && !reason ? ', ' + first : '') + '.',
    'Your request reached us. Chris will reply within one business day, and your free audit follows within two. You can close this tab.');
}

async function push(env, f, id) {
  if (!env.NTFY_URL) return;
  const body = [f.name + (f.business ? ', ' + f.business : ''), [f.phone, f.email].filter(Boolean).join(' · '),
    [f.town, f.type, f.plan].filter(Boolean).join(' · '), f.referredBy ? 'Referred by: ' + f.referredBy : '', f.notes ? 'Note: ' + f.notes.slice(0, 300) : ''].filter(Boolean).join('\n');
  try {
    await fetch(env.NTFY_URL, { method: 'POST', headers: { 'Title': ascii('Always Open lead: ' + (f.business || f.name)), 'Priority': 'high', 'Tags': 'telephone_receiver' }, body });
  } catch (e) { /* the email and the daily check still catch it */ }
}

async function mail(env, f, id, at) {
  if (!env.EMAIL || !env.MAIL_FROM || !env.MAIL_TO) return 'off';
  const subject = 'Always Open website lead: ' + oneLine(f.business || f.name).slice(0, 120);
  const text = [
    'New request from the Always Open website.', '',
    'Lead ID: ' + (id || '?'), 'Name: ' + f.name, 'Business: ' + f.business, 'Phone: ' + f.phone, 'Email: ' + f.email,
    'Town: ' + f.town, 'Type: ' + f.type, 'Plan: ' + f.plan, 'Link: ' + f.link, 'Notes: ' + f.notes.replace(/\r?\n/g, ' '), 'OK to text: ' + f.sms_ok, 'Referred by: ' + (f.referredBy || 'none'),
    'Sent at: ' + at, '',
    'Reply to this email to answer them directly. It also goes into Always Open HQ, Pipeline, at the next Always Open check.'
  ].join('\r\n');
  const domain = env.MAIL_FROM.split('@')[1] || 'localhost';
  const headers = [
    'From: "Always Open website" <' + env.MAIL_FROM + '>',
    'To: <' + env.MAIL_TO + '>',
    'Subject: ' + encodeHeader(subject),
    'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>',
    'Date: ' + new Date().toUTCString(),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit'
  ];
  if (EMAIL_RE.test(f.email)) headers.splice(2, 0, 'Reply-To: <' + f.email + '>');
  const raw = headers.join('\r\n') + '\r\n\r\n' + text;
  try {
    await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw));
    return 'sent';
  } catch (e) {
    return 'failed: ' + String((e && e.message) || e).slice(0, 180);
  }
}

async function leadsList(req, env, url) {
  const key = url.searchParams.get('key') || '';
  if (!env.LEADS_KEY || !(await sameKey(key, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
  let since = url.searchParams.get('since') || '';
  if (!/^\d{4}-\d{2}-\d{2}/.test(since)) since = new Date(Date.now() - 3 * 86400000).toISOString();
  await migrate(env);
  const rows = await env.DB.prepare(
    "SELECT id, at, name, email, phone, business, town, type, plan, link, notes, sms_ok, mail, ref FROM leads WHERE status = 'new' AND at > ?1 ORDER BY id LIMIT 50"
  ).bind(since).all();
  const leads = (rows && rows.results) || [];
  return json({ ok: true, count: leads.length, leads }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}
async function sameKey(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0; for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
function oneLine(s) { return String(s || '').replace(/[\r\n\t]+/g, ' ').trim(); }
function ascii(s) { return s.replace(/[^\x20-\x7E]/g, '').slice(0, 120); }
function encodeHeader(s) {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const bytes = new TextEncoder().encode(s);
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return '=?UTF-8?B?' + btoa(bin) + '?=';
}
async function hash(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function reply(wantsJson, status, ok, title, text) {
  if (wantsJson) return json(ok ? { ok: true } : { ok: false, error: text }, status);
  return page(status, title, text);
}
function page(status, title, text) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Always Open</title><meta name="robots" content="noindex"><link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
:root{--paper:#F5F4F0;--card:#fff;--ink:#171B26;--slate:#586075;--line:#DCDAD3;--sign:#D92D20;--on:#fff}
@media (prefers-color-scheme:dark){:root{--paper:#12151D;--card:#1A1F2B;--ink:#EEF0F4;--slate:#9AA3B5;--line:#2B3243;--sign:#FF5A4D;--on:#1A0605}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px;max-width:460px;width:100%;display:grid;gap:14px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.01em}
h1{margin:0;font-size:1.7rem;line-height:1.15;letter-spacing:-.01em}p{margin:0;color:var(--slate)}
a.btn{justify-self:start;display:inline-block;background:var(--sign);color:var(--on);text-decoration:none;font-weight:700;padding:11px 18px;border-radius:10px}
</style></head><body><main class="card">
<div class="brand"><svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#E5372B"/><path d="M44.7 19.3A18 18 0 1 0 50 32" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="32" cy="32" r="5.5" fill="#fff"/></svg>Always Open</div>
<h1>${esc(title)}</h1><p>${esc(text)}</p><a class="btn" href="/">Back to Always Open</a>
</main></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
}


// ---------- Rate-Shock Radar ----------
// Every Monday: for each town in RADAR_TOWNS, look up insurance agencies on Google (Places API, New) and count
// recent reviews, recent low ratings and recent reviews about rates. Emails COUNTS ONLY and keeps nothing: Google's terms
// don't allow storing Places content, so there is no week-to-week table. No agency names, no reviewer names, no review text.
const RADAR_CRON = '17 12 * * 1';
const RATE_RE = /\b(rate|rates|premium|premiums|price|prices|bill|went up|goes up|going up|increase|increased|raised|doubled|expensive|afford)\b|tarifa|prima|precio|aument|subi[oó]|caro/i;
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + '-W' + String(Math.ceil(((t - y) / 86400000 + 1) / 7)).padStart(2, '0');
}
async function radarTown(env, town, now) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.PLACES_KEY, 'X-Goog-FieldMask': 'places.id,places.rating,places.userRatingCount,places.reviews' },
    body: JSON.stringify({ textQuery: 'insurance agency in ' + town, pageSize: 20 })
  });
  if (!r.ok) throw new Error('Places ' + r.status);
  const places = ((await r.json()) || {}).places || [];
  const cutoff = now - 30 * 86400000;
  let total = 0, wsum = 0, rate = 0, low = 0, recent = 0;
  for (const p of places) {
    const n = +p.userRatingCount || 0; total += n; wsum += (+p.rating || 0) * n;
    for (const rv of (p.reviews || [])) {
      const t = Date.parse(rv.publishTime || '');
      if (!t || t < cutoff) continue;
      recent++;
      if ((+rv.rating || 0) <= 2) low++;
      const txt = (rv.originalText && rv.originalText.text) || (rv.text && rv.text.text) || '';
      if (RATE_RE.test(txt)) rate++;
    }
  }
  return { places: places.length, total, avg: total ? Math.round(wsum / total * 100) / 100 : 0, recent, rate, low };
}
async function radarWatch(env) {
  if (!env.PLACES_KEY) return { ok: false, error: 'no key' };
  const towns = String(env.RADAR_TOWNS || '').split('|').map(x => x.trim()).filter(Boolean);
  if (!towns.length) return { ok: false, error: 'no towns' };
  const now = Date.now(), week = isoWeek(new Date(now)), at = new Date(now).toISOString(), lines = [], out = [];
  for (const town of towns.slice(0, 12)) {
    try {
      const m = await radarTown(env, town, now);
      // A wave: several recent reviews about rates, or a run of recent reviews with low ratings among them (last 30 days, from this lookup).
      const wave = m.rate >= 2 || (m.recent >= 6 && m.low >= 2);
      out.push(Object.assign({ town, week, wave }, m));
      lines.push('Town: ' + town + ' | Week: ' + week + ' | Agencies: ' + m.places + ' | Reviews total: ' + m.total + ' | Recent reviews (30 days): ' + m.recent +
        ' | Average rating: ' + m.avg + ' | Recent reviews about rates: ' + m.rate + ' | Recent 1-2 star: ' + m.low + ' | Wave: ' + (wave ? 'yes' : 'no'));
    } catch (e) {
      lines.push('Town: ' + town + ' | Week: ' + week + ' | Error: ' + String((e && e.message) || e).slice(0, 120));
    }
  }
  await radarMail(env, week, lines);
  if (out.some(x => x.wave) && env.NTFY_URL) {
    try { await fetch(env.NTFY_URL, { method: 'POST', headers: { 'Title': ascii('Rate-Shock Radar: complaints rising'), 'Priority': 'default', 'Tags': 'chart_with_upwards_trend' }, body: out.filter(x => x.wave).map(x => x.town + ': ' + x.rate + ' recent reviews about rates').join('\n') }); } catch (e) {}
  }
  return { ok: true, week, towns: out };
}
async function radarMail(env, week, lines) {
  if (!env.EMAIL || !env.MAIL_FROM || !env.MAIL_TO || !lines.length) return;
  const domain = env.MAIL_FROM.split('@')[1] || 'localhost';
  const text = ['Weekly Rate-Shock Radar. Counts only: no agency names, no reviewer names, no review text.', '', ...lines, '',
    'Source: Google Maps. Looked up for this email and not kept anywhere, so there is no week-to-week comparison. Please don\u2019t copy these numbers into a spreadsheet or HQ.'].join('\r\n');
  const raw = ['From: "Always Open Radar" <' + env.MAIL_FROM + '>', 'To: <' + env.MAIL_TO + '>', 'Subject: ' + encodeHeader('Always Open radar: ' + week),
    'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>', 'Date: ' + new Date().toUTCString(), 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit'].join('\r\n') + '\r\n\r\n' + text;
  try { await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw)); } catch (e) {}
}
async function radarRun(req, env, url) {
  const key = url.searchParams.get('key') || '';
  if (!env.LEADS_KEY || !(await sameKey(key, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
  return json(await radarWatch(env), 200);
}

// New signups, failed payments and cancellations: a phone push and an email to Chris.
async function billingNotify(env, ctx, title, body, priority) {
  const jobs = [];
  if (env.NTFY_URL) jobs.push(fetch(env.NTFY_URL, { method: 'POST', headers: { Title: ascii(title), Priority: priority || 'default', Tags: 'moneybag' }, body: String(body || '').slice(0, 2000) }).catch(() => {}));
  if (env.EMAIL && env.MAIL_FROM && env.MAIL_TO) {
    const domain = env.MAIL_FROM.split('@')[1] || 'localhost';
    const raw = ['From: "Always Open billing" <' + env.MAIL_FROM + '>', 'To: <' + env.MAIL_TO + '>', 'Subject: ' + encodeHeader(oneLine(title).slice(0, 140)),
      'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>', 'Date: ' + new Date().toUTCString(), 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit'].join('\r\n') + '\r\n\r\n' + body;
    jobs.push(env.EMAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw)).catch(() => {}));
  }
  await Promise.all(jobs);
}
