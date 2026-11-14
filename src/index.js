// Always Open on Cloudflare: serves the website (public/), and receives the website form.
// Each request is checked for spam, saved to D1, pushed to Christopher's phone (ntfy) and emailed to him.
// The Always Open check (scheduled task) reads new requests from that email, or from /leads with a key.
import { rivalsWeekly, ensureRivals, purgeGoogle, isoWeek as rivalWeek } from './rivals.js';
import { townKey } from './radar.js';
import { ensureReviews } from './reviews.js';
import { seedDemo, demoNightly } from './demo.js';
import { handleOpsBoard, boardWeekly } from './opsboard.js';
import { ensureBiz } from './biz.js';
import { handleHqPlans } from './hqplans.js';
import { handleHqSense } from './hqsense.js';
import { opsAlert, watched, healthCron, healthDetail, healthStatus, crashed, slowCron } from './ops.js';
import { EmailMessage } from 'cloudflare:email';
import { handleApp, aasa, photoGet, audioGet, appCron, handleQuote, handleLocations, opsPing, pushClient } from './app.js';
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
import { aiCheckCron } from './aicheck.js';
import { neonEmail, rawEmail } from './neonmail.js';
import { monthReportCron } from './report.js';
import { fillCron } from './fillweek.js';
import { weeklyGrade, queueSet } from './grades.js';
import { minutesCron } from './minutes.js';
import { morningCron } from './morning.js';
import { silenceWeekly } from './silence.js';
import { backupCron, runBackup, lastBackup } from './backup.js';
import { connectionsCron } from './connections.js';
import { socialCron } from './social.js';
import { photoPostCron } from './posts.js';
import { boardToken } from './opsboard.js';
import { harden, sitePolicy } from './headers.js';
import { tryRefresh as gcalRefresh } from './gcal.js';
import { tryRefresh as gbpRefresh } from './gbp.js';

// The AI phone line keeps each live call in a CallRoom (a Durable Object), so the class is exported from here.
export { CallRoom };
// Gates HQ's calls for Christopher keep each call in an HqCallRoom (hqcalls.js).
export { HqCallRoom } from './hqcalls.js';
// Gates HQ's private brain reaches Claude through this entrypoint (a service binding, never the internet): hqclaude.js.
export { HqClaude } from './hqclaude.js';

const MAX_BODY = 12000;          // bytes
const MIN_FILL_MS = 3000;        // faster than this is a bot
const MAX_AGE_MS = 3 * 86400000; // a form left open for days is stale
const PER_HOUR = 5;              // requests per sender per hour
const LIMITS = { name: 80, email: 120, phone: 40, business: 120, town: 80, type: 60, plan: 40, link: 300, notes: 1500, sms_ok: 3, ref: 40 };
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
let migrated = false;

// Every request. Anything that throws in here lands in `crashed` (ops.js): one alert, one row, a readable page.
async function serve(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === '/sample-report') {
      // The one page every client gets on the 2nd of the month, with a made-up plumber (monthpage.js).
      const { samplePage } = await import('./monthpage.js');
      // Above the made-up month, one line of real numbers from every business together, once there are enough of them.
      // Worked out at most once a day (answerrate.networkCached), not once per visitor.
      let proof = ''; try { const A = await import('./answerrate.js'); proof = A.networkLine(await A.networkCached(env)); } catch (e) { proof = ''; }
      return withSiteHeaders(new Response(samplePage(proof), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } }), url);
    }
    if (path === '/health') {
      const k = req.headers.get('x-key') || '';
      if (k && env.LEADS_KEY && await sameKey(k, env.LEADS_KEY)) return json(await healthDetail(env), 200);
      // The outside monitor reads this: 200 "ok", or 503 naming the failed checks (no details that could help an attacker).
      // ?core=1 (the deploy's check) looks only at what a deploy can change: the Worker, the database, the keys and the cron.
      let h; try { h = await healthStatus(env, Date.now(), url.searchParams.get('core') === '1' ? true : (url.searchParams.get('all') === '1' ? false : 'monitor')); } catch (e) { h = { ok: false, checks: [{ name: 'health', ok: false }] }; }
      return new Response(h.ok ? 'ok' : 'not ok: ' + h.checks.filter(c => !c.ok).map(c => c.name).join(', '), { status: h.ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
    }
    if (path === '/ops' || path === '/ops/done' || path === '/ops/map' || path === '/ops/compliance-pack' || path === '/ops/numbers' || path === '/ops/hq' || path === '/ops/hq/reply' || path === '/ops/hq/lead' || path === '/ops/hq/post' || path === '/ops/hq/client' || path === '/ops/hq/proposal' || path === '/ops/outreach-switch') return handleOpsBoard(req, env, url);
    if (path === '/api/map') return handleMapApi(req, env, url, ctx);
    if (path === '/ops/twilio-setup') {
      // Points every Always Open number's "A message comes in" at our webhook and adds it to the Messaging Service, so replies and STOP reach us.
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.VOICE_KEY)) return json({ ok: false, error: 'Twilio keys missing' }, 400);
      const auth = 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN), base = 'https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID;
      const nums = ((await env.DB.prepare('SELECT number, business, transfer_to FROM voice_lines').all()).results) || [];
      const { fallbackUrl } = await import('./provision.js');
      const out = [];
      for (const n of nums) {
        const row = { number: n.number, business: n.business || '' };
        try {
          const l = await fetch(base + '/IncomingPhoneNumbers.json?PhoneNumber=' + encodeURIComponent(n.number), { headers: { authorization: auth } }).then(r => r.json());
          const pn = l.incoming_phone_numbers && l.incoming_phone_numbers[0];
          if (!pn) { row.result = 'not in this Twilio account'; out.push(row); continue; }
          const u = await fetch(base + '/IncomingPhoneNumbers/' + pn.sid + '.json', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ SmsUrl: 'https://alwaysopenoffice.com/voice/sms/' + env.VOICE_KEY, SmsMethod: 'POST', VoiceUrl: 'https://alwaysopenoffice.com/voice/in/' + env.VOICE_KEY, VoiceMethod: 'POST', VoiceFallbackUrl: fallbackUrl(n.business, env.VOICE_KEY), VoiceFallbackMethod: 'GET' }).toString() });
          row.webhook = u.ok ? 'set (with the fallback message)' : 'failed ' + u.status;
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
    if (path === '/ops/heartbeat') {
      // Scheduled tasks outside the worker say they ran: POST {task:"check"} with the key.
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      let b = {}; try { b = await req.json(); } catch (e) {}
      const task = String(b.task || '').replace(/[^a-z0-9-]/g, '').slice(0, 30);
      if (!task) return json({ ok: false, error: 'task needed' }, 400);
      const f = await import('./funding.js');
      await f.ensureHeartbeats(env);
      await env.DB.prepare('INSERT OR REPLACE INTO heartbeats (task, at) VALUES (?1, ?2)').bind(task, new Date().toISOString()).run();
      return json({ ok: true, task }, 200);
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
    if (path === '/ops/call-events') {
      // Build Brief 8: Twilio's own record of a call (the call, its webhook events, its errors, and Voice Insights' summary
      // and media events), to see what Twilio saw the second a call's line to Max dropped. Read-only.
      const k = req.headers.get('x-key') || '';
      if (!env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      const sid = url.searchParams.get('sid') || '';
      if (!/^CA[0-9a-f]{32}$/.test(sid) || !env.TWILIO_ACCOUNT_SID) return json({ ok: false, error: 'bad sid' }, 400);
      const auth = 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN);
      const get = async u => { try { const r = await fetch(u, { headers: { Authorization: auth } }); const t = await r.text(); try { return { status: r.status, data: JSON.parse(t) }; } catch (e) { return { status: r.status, text: t.slice(0, 2000) }; } } catch (e) { return { error: String(e).slice(0, 200) }; } };
      const base = 'https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/Calls/' + sid;
      const [call, events, notes, summary, media] = await Promise.all([get(base + '.json'), get(base + '/Events.json?PageSize=50'), get(base + '/Notifications.json'),
        get('https://insights.twilio.com/v1/Voice/' + sid + '/Summary'), get('https://insights.twilio.com/v1/Voice/' + sid + '/Events?PageSize=100')]);
      return json({ ok: true, call, events, notes, summary, media }, 200);
    }
    if (path === '/ops/rehearse-set') {
      // After a change to Max's instructions: replay the last 20 calls that went wrong. Results land in voice_log (kind 'rehearse').
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      return json({ ok: true, queued: await queueSet(env) }, 200);
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
    if (path === '/ops/hq-code') {
      // Gates HQ "Happening now": a code pulse may file one row here, and the Gates HQ page reads it through the owner's
      // Cloudflare connection. Key-guarded, one row, size-capped. Nothing files here since Nov 11, 2026: the loop that
      // did (every minute, around the clock, on this repo's free build minutes) was retired, and the page now draws
      // from Gates HQ's own paced pulse; a row more than ten minutes old is ignored by the page.
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      const body = await req.text();
      if (body.length > 200000) return json({ ok: false, error: 'too big' }, 413);
      let at = ''; try { at = String(JSON.parse(body).at || ''); } catch (e) { return json({ ok: false, error: 'not json' }, 400); }
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS hq_code (id INTEGER PRIMARY KEY, at TEXT, json TEXT)').run();
      await env.DB.prepare('INSERT OR REPLACE INTO hq_code (id, at, json) VALUES (1, ?1, ?2)').bind(at, body).run();
      return json({ ok: true, at });
    }
    if (path === '/ops/hq-widget') {
      // Gates HQ home-screen widget: the Gates HQ page and the chief-of-staff task save one row in D1 (hq_widget);
      // the iPhone widget reads it here with its private token. Read-only, no key needed beyond the token.
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS hq_widget (id INTEGER PRIMARY KEY, token TEXT, at TEXT, json TEXT)').run();
      const t = url.searchParams.get('t') || '';
      if (req.method !== 'GET' || t.length < 24) return json({ ok: false }, 404);
      const row = await env.DB.prepare('SELECT token, at, json FROM hq_widget WHERE id = 1').first();
      if (!row || !row.token || !(await sameKey(t, row.token))) return json({ ok: false }, 404);
      return new Response(row.json || '{}', { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    if (path === '/ops/hq-health') {
      // Gates HQ health: the Gates HQ iPhone app sends one row per day from Apple Health (sleep, resting heart rate,
      // HRV, steps, energy, exercise) with the widget's private token; the Gates HQ page reads them from D1.
      const t = url.searchParams.get('t') || '';
      if (req.method !== 'POST' || t.length < 24) return json({ ok: false }, 404);
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS hq_widget (id INTEGER PRIMARY KEY, token TEXT, at TEXT, json TEXT)').run();
      const row = await env.DB.prepare('SELECT token FROM hq_widget WHERE id = 1').first();
      if (!row || !row.token || !(await sameKey(t, row.token))) return json({ ok: false }, 404);
      const body = await req.text();
      if (body.length > 400000) return json({ ok: false, error: 'too big' }, 413);
      let days = []; try { days = JSON.parse(body).days || []; } catch (e) { return json({ ok: false, error: 'not json' }, 400); }
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS hq_health (d TEXT PRIMARY KEY, sleep_h REAL, deep_h REAL, rem_h REAL, bed TEXT, wake TEXT, rhr REAL, hrv REAL, steps INTEGER, kcal REAL, ex_min REAL, at TEXT)').run();
      // v2 columns (more from the watch); added once to an older table
      const NUMS = ['sleep_h', 'deep_h', 'rem_h', 'core_h', 'awake_h', 'rhr', 'hrv', 'steps', 'kcal', 'ex_min', 'resp', 'spo2', 'wrist_c', 'vo2', 'walk_hr', 'hr_avg', 'hr_max', 'stand_min', 'daylight_min', 'dist_km', 'flights', 'noise_db', 'mindful_min'];
      const have = new Set(((await env.DB.prepare('PRAGMA table_info(hq_health)').all()).results || []).map(c => c.name));
      for (const c of [...NUMS, 'workouts']) if (!have.has(c)) await env.DB.prepare(`ALTER TABLE hq_health ADD COLUMN ${c} ${c === 'workouts' ? 'TEXT' : 'REAL'}`).run();
      const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null), str = (v) => (typeof v === 'string' ? v.slice(0, 10) : null);
      const now = new Date().toISOString();
      const cols = ['d', ...NUMS, 'bed', 'wake', 'workouts', 'at'];
      const sql = `INSERT OR REPLACE INTO hq_health (${cols.join(', ')}) VALUES (${cols.map((_, i) => '?' + (i + 1)).join(', ')})`;
      const stmts = days.filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.d || '')).slice(0, 400).map(x => env.DB.prepare(sql)
        .bind(x.d, ...NUMS.map(c => num(x[c])), str(x.bed), str(x.wake), typeof x.workouts === 'string' ? x.workouts.slice(0, 4000) : null, now));
      if (stmts.length) await env.DB.batch(stmts);
      return json({ ok: true, saved: stmts.length });
    }
    if (path === '/ops/hq-sense') {
      // Gates HQ home sensing (Wi-Fi sensing boards and phones on the home Wi-Fi), posted by the Mac. Mac key only.
      const k = req.headers.get('x-key') || '';
      if (!env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      return handleHqSense(req, env, json);
    }
    if (path === '/ops/hq-call-tick') {
      // Gates HQ calls he approved on his page: the Mac pings this every couple of minutes so a call starts quickly. Mac key.
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      const hc = await import('./hqcalls.js');
      ctx.waitUntil(hc.hqLineEnsure(env).catch(() => null));
      return json({ ok: true, started: await hc.hqCallsTick(env) }, 200);
    }
    if (path === '/ops/hq-rehearse') {
      // Practice calls and texts for Gates HQ with the real model; nothing is dialed, sent or saved (hqrehearse.js). Mac key.
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      let b = {}; try { b = await req.json(); } catch (e) { b = {}; }
      return json(await (await import('./hqrehearse.js')).rehearseHq(env, String(b.what || 'all')), 200);
    }
    if (path === '/ops/hq-text' || path === '/ops/hq-text-queue') {
      // Gates HQ answers his texts (hqtexts.js): the Mac sends waiting texts and takes the replies he approved. Mac key.
      const k = req.headers.get('x-key') || '';
      if (!env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      const ht = await import('./hqtexts.js');
      return path === '/ops/hq-text' ? ht.handleHqText(req, env, json) : ht.handleHqTextQueue(req, env, json);
    }
    if (path === '/ops/hq-plans') {
      // Gates HQ: plans from his texts (the Mac sends texts that mention a time; Claude Haiku pulls out the plan). Mac key only.
      const k = req.headers.get('x-key') || '';
      if (!env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      return handleHqPlans(req, env, json);
    }
    if (path === '/ops/hq-where') {
      // Gates HQ "am I on time": the Gates HQ iPhone app sends where Christopher is (arrived/left Home or Daycare, places
      // he stopped, and a point now and then while driving), and an iPhone Shortcut sends "alarm" when he stops his alarm.
      // Same private token as the widget. Kept 90 days; only his own Gates HQ page reads it (D1 hq_where).
      const t = url.searchParams.get('t') || '';
      if (t.length < 24) return json({ ok: false }, 404);
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS hq_widget (id INTEGER PRIMARY KEY, token TEXT, at TEXT, json TEXT)').run();
      const row = await env.DB.prepare('SELECT token FROM hq_widget WHERE id = 1').first();
      if (!row || !row.token || !(await sameKey(t, row.token))) return json({ ok: false }, 404);
      let pts = [];
      if (req.method === 'GET') {
        const kind = (url.searchParams.get('kind') || '').slice(0, 20);
        if (!/^(alarm|wake|snooze|smoke|pour)$/.test(kind)) return json({ ok: false, error: 'kind' }, 400);
        pts = [{ at: new Date().toISOString(), kind }];
      } else if (req.method === 'POST') {
        const body = await req.text();
        if (body.length > 100000) return json({ ok: false, error: 'too big' }, 413);
        try { pts = JSON.parse(body).pts || []; } catch (e) { return json({ ok: false, error: 'not json' }, 400); }
      } else return json({ ok: false }, 404);
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS hq_where (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, lat REAL, lon REAL, acc REAL, place TEXT, until TEXT)').run();
      const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
      const iso = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(v) ? v.slice(0, 24) : null);
      const stmts = pts.filter(p => p && iso(p.at) && /^[a-z]{2,12}$/.test(p.kind || '')).slice(0, 200).map(p => env.DB
        .prepare('INSERT INTO hq_where (at, kind, lat, lon, acc, place, until) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(iso(p.at), p.kind, num(p.lat), num(p.lon), num(p.acc), typeof p.place === 'string' ? p.place.slice(0, 30) : null, iso(p.until)));
      if (stmts.length) await env.DB.batch(stmts);
      await env.DB.prepare("DELETE FROM hq_where WHERE at < ?1").bind(new Date(Date.now() - 90 * 864e5).toISOString()).run();
      return json({ ok: true, saved: stmts.length });
    }
    if (path === '/ops/push-queue') {
      // The Gates HQ agent on the Mac relays phone pushes ntfy refused from here (push.js). GET takes, POST reports.
      const k = req.headers.get('x-key') || '';
      if (!env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      const P = await import('./push.js');
      if (req.method === 'POST') { let b = {}; try { b = await req.json(); } catch (e) {} return json(await P.relayDone(env, b)); }
      return json(await P.relayTake(env));
    }
    if (path.startsWith('/mail/letter/')) {
      // The mailed letter's page, only while Lob is making it (mail.js); gone right after.
      const html = await (await import('./mail.js')).serveLetter(env, path.slice('/mail/letter/'.length));
      return html ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } }) : new Response('Not found', { status: 404 });
    }
    if (path === '/ops/mail-on' || path === '/ops/mail-queue') {
      // "Turn on mailed letters" on the Mac (his caps), and the Prospector adding businesses. Both need the key.
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      let b = {}; try { b = await req.json(); } catch (e) { b = {}; }
      const M = await import('./mail.js');
      return json(Object.assign({ ok: true }, path === '/ops/mail-on' ? await M.turnOn(env, b.daily, b.monthly) : await M.queueLetters(env, b.items)));
    }
    if (path === '/ops/test-call') {
      // Christopher's yes to the 4 AM test call (drill.js): "Turn on 4 AM test call" on the Mac posts here with the key,
      // after he types yes to the price. The next 10-minute run buys the test number; the first call is at 4 AM.
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      const D = await import('./drill.js');
      await D.ensureDrill(env);
      const have = await env.DB.prepare("SELECT v FROM drill_meta WHERE k = 'from'").first();
      if (!have) await env.DB.prepare("INSERT OR REPLACE INTO drill_meta (k, v) VALUES ('buy', 'approved')").run();
      return json({ ok: true, status: have ? 'already on: the test number is ' + have.v : 'approved: the test number is bought in the next 10 minutes, and the first test call is at 4 AM' });
    }
    if (path === '/ops/seed-demo') {
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      try { return json(await seedDemo(env, { ensureBiz, ensureInvoices, ensureRivals, ensureReviews, isoWeek: rivalWeek })); } catch (e) { return json({ ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500); }
    }
    if (path === '/ops/social-post' && req.method === 'POST') {
      // Put up today's Always Open post now, whatever the day and hour (the first test, or a make-up), with the key.
      const k = req.headers.get('x-key') || '';
      if (!env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      return json(Object.assign({ ok: true }, await socialCron(env, Date.now(), { ping: (t, b, pr, tag, click) => opsPing(env, t, b, pr, tag, click), alert: (type, who, detail) => opsAlert(env, type, who, detail), boardToken: () => boardToken(env) }, { force: true })), 200);
    }
    if (path === '/ops/backup') {
      // Run the weekly backup now (POST) or see when it last ran (GET), with the key.
      const k = req.headers.get('x-key') || '';
      if (!env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      if (req.method === 'POST') return json(Object.assign({ ok: true }, await runBackup(env)), 200);
      const { dump, gzip, TABLES } = await import('./backup.js');
      if (url.searchParams.get('download') === '1') { const d = await dump(env); return new Response(await gzip(d.text), { headers: { 'content-type': 'application/gzip', 'content-disposition': 'attachment; filename="alwaysopen-' + new Date().toISOString().slice(0, 10) + '.jsonl.gz"', 'cache-control': 'no-store' } }); }
      if (url.searchParams.get('counts') === '1') { const counts = {}; for (const t of TABLES) { try { counts[t] = +((await env.DB.prepare('SELECT COUNT(*) AS n FROM ' + t).first()) || {}).n || 0; } catch (e) { /* no such table */ } } return json({ ok: true, counts }, 200); }
      return json({ ok: true, last: await lastBackup(env) }, 200);
    }
    if (path === '/ops/mail-test') {
      // The deploy calls this once: an email to Christopher from the sending address, so a broken address fails the deploy, not a customer.
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      const { mailOwner } = await import('./app.js');
      const r = await mailOwner(env, 'Always Open deployed', 'A new version of the site and Worker is live. This email is the deploy’s check that alert emails still arrive from ' + (env.MAIL_FROM || 'the sending address') + '.');
      return json({ ok: r === 'sent', result: r, from: env.MAIL_FROM || '' }, r === 'sent' ? 200 : 500);
    }
    if (path === '/ops/deploy-failed') {
      const k = req.headers.get('x-key') || '';
      if (req.method !== 'POST' || !env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      let why = ''; try { why = String((await req.json()).why || '').slice(0, 300); } catch (e) { why = ''; }
      const r = await opsAlert(env, 'deploy', '', why ? (/^the site is live/.test(why) ? why.charAt(0).toUpperCase() + why.slice(1) + '. Check the sending address in Cloudflare Email Routing.' : 'A deploy was rolled back because the live check failed: ' + why + '. The site is on the previous version. Open the Actions tab of christophergates88/alwaysopen to see why.') : 'A GitHub deploy failed. Open the Actions tab of christophergates88/alwaysopen to see why.');
      return json({ ok: true, alert: r }, 200);
    }
    if (path === '/lead/stop' || path === '/lead/go') return (await import('./leadmail.js')).handleStop(req, env, url);
    if (path.startsWith('/your-audit/')) return (await import('./leadmail.js')).handleAuditPage(req, env, url, { ping: (t, b) => phonePush(env, { title: t, body: b, priority: 'high', tags: 'mag' }) });
    if (path === '/lead') {
      if (req.method === 'POST') return lead(req, env, ctx, url);
      // The form's start time, signed by us, so how long the form was open never depends on the visitor's clock.
      if (url.searchParams.get('t') === '1') return json({ ok: true, t: await (await import('./leadmail.js')).formStamp(env) }, 200);
      return Response.redirect(url.origin + '/#contact', 303);
    }
    if (path === '/leads') return leadsList(req, env, url);
    if (path === '/storms') return stormsList(req, env, url);
    if (path === '/start' || path === '/welcome' || path.startsWith('/billing/')) {
      try { const r = await handleBilling(req, env, url, { json, sameKey, notify: (t, b, pr) => billingNotify(env, ctx, t, b, pr), later: p => ctx.waitUntil(p) }); if (r && r.status >= 500) ctx.waitUntil(opsAlert(env, 'stripe-checkout', '', 'Checkout/billing answered ' + r.status + ' on ' + path)); return r; }
      catch (e) { ctx.waitUntil(opsAlert(env, 'stripe-checkout', '', ((e && e.message) || 'threw') + ' on ' + path)); return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500); }
    }
    if (path === '/audit/tool' || path === '/audit/run' || path === '/audit/score' || path === '/audit/letter') return handleAudit(req, env, url, { json, sameKey, ipHash: (r, e) => hash((r.headers.get('cf-connecting-ip') || '') + '|' + (e.IP_SALT || 'salt')) });
    if (path === '/radar') return radarRun(req, env, url);
    if (path === '/.well-known/apple-app-site-association') return aasa();
    if (path === '/.well-known/security.txt' || path === '/security.txt') {
      // Where someone who finds a security problem can report it (RFC 9116). The date always sits about a year ahead.
      const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 11, 1); d.setUTCHours(0, 0, 0, 0);
      return new Response(['Contact: mailto:hello@alwaysopenoffice.com', 'Expires: ' + d.toISOString().replace('.000Z', 'Z'), 'Preferred-Languages: en', 'Canonical: https://alwaysopenoffice.com/.well-known/security.txt', ''].join('\n'),
        { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
    }
    if (path === '/locations') { const k = req.headers.get('x-key') || ''; return handleLocations(req, env, !!env.LEADS_KEY && await sameKey(k, env.LEADS_KEY)); }
    if (path.startsWith('/google/')) return handleGoogle(req, env, url);
    if (path === '/app' || path.startsWith('/app/')) return handleApp(req, env, ctx, url);
    if (path.startsWith('/p/')) return photoGet(env, url);
    if (path.startsWith('/a/')) return audioGet(env, url);
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
    if (path.startsWith('/voice/recorded/')) {
      // Twilio's note that the Hear Max recording is done (hearmax.js). Only the armed call is ever kept.
      if (req.method !== 'POST' || !env.VOICE_KEY || !(await sameKey(path.slice('/voice/recorded/'.length), env.VOICE_KEY))) return new Response('Not found', { status: 404 });
      const form = await req.formData().catch(() => new FormData());
      ctx.waitUntil((await import('./hearmax.js')).recordedHook(env, form, { ping: (t, b, click) => opsPing(env, t, b, 'default', 'microphone', click) }).catch(e => opsAlert(env, 'hear-max', 'always-open', 'Saving the Hear Max recording failed: ' + String((e && e.message) || e))));
      return new Response('ok');
    }
    if (path.startsWith('/r/')) {
      // A tap on the link in Always Open's own review ask (ourreviews.js): counted, then on to Google.
      const go = String(env.ALWAYS_OPEN_REVIEW_LINK || '');
      try { await (await import('./ourreviews.js')).tap(env, path.slice(3)); } catch (e) { /* the redirect still happens */ }
      return Response.redirect(/^https:\/\//.test(go) ? go : 'https://alwaysopenoffice.com/', 302);
    }
    if (path === '/hear-max.json') return (await import('./hearmax.js')).serveJson(env, url);
    if (path === '/hear-max.mp3' || path === '/hear-max-es.mp3') return (await import('./hearmax.js')).serveAudio(env, req, path === '/hear-max-es.mp3' ? 'es' : 'en');
    if (path === '/ops/post') return (await import('./postqueue.js')).handlePostQueue(req, env, url);
    if (path === '/ops/hear-max') { const { boardOk } = await import('./opsboard.js'); return (await import('./hearmax.js')).armPage(env, req, url, await boardOk(env, url.searchParams.get('t') || '')); }
    // anyone can stop Outreach calls to their number from the website (outreach.js stopPage)
    // The sample account, for a visitor who wants to tap through the app before signing up.
    if (path === '/demo') return new Response(null, { status: 302, headers: { location: (await import('./demo.js')).DEMO_LINK, 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
    if (path === '/stop-calls') return withSiteHeaders(await (await import('./outreach.js')).stopPage(env, req, url), url);
    if (path === '/ops/dnc-list') {
      // Our copy of the National Do Not Call Registry (dnclist.js): the Mac's monthly loader sends it here (POST, one step
      // at a time), and GET says how old it is. The ops key only; the list itself is never sent back out.
      const k = req.headers.get('x-key') || '';
      if (!env.LEADS_KEY || !(await sameKey(k, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
      const D = await import('./dnclist.js');
      if (req.method === 'GET') return json(Object.assign({ ok: true }, await D.dncListStatus(env)), 200);
      if (req.method !== 'POST') return json({ ok: false, error: 'POST or GET' }, 405);
      let body = null; try { body = await req.json(); } catch (e) { return json({ ok: false, error: 'send JSON' }, 400); }
      try { const r = await D.loadStep(env, body); return json(r, r.ok ? 200 : 400); } catch (e) { return json({ ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500); }
    }
    if (path === '/ops/outreach-review') {
      // A held Outreach list or sentence: why it was held, and Approve or Reject (outreach.js reviewPage). The push that
      // links here carries a dated board token; the ops board's cookie works too.
      const { boardOk } = await import('./opsboard.js'), k = req.headers.get('x-key') || '';
      if (!((k && env.LEADS_KEY && await sameKey(k, env.LEADS_KEY)) || await boardOk(env, url.searchParams.get('t') || '', req))) return new Response('This link has expired. Open the newest Outreach push or the ops board.', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
      return (await import('./outreach.js')).reviewPage(env, req, url);
    }
    if (path.startsWith('/hq/t/') && (req.method === 'GET' || req.method === 'POST')) return (await import('./hqtexts.js')).handleApprove(req, env, path.slice('/hq/t/'.length));
    if (path.startsWith('/voice/')) return handleVoice(req, env, ctx, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    const res = env.ASSETS ? await env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
    // "Coming soon" labels drop off by themselves once Google or Meta approves (launch.js).
    let page = res;
    try { page = rewritePage(res, await launchState(env)); } catch (e) { page = res; }
    return withSiteHeaders(page, url);
}

export default {
  async fetch(req, env, ctx) {
    // every answer leaves with the security headers (headers.js); a crash page too
    try { return harden(await serve(req, env, ctx)); } catch (e) { return harden(await crashed(req, env, ctx, e)); }
  },
  // Storm Desk: every 10 minutes, look for new National Weather Service warnings in our counties.
  // Mail to hello@ (Cloudflare Email Routing -> this Worker): forwarded to Christopher first, then Google's review emails
  // become reply drafts and replies from audit leads stop their follow-ups (src/mailin.js).
  async email(message, env, ctx) {
    const { inbound } = await import('./mailin.js');
    await inbound(message, env, ctx);
  },
  async scheduled(event, env, ctx) {
    if (event && event.cron === RADAR_CRON) { ctx.waitUntil(watched(env, 'radar', radarWatch(env))); ctx.waitUntil(watched(env, 'rivals', rivalsWeekly(env))); ctx.waitUntil(watched(env, 'board', boardWeekly(env))); ctx.waitUntil(watched(env, 'silence', silenceWeekly(env, Date.now(), (type, who, detail) => opsAlert(env, type, who, detail)))); ctx.waitUntil(watched(env, 'maxweek', weeklyGrade(env, Date.now(), (t, b) => opsPing(env, t, b, 'default', 'telephone_receiver')))); }
    else { ctx.waitUntil(watched(env, 'storm', stormWatch(env))); ctx.waitUntil(watched(env, 'google-queue', (async () => (await import('./postqueue.js')).queuePush(env))())); ctx.waitUntil(watched(env, 'season-posts', (async () => (await import('./mailin.js')).seasonPosts(env))())); ctx.waitUntil(watched(env, 'numbers', (async () => (await import('./numbers.js')).numbersDaily(env))())); ctx.waitUntil(watched(env, 'app', appCron(env))); ctx.waitUntil(watched(env, 'invoices', invoiceCron(env))); ctx.waitUntil(watched(env, 'map', mapCron(env))); ctx.waitUntil(watched(env, 'business', bizCron(env))); ctx.waitUntil(watched(env, 'referrals', referralCron(env, { stripe: stripeCall, notify: (t, b) => opsPing(env, t, b, 'default', 'gift'), alert: (type, subject, body) => opsAlert(env, type, subject, body) }))); ctx.waitUntil(watched(env, 'callbacks', callbackCron(env))); ctx.waitUntil(watched(env, 'checkins', checkinCron(env))); ctx.waitUntil(watched(env, 'outreach', (async () => (await import('./outreach.js')).outreachCron(env))()));ctx.waitUntil(watched(env, 'calls-out', (async () => (await import('./outcalls.js')).outCallsCron(env))())); ctx.waitUntil(watched(env, 'gates-hq-calls', (async () => { const hc = await import('./hqcalls.js'); await hc.hqLineEnsure(env).catch(() => null); return hc.hqCallsTick(env); })())); ctx.waitUntil(watched(env, 'gates-hq-mac', (async () => (await import('./hqtexts.js')).macWatch(env))())); ctx.waitUntil(watched(env, 'gates-hq-brain', (async () => (await import('./hqbrainlink.js')).brainLink(env, Date.now(), (t, b) => opsPing(env, t, b, 'high', 'brain')))())); ctx.waitUntil(watched(env, 'max-timecard', (async () => (await import('./timecard.js')).timecardCron(env))())); ctx.waitUntil(purgeGoogle(env).catch(() => {})); ctx.waitUntil(watched(env, 'past-held', (async () => (await import('./past.js')).sendHeldRevive(env))()));ctx.waitUntil(watched(env, 'fullmax', fullMaxCron(env))); ctx.waitUntil(watched(env, 'texting-registration', a2pCron(env))); ctx.waitUntil(watched(env, 'funding', fundingCron(env))); ctx.waitUntil(watched(env, 'launch-watch', launchCron(env))); ctx.waitUntil(watched(env, 'google-profile', gbpCron(env))); ctx.waitUntil(watched(env, 'max-line-setup', provisionCron(env))); ctx.waitUntil(watched(env, 'texts-for-owners', autoCron(env))); ctx.waitUntil(watched(env, 'assistants-check', aiCheckCron(env))); ctx.waitUntil(watched(env, 'monthly-report', monthReportCron(env))); ctx.waitUntil(watched(env, 'fill-my-week', fillCron(env))); ctx.waitUntil(watched(env, 'google-connections', connectionsCron(env, Date.now(), { refresh: (kind, cid) => kind === 'calendar' ? gcalRefresh(env, cid) : gbpRefresh(env, cid), push: (cid, n) => pushClient(env, cid, n), alert: (type, who, detail) => opsAlert(env, type, who, detail) }))); ctx.waitUntil(watched(env, 'lead-follow-ups', (async () => (await import('./leadmail.js')).followCron(env))())); ctx.waitUntil(watched(env, 'phone-push', (async () => (await import('./push.js')).pushCron(env))())); ctx.waitUntil(watched(env, 'voicemail', (async () => (await import('./voicemail.js')).vmSweep(env))())); ctx.waitUntil(watched(env, 'missed-texts', (async () => (await import('./sms.js')).smsSweep(env))())); ctx.waitUntil(watched(env, 'test-call', (async () => (await import('./drill.js')).drillCron(env))())); ctx.waitUntil(watched(env, 'checks', (async () => (await import('./checks.js')).checksCron(env))())); ctx.waitUntil(watched(env, 'mailed-letters', (async () => (await import('./mail.js')).mailCron(env))())); ctx.waitUntil(watched(env, 'audit-retry', (async () => (await import('./leadmail.js')).auditRetryCron(env, Date.now(), { ping: (t, b) => opsPing(env, t, b, 'high', 'mag') }))())); ctx.waitUntil(watched(env, 'slow-checks', slowCron(env))); ctx.waitUntil(watched(env, 'backup', backupCron(env))); ctx.waitUntil(watched(env, 'morning', morningCron(env, Date.now(), { health: () => healthStatus(env), ping: (t, b, pr, tag) => opsPing(env, t, b, pr, tag) }))); ctx.waitUntil(watched(env, 'minutes', minutesCron(env, Date.now(), { push: (cid, n) => pushClient(env, cid, n), stripe: stripeCall, alert: (type, who, detail) => opsAlert(env, type, who, detail) }))); ctx.waitUntil(watched(env, 'social', socialCron(env, Date.now(), { ping: (t, b, pr, tag, click) => opsPing(env, t, b, pr, tag, click), alert: (type, who, detail) => opsAlert(env, type, who, detail), boardToken: () => boardToken(env) }))); ctx.waitUntil(watched(env, 'photo-posts', photoPostCron(env, Date.now(), { alert: (type, who, detail) => opsAlert(env, type, who, detail) }))); ctx.waitUntil(watched(env, 'our-review-asks', (async () => (await import('./ourreviews.js')).askCron(env, Date.now(), { send: o => sendText(env, { clientId: 'always-open', to: o.to, body: o.body, kind: 'review-ask', tz: o.tz }), mail: (to, subj, text, neon) => (async () => neon ? (await import('./clientmail.js')).sendNeon(env, to, neon) : (await import('./app.js')).mailTo(env, to, subj, text, 'Always Open', { replyTo: 'hello@alwaysopenoffice.com' }))() }))())); ctx.waitUntil(watched(env, 'hear-max', (async () => (await import('./hearmax.js')).hearMaxCron(env, Date.now(), { ping: (t, b, click) => opsPing(env, t, b, 'default', 'microphone', click), alert: (type, who, detail) => opsAlert(env, type, who, detail) }))())); ctx.waitUntil(watched(env, 'demo', demoNightly(env, { ensureBiz, ensureInvoices, ensureRivals, ensureReviews, isoWeek: rivalWeek }))); ctx.waitUntil(healthCron(env).catch(() => {})); if (env.CALLROOM) ctx.waitUntil(watched(env, 'voice', voiceCron(env))); }
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
// Nationwide, by each client's own location (stormdesk.js). The old hand-set Georgia counties still count for HQ-only clients.
async function stormWatch(env) {
  const { stormRun } = await import('./stormdesk.js');
  return stormRun(env, Date.now(), { extra: stormCounties(env), push: s => stormPush(env, s), mail: s => stormMail(env, s) });
}
async function stormPush(env, s) {
  await phonePush(env, { title: s.event + ': ' + (s.businesses || s.counties), priority: 'high', tags: 'cloud_with_lightning_and_rain',
    body: (s.drafted ? 'Nothing to do: ' + s.drafted + (s.drafted === 1 ? ' storm post is' : ' storm posts are') + ' waiting in their app for their OK.' : 'Nothing to do: storm posts get drafted at the next check.') + '\nWhere: ' + s.counties });
}
async function stormMail(env, s) {
  if (!env.EMAIL || !env.MAIL_FROM || !env.MAIL_TO) return 'off';
  const { stormEmail } = await import('./stormdesk.js');
  const m = stormEmail(s);
  const raw = rawEmail({ fromName: 'Always Open Storm Desk', from: env.MAIL_FROM, to: env.MAIL_TO, subject: m.subject }, m.text, m.html);
  try { await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw)); return 'sent'; }
  catch (e) { return 'failed: ' + String((e && e.message) || e).slice(0, 180); }
}
async function stormsList(req, env, url) {
  // the ops key travels in the x-key header like every other ops address, never in the address itself (addresses get logged)
  const key = req.headers.get('x-key') || '';
  if (!env.LEADS_KEY || !(await sameKey(key, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
  try { await env.DB.prepare('CREATE TABLE IF NOT EXISTS storms (id TEXT PRIMARY KEY, at TEXT, event TEXT, grp TEXT, counties TEXT, headline TEXT, ends TEXT, link TEXT, sent TEXT)').run(); } catch (e) {}
  const rows = await env.DB.prepare("SELECT * FROM storms WHERE id NOT LIKE 'sample:%' ORDER BY at DESC LIMIT 30").all();
  return json({ ok: true, storms: (rows && rows.results) || [] }, 200);
}

function withSiteHeaders(res, url) {
  const out = sitePolicy(new Response(res.body, res));
  out.headers.set('x-content-type-options', 'nosniff');
  out.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  out.headers.set('x-frame-options', 'SAMEORIGIN');
  // Our public brand pictures (logo, share and social images) can be read by other sites, so a page editor (like
  // Facebook's, when Claude sets the Page's cover and logo) can draw them. Nothing private lives at these paths.
  if (/^\/(social\/[\w-]+\.(jpg|png)|icon-512\.png|og\d?\.(png|jpg))$/.test(url.pathname)) out.headers.set('access-control-allow-origin', '*');
  // Keep search engines off the temporary workers.dev address; the real domain is indexed.
  if (url.hostname.endsWith('.workers.dev')) out.headers.set('x-robots-tag', 'noindex');
  return out;
}

async function migrate(env) {
  if (migrated) return;
  migrated = true;
  for (const col of ['mail', 'sms_ok', 'ref', 'lang']) {
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
  f.lang = String(form.get('lang') || '') === 'es' ? 'es' : '';
  const es = f.lang === 'es';
  const trap = String(form.get('company_site') || '').trim();
  const now = Date.now();
  const at = new Date(now).toISOString();
  const origin = clean(req.headers.get('origin') || '', 200);
  const ip = req.headers.get('cf-connecting-ip') || '';
  // One sender: an IPv6 home or server owns a whole /64 and can use a new address for every request, so it counts as one
  const v6 = a => { const [h, t] = a.toLowerCase().split('::'); const hg = h ? h.split(':') : [], tg = t !== undefined && t ? t.split(':') : []; return hg.concat(Array(Math.max(0, 8 - hg.length - tg.length)).fill('0'), tg).slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':'); };
  const ipHash = await hash((ip.includes(':') ? v6(ip) + '::/64' : ip) + '|' + (env.IP_SALT || 'salt'));
  const LM = await import('./leadmail.js');
  // The sender's network (a /24), so one network can't send audit emails to a pile of strangers' addresses.
  const netHash = await hash('net:' + LM.netOf(ip) + '|' + (env.IP_SALT || 'salt'));

  // Quiet drops: a bot gets the normal thank-you, so it learns nothing.
  let reason = '', busy = '';
  if (trap) reason = 'trap field filled';
  else if ((f.notes.match(/https?:\/\//g) || []).length > 12) reason = 'links in note';   // a link list; three links is an owner's site, listing and page

  if (!reason) {
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE ip_hash = ?1 AND at > ?2')
      .bind(ipHash, new Date(now - 3600000).toISOString()).first();
    if (recent && recent.n >= PER_HOUR * 2) reason = 'too many from one sender';   // a flood: dropped quietly
    else if (recent && recent.n >= PER_HOUR) busy = 'more than ' + PER_HOUR + ' requests from this internet address in an hour (a shared office or event Wi-Fi, or a bot)';
  }
  // How long the form was open, from the start time we signed when the page loaded (a browser clock only as a fallback).
  // Timing alone never drops a request: no automatic audit email, and it reaches Christopher quietly to look at.
  // Odd but maybe real: held for a look (a quiet push and email, no automatic audit email, an honest page), never lost
  const nl = (f.notes.match(/https?:\/\//g) || []).length;
  let timing = reason ? '' : (busy || (nl > 2 ? 'the note has ' + nl + ' links' : '') || await LM.formTiming(env, String(form.get('t') || ''), now, MIN_FILL_MS, MAX_AGE_MS));
  if (!reason) {
    const problems = [];
    if (!f.name) problems.push('your name');
    if (!LM.validEmail(f.email)) problems.push('a valid email');
    if (problems.length) return es ? reply(wantsJson, 400, false, 'Casi listo', 'Por favor agregue ' + problems.map(x => x === 'your name' ? 'su nombre' : 'un correo electrónico válido').join(' y ') + '.')
      : reply(wantsJson, 400, false, 'Almost there', 'Please add ' + problems.join(' and ') + '.');
  }

  await migrate(env);
  await LM.ensureLeadMail(env);
  const status = reason || timing ? 'spam' : 'new';
  const ins = await env.DB.prepare(
    'INSERT INTO leads (at, name, email, phone, business, town, type, plan, link, notes, origin, ip_hash, status, reason, sms_ok, ref, lang, email_key, net_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)'
  ).bind(at, f.name, f.email, f.phone, f.business, f.town, f.type, f.plan, f.link, f.notes, origin, ipHash, status, reason || (timing ? 'timing only: ' + timing : null), f.sms_ok, f.ref, f.lang, LM.emailKey(f.email), netHash).run();
  const id = ins && ins.meta && ins.meta.last_row_id;
  f.net_hash = netHash;
  // The per-sender cap again, after the row is in: requests sent in the same second all passed the count above
  // together (Nov 10). Rows written before this one are already visible, so this one alone decides about itself.
  if (!reason && id) {
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE ip_hash = ?1 AND at > ?2 AND id < ?3').bind(ipHash, new Date(now - 3600000).toISOString(), id).first().catch(() => null);
    if (before && before.n >= PER_HOUR * 2) {
      reason = 'too many from one sender';
      await env.DB.prepare("UPDATE leads SET status = 'spam', reason = ?1 WHERE id = ?2").bind(reason, id).run().catch(() => {});
    } else if (before && before.n >= PER_HOUR && !timing) {
      timing = 'more than ' + PER_HOUR + ' requests from this internet address in an hour (a shared office or event Wi-Fi, or a bot)';
      await env.DB.prepare("UPDATE leads SET status = 'spam', reason = ?1 WHERE id = ?2").bind('timing only: ' + timing, id).run().catch(() => {});
    }
  }

  if (!reason && f.ref) {
    try {
      const r = await env.DB.prepare('SELECT business FROM app_clients WHERE ref = ?1').bind(f.ref).first();
      f.referredBy = r && r.business ? r.business : 'unknown link (' + f.ref + ')';
    } catch (e) { f.referredBy = 'link ' + f.ref; }
  }
  // Will the audit email go out on its own? Not to an address that asked us to stop, got one in the last 30 days, or
  // past the day's limits; the page then promises only what will happen.
  const hold = reason || timing ? '' : await LM.auditHold(env, f.email, netHash, id, now);
  if (timing) f.quiet = 'Held for a look (' + timing + '): no audit email went out. If it is real, send the audit by hand.';
  else if (hold) f.hold = hold === 'repeat' ? 'this address got an audit in the last 30 days, so no new one was emailed' : hold === 'stopped' ? 'this address asked us not to email it, so no audit was emailed' : 'audit not emailed (' + hold + '); send it by hand';
  if (!reason) {
    ctx.waitUntil(Promise.all([
      push(env, f, id),
      mail(env, f, id, at).then(state => id ? env.DB.prepare('UPDATE leads SET mail = ?1 WHERE id = ?2').bind(state, id).run().catch(() => {}) : null),
      // Speed to lead: their free audit, by email, within a minute (leadmail.js).
      timing ? null : LM.sendAudit(env, f, id, { ping: (t, b, pr) => phonePush(env, { title: t, body: b, priority: pr || 'high', tags: 'mag' }) }).catch(() => {})
    ]));
  }
  const first = (f.name || '').split(/\s+/)[0];
  if (!reason && hold === 'stopped') {   // they asked us to stop: no email, and the page does not promise one (Nov 10)
    if (es) return reply(wantsJson, 200, true, 'Recibido' + (first ? ', ' + first : '') + '.', 'Ese correo nos pidió no escribirle, así que no le mandaremos nada por correo. Si dejó un teléfono, Katie le llama en un día hábil.');
    return reply(wantsJson, 200, true, 'Got it' + (first ? ', ' + first : '') + '.', 'That email address asked us not to email it, so we won’t. If you left a phone number, Katie will call within one business day.');
  }
  if (!reason && (timing || hold)) {
    if (es) return reply(wantsJson, 200, true, 'Recibido' + (first ? ', ' + first : '') + '.', 'Su solicitud nos llegó. Katie le da seguimiento en un día hábil. Ya puede cerrar esta pestaña.');
    return reply(wantsJson, 200, true, 'Got it' + (first ? ', ' + first : '') + '.', 'Your request reached us. Katie follows up within one business day. You can close this tab.');
  }
  if (es) return reply(wantsJson, 200, true, 'Recibido' + (first && !reason ? ', ' + first : '') + '.',
    'Su solicitud nos llegó. Su auditoría gratis ya va camino a su correo, y Katie le da seguimiento en un día hábil. Ya puede cerrar esta pestaña.');
  return reply(wantsJson, 200, true, 'Got it' + (first && !reason ? ', ' + first : '') + '.',
    'Your request reached us. Your free audit is on its way to your inbox now, and Katie follows up within one business day. You can close this tab.');
}

async function push(env, f, id) {
  if (!env.NTFY_URL) return;
  const body = [f.name + (f.business ? ', ' + f.business : ''), [f.phone, f.email].filter(Boolean).join(' · '),
    [f.town, f.type, f.plan].filter(Boolean).join(' · '), f.lang === 'es' ? 'Wrote in Spanish: answer in Spanish' : '', f.referredBy ? 'Referred by: ' + f.referredBy : '', f.notes ? 'Note: ' + f.notes.slice(0, 300) : '', f.quiet || (f.hold ? 'Note: ' + f.hold : '')].filter(Boolean).join('\n');
  await phonePush(env, { title: (f.quiet ? 'Always Open lead to check: ' : 'Always Open lead: ') + (f.business || f.name), priority: f.quiet ? 'low' : 'high', tags: 'telephone_receiver', body: 'Do this: ' + leadStep(f) + '\n' + body });   // the email and the daily check still catch it
}

// What to do about a website lead, in one line.
function leadStep(f) {
  const first = String(f.name || '').split(/\s+/)[0] || 'them';
  if (f.quiet) return 'Look it over. If it\'s a real business, send the free audit by hand and call ' + first + '.';
  if (/asked us not to email/.test(f.hold || '')) return f.phone ? 'Call ' + first + ' at ' + f.phone + '. Do not email: that address asked us to stop.' : 'Nothing to send: that address asked us to stop, and there is no phone number.';
  if (/in the last 30 days/.test(f.hold || '')) return 'Call ' + first + (f.phone ? ' at ' + f.phone : '') + '. They already got an audit this month.';
  if (f.hold) return 'Send the free audit by hand, then call ' + first + (f.phone ? ' at ' + f.phone : '') + '.';
  return 'Call ' + first + (f.phone ? ' at ' + f.phone : '') + ' today. Their free audit already went to their inbox.';
}
export function leadEmail(f, id, at) {
  const lines = [
    { k: 'Business', v: f.business || '(not given)' }, { k: 'Phone', v: f.phone || '(not given)' }, { k: 'Email', v: f.email || '(not given)' },
    { k: 'Town', v: f.town || '' }, { k: 'Type', v: f.type || '' }, { k: 'Plan', v: f.plan || 'Not sure yet' }
  ].filter(l => l.v);
  if (f.lang === 'es') lines.push({ k: 'Language', v: 'Spanish: answer in Spanish', bad: true });
  if (f.referredBy) lines.push({ k: 'Referred by', v: f.referredBy, ok: true });
  if (f.notes) lines.push({ k: 'Their note', v: Array.from(String(f.notes).replace(/\s+/g, ' ')).slice(0, 220).join('') });   // whole characters, never half an emoji
  if (f.quiet || f.hold) lines.push({ k: 'Audit email', v: f.quiet || f.hold, bad: true });
  else lines.push({ k: 'Audit email', v: 'sent automatically', ok: true });
  return { tone: f.quiet ? 'bad' : 'info', sign: 'NEW LEAD', title: (f.name || 'Someone') + (f.business ? ' from ' + f.business : '') + ' asked for the free audit', who: 'website',
    doThis: [leadStep(f)], lines, note: 'Reply to this email to answer them directly. It is also on Always Open HQ, under Requests.', preheader: leadStep(f) };
}

async function mail(env, f, id, at) {
  if (!env.EMAIL || !env.MAIL_FROM || !env.MAIL_TO) return 'off';
  const subject = (f.quiet ? 'Always Open website lead (held for a look): ' : 'Always Open website lead: ') + Array.from(oneLine(f.business || f.name)).slice(0, 120).join('');
  const text = [
    'New request from the Always Open website.', '',
    ...(f.quiet ? [f.quiet, ''] : f.hold ? ['Audit email: ' + f.hold + '.', ''] : []),
    'Lead ID: ' + (id || '?'), 'Name: ' + f.name, 'Business: ' + f.business, 'Phone: ' + f.phone, 'Email: ' + f.email,
    'Town: ' + f.town, 'Type: ' + f.type, 'Plan: ' + f.plan, 'Language: ' + (f.lang === 'es' ? 'Spanish (they used the Spanish page; answer in Spanish, and their Max line starts in Spanish)' : 'English'), 'Link: ' + f.link, 'Notes: ' + f.notes.replace(/\r?\n/g, ' '), 'OK to text: ' + f.sms_ok, 'Referred by: ' + (f.referredBy || 'none'),
    'Sent at: ' + at, '',
    'Reply to this email to answer them directly. It is also on Always Open HQ, under Requests, right away.'
  ].join('\r\n');
  // The plain part stays exactly as it was: the Always Open check reads "Lead ID:", "Name:" lines out of it.
  // The HTML part is the neon page: who it is, the one thing to do, the details in short rows.
  // a cut that lands inside an emoji leaves half of it, which the encoder refuses: whole characters only (Nov 10)
  for (const k of Object.keys(f)) if (typeof f[k] === 'string') f[k] = f[k].replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  const e = neonEmail(leadEmail(f, id, at));
  const raw = rawEmail({ fromName: 'Always Open website', from: env.MAIL_FROM, to: env.MAIL_TO, subject, replyTo: EMAIL_RE.test(f.email) ? f.email : '' }, text, e.html);
  try {
    await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw));
    return 'sent';
  } catch (e) {
    return 'failed: ' + String((e && e.message) || e).slice(0, 180);
  }
}

async function leadsList(req, env, url) {
  // the ops key travels in the x-key header like every other ops address, never in the address itself (addresses get logged)
  const key = req.headers.get('x-key') || '';
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
  // cut by whole characters: a cut inside an emoji left half of it, and the email to Christopher could not be built (Nov 10)
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max).replace(/[\uD800-\uDBFF]$/, '');
}
function oneLine(s) { return String(s || '').replace(/[\r\n\t]+/g, ' ').trim(); }
function ascii(s) { return s.replace(/[^\x20-\x7E]/g, '').slice(0, 120); }
// A phone push to Christopher: straight to ntfy, or queued for the Mac relay (push.js). Never throws.
async function phonePush(env, p) { try { return await (await import('./push.js')).push(env, p); } catch (e) { return 'off'; } }
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
  if (wantsJson) return json(ok ? { ok: true, title, message: text } : { ok: false, error: text }, status);
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
// Every Monday: for each insurance client's own town (anywhere in the U.S.) and then each town in RADAR_TOWNS, look up
// insurance agencies on Google (Places API, New) and count recent reviews, recent low ratings and recent unhappy reviews
// about rates. Emails COUNTS ONLY and keeps nothing: Google's terms don't allow storing Places content, so there is no
// week-to-week table. No agency names, no reviewer names, no review text. Scoring and town handling: radar.js.
const RADAR_CRON = '17 12 * * 1';
const RADAR_FIELDS = 'places.id,places.rating,places.userRatingCount,places.reviews,nextPageToken';
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + '-W' + String(Math.ceil(((t - y) / 86400000 + 1) / 7)).padStart(2, '0');
}
// One page of up to 20 agencies (Google gives up to 3 pages, 60 agencies, for a town).
async function radarPage(env, town, token) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.PLACES_KEY, 'X-Goog-FieldMask': RADAR_FIELDS },
    body: JSON.stringify(Object.assign({ textQuery: 'insurance agency in ' + town, includedType: 'insurance_agency', strictTypeFiltering: true, pageSize: 20 }, token ? { pageToken: token } : {}))
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); try { await (await import('./funding.js')).googleProblem(env, r.status, t); } catch (e) {} throw new Error('Places ' + r.status); }
  const j = (await r.json()) || {};
  return { places: j.places || [], next: j.nextPageToken || '' };
}
// The weekly Google lookups for the radar. Each is one paid call, so there is a budget (RADAR_MAX_CALLS, default 60: about 260 a
// month, inside Google's monthly free amount for this kind of lookup). Every town gets its first page; what is left reads
// more agencies in clients' towns first.
export async function radarScan(env, now, h) {
  h = h || {};
  const page = h.page || ((town, token) => radarPage(env, town, token));
  const { planTowns, scoreTown } = await import('./radar.js');
  let own = [];
  try { own = (((await env.DB.prepare("SELECT DISTINCT COALESCE(NULLIF(b.town, ''), v.town) AS town FROM app_clients c LEFT JOIN billing b ON b.client_id = c.client_id LEFT JOIN voice_lines v ON v.client_id = c.client_id WHERE c.active = 1 AND c.client_id NOT IN ('demo-plumbing', 'always-open') AND (v.industry = 'insurance' OR b.type = 'Insurance agency')").all()).results) || []).map(r => r.town); } catch (e) { own = []; }
  const week = isoWeek(new Date(now)), budget = Math.min(500, Math.max(5, +env.RADAR_MAX_CALLS || 60));
  const plan = planTowns(own, String(env.RADAR_TOWNS || '').split('|'), budget, +week.slice(-2));
  let calls = 0;
  const got = [];
  for (const t of plan.towns) {
    try { calls++; const p = await page(t.town, ''); got.push(Object.assign({ places: p.places, next: p.next, pages: 1 }, t)); }
    catch (e) { got.push(Object.assign({ error: String((e && e.message) || e).slice(0, 120) }, t)); }
  }
  // Leftover budget: up to two more pages per town, clients' towns first (they come first in the plan).
  for (let round = 0; round < 2; round++) for (const g of got) {
    if (calls >= budget) break;
    if (g.error || !g.next || g.pages > round + 1) continue;
    try { calls++; const p = await page(g.town, g.next); g.places = g.places.concat(p.places); g.next = p.next; g.pages++; } catch (e) { g.next = ''; }
  }
  const out = got.map(g => g.error ? { town: g.town, week, client: g.client, error: g.error } : Object.assign({ town: g.town, week, client: g.client, pages: g.pages }, scoreTown(g.places, now)));
  return { week, out, calls, skipped: plan.skipped };
}
async function radarWatch(env) {
  if (!env.PLACES_KEY) return { ok: false, error: 'no key' };
  const now = Date.now();
  const { week, out, calls, skipped } = await radarScan(env, now);
  if (!out.length) return { ok: false, error: 'no towns' };
  await radarMail(env, week, out.filter(x => !x.error), out.filter(x => x.error), skipped);
  // Each insurance client whose own town shows a wave hears it on their phone the same morning (counts only, nothing from
  // Google kept), and finds a short post about what moves rates waiting in their app for an OK.
  try {
    const mine = ((await env.DB.prepare("SELECT DISTINCT c.client_id AS cid, c.regulated AS regulated, COALESCE(NULLIF(b.town, ''), v.town) AS town FROM app_clients c LEFT JOIN billing b ON b.client_id = c.client_id LEFT JOIN voice_lines v ON v.client_id = c.client_id WHERE c.active = 1 AND c.client_id NOT IN ('demo-plumbing', 'always-open') AND (v.industry = 'insurance' OR b.type = 'Insurance agency')").all()).results) || [];
    for (const n of radarNotes(mine, out)) {
      await pushClient(env, n.cid, n.note).catch(() => 0);
      await radarPost(env, n.cid, n.town, week, now).catch(() => 0);
    }
    // Each client's own town, wave or calm, counts only, for the app's Rate-Shock Radar card.
    const { noteSeen } = await import('./radar.js');
    for (const c of mine) { const k = townKey(c.town), t = k && out.find(x => !x.error && townKey(x.town) === k); if (t) await noteSeen(env, c.cid, week, t, new Date(now).toISOString()).catch(() => 0); }
  } catch (e) { /* the email above still went out */ }
  const waves = out.filter(x => x.wave);
  if (waves.length) await phonePush(env, { title: 'Rates rising in ' + waves.length + (waves.length === 1 ? ' town' : ' towns'), priority: 'default', tags: 'chart_with_upwards_trend', body: waves.map(x => x.town + ': ' + (x.why === 'low' ? x.low + ' low-star reviews' : x.rate + ' unhappy reviews about rates')).join('\n') + '\nDo: tell the agents there to call their renewals this week.' });
  return { ok: true, week, calls, skipped, towns: out.filter(x => !x.error) };
}
// The post that waits in an insurance client's app the Monday their town shows a wave. Educational: no numbers, no
// quotes, no promises, nothing about other agencies. One per client per week.
export const RADAR_POST = { title: 'What moves insurance rates', text: 'Insurance rates can change at renewal for reasons like the cost of repairs and rebuilding, weather in the area, and changes to your home, car or drivers. If your renewal looks different than you expected, call our office before it renews. We are glad to walk through it with you.' };
async function radarPost(env, cid, town, week, now) {
  const at = new Date(now).toISOString();
  await env.DB.prepare("INSERT OR IGNORE INTO app_items (id, client_id, kind, title, context, stars, text, status, hq_synced, checked, photo, created, updated, notified) VALUES (?1, ?2, 'post', ?3, ?4, 0, ?5, 'pending', 1, 1, '', ?6, ?6, 0)")
    .bind('radar:' + cid + ':' + week, cid, RADAR_POST.title, 'Rate-Shock Radar: rate complaints rising in ' + town, RADAR_POST.text, at).run();
}
// Which insurance clients get a Rate-Shock push: those whose own town had a wave this week. Pure, so it can be tested.
export function radarNotes(clients, towns) {
  const waves = new Map((towns || []).filter(x => x && x.wave).map(x => [townKey(x.town), x]));
  const out = [];
  for (const c of clients || []) {
    const k = townKey(c && c.town), w = k && waves.get(k);
    if (!w) continue;
    const byRate = w.why ? w.why === 'rate' : w.rate >= 2;
    const body = byRate ? 'Do this: call your renewals this week, before they shop. ' + w.rate + ' recent reviews of agencies in ' + w.town + ' complain about rate increases. A short post about what moves rates is ready for your OK.'
      : 'Do this: check in with your renewals this week. ' + w.low + ' low-star reviews of agencies in ' + w.town + ' in the last 30 days. A short post about what moves rates is ready for your OK.';
    out.push({ cid: c.cid, town: w.town, note: { aps: { alert: { title: 'Rates rising in ' + w.town, body }, 'thread-id': 'radar' }, screen: 'home' } });
  }
  return out;
}
// The weekly radar email to Christopher: one neon page, the towns with a wave first, counts only. Pure, so it can be tested.
export function radarEmail(week, towns, errors, skipped) {
  towns = towns || []; errors = errors || [];
  const waves = towns.filter(x => x.wave).sort((a, b) => b.rate - a.rate || b.low - a.low);
  const calm = towns.filter(x => !x.wave);
  const rateSum = towns.reduce((a, x) => a + (+x.rate || 0), 0), lowSum = towns.reduce((a, x) => a + (+x.low || 0), 0);
  const lines = waves.map(x => ({ k: x.town, v: x.rate + ' unhappy about rates, ' + x.low + ' at 1-2 stars (' + x.recent + ' recent reviews' + (x.places ? ', ' + x.places + ' agencies' : '') + ')', bad: true }))
    .concat(calm.slice(0, Math.max(0, 8 - waves.length)).map(x => ({ k: x.town, v: 'quiet: ' + x.rate + ' about rates, ' + x.recent + ' recent reviews', ok: true })));
  if (calm.length > 8 - waves.length && 8 - waves.length >= 0) lines.push({ v: (calm.length - Math.max(0, 8 - waves.length)) + ' more quiet towns' });
  if (errors.length) lines.push({ k: 'Not checked', v: errors.map(e => e.town).join(', '), bad: true });
  if (+skipped > 0) lines.push({ k: 'Waiting a week', v: skipped + (skipped === 1 ? ' town' : ' towns') + ' over this week\u2019s lookup budget (RADAR_MAX_CALLS). The list rotates, so they come first in a later week.' });
  const n = neonEmail({
    tone: waves.length ? 'bad' : 'ok', sign: waves.length ? 'RATES RISING' : 'ALL QUIET', who: 'Rate-Shock Radar · ' + week,
    title: waves.length ? 'Complaints about rates are up in ' + (waves.length === 1 ? waves[0].town : waves.length + ' towns') + '.' : 'No town shows a wave of rate complaints this week.',
    doThis: waves.length ? ['Insurance clients in ' + waves.map(x => x.town).join(', ') + ' got a push this morning. Use it in outreach: agents there should call their renewals this week.'] : [],
    stats: [{ n: String(towns.length), label: 'towns checked' }, { n: String(waves.length), label: waves.length === 1 ? 'wave' : 'waves', tone: waves.length ? 'bad' : '' }, { n: String(rateSum), label: 'reviews about rates', tone: rateSum ? 'bad' : '' }, { n: String(lowSum), label: '1-2 star reviews' }],
    linesTitle: 'Town by town (last 30 days)', lines,
    note: 'Counts only, from Google Maps, looked up for this email and not kept. No agency names, reviewer names or review text, and no week-to-week history.'
  });
  return { subject: waves.length ? 'Rates rising: ' + waves.map(x => x.town).slice(0, 3).join(', ') : 'Rate-Shock Radar: all quiet (' + week + ')', html: n.html, text: n.text };
}
async function radarMail(env, week, towns, errors, skipped) {
  if (!env.EMAIL || !env.MAIL_FROM || !env.MAIL_TO || !(towns.length || errors.length)) return;
  const m = radarEmail(week, towns, errors, skipped);
  const raw = rawEmail({ fromName: 'Always Open Radar', from: env.MAIL_FROM, to: env.MAIL_TO, subject: m.subject }, m.text, m.html);
  try { await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw)); } catch (e) {}
}
async function radarRun(req, env, url) {
  // the ops key travels in the x-key header like every other ops address, never in the address itself (addresses get logged)
  const key = req.headers.get('x-key') || '';
  if (!env.LEADS_KEY || !(await sameKey(key, env.LEADS_KEY))) return json({ ok: false, error: 'not allowed' }, 403);
  return json(await radarWatch(env), 200);
}

// New signups, failed payments and cancellations: a phone push and an email to Chris.
async function billingNotify(env, ctx, title, body, priority) {
  const jobs = [];
  jobs.push(phonePush(env, { title, priority: priority || 'default', tags: 'moneybag', body: String(body || '').slice(0, 2000) }));
  if (env.EMAIL && env.MAIL_FROM && env.MAIL_TO) {
    const domain = env.MAIL_FROM.split('@')[1] || 'localhost';
    const raw = ['From: "Always Open billing" <' + env.MAIL_FROM + '>', 'To: <' + env.MAIL_TO + '>', 'Subject: ' + encodeHeader(oneLine(title).slice(0, 140)),
      'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>', 'Date: ' + new Date().toUTCString(), 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit'].join('\r\n') + '\r\n\r\n' + body;
    jobs.push(env.EMAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw)).catch(() => {}));
  }
  await Promise.all(jobs);
}
