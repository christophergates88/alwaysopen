// Texting registration (A2P 10DLC) for each client, built into signup. Carriers require every business that texts to be
// registered as its own brand with its own campaign; Always Open's registration (Lake Country Foam Party, LLC, an approved
// ISV reseller profile) only speaks for Always Open. The owner fills one form; a cron walks Twilio's steps, waiting for each
// review, and when the campaign is approved the client's number is added to its own Messaging Service and texting turns on
// for that business (sms.js only sends through an approved per-client service).
// The EIN is passed to Twilio and wiped from our database as soon as the profile is created. Never logged.
// Steps follow https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api
const SITE = 'https://alwaysopenoffice.com';
const TH = 'https://trusthub.twilio.com/v1/';
const MSG = 'https://messaging.twilio.com/v1/';
const SECONDARY_POLICY = 'RNdfbf3fae0e1107f8aded0e7cead80bf5';
const A2P_POLICY = 'RNb0d4771c2c98518d916a3d4cd70a8f8b';
export const BUSINESS_TYPES = ['Limited Liability Corporation', 'Corporation', 'Partnership', 'Sole Proprietorship', 'Co-operative', 'Non-profit Corporation'];
export const INDUSTRIES = { CONSTRUCTION: 'Home services and construction', AUTOMOTIVE: 'Auto repair and automotive', HEALTHCARE: 'Health and dental', INSURANCE: 'Insurance', FOOD_AND_BEVERAGE: 'Food and drink', RETAIL: 'Retail', REAL_ESTATE: 'Real estate', PROFESSIONAL_SERVICES: 'Professional services', HOSPITALITY: 'Hospitality and events', TRANSPORTATION: 'Transportation', LEGAL: 'Legal', CONSUMER: 'Other consumer services' };
export const POSITIONS = ['CEO', 'GM', 'Director', 'VP', 'CFO', 'General Counsel', 'Other'];
const pushClient = async (...a) => { try { return await (await import('./app.js')).pushClient(...a); } catch (e) { return 0; } };
const opsPing = async (...a) => { try { return await (await import('./app.js')).opsPing(...a); } catch (e) { return 0; } };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cl = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const now = () => new Date().toISOString();

let ready = false;
export async function ensureA2p(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS a2p_reg (client_id TEXT PRIMARY KEY, status TEXT DEFAULT 'none', step TEXT DEFAULT '', form TEXT DEFAULT '{}', sids TEXT DEFAULT '{}', error TEXT DEFAULT '', tries INTEGER DEFAULT 0, created TEXT, updated TEXT)").run();
  ready = true;
}

export function industryFor(kind) {
  const k = String(kind || '').toLowerCase();
  if (/auto|mechanic|tire/.test(k)) return 'AUTOMOTIVE';
  if (/dent|medic|clinic|chiro|vet|therap|doctor|health/.test(k)) return 'HEALTHCARE';
  if (/insur/.test(k)) return 'INSURANCE';
  if (/restaur|cafe|food|bakery|catering|bar\b|pizza/.test(k)) return 'FOOD_AND_BEVERAGE';
  if (/real ?estate|realtor|property/.test(k)) return 'REAL_ESTATE';
  if (/event|party|wedding|venue|rental/.test(k)) return 'HOSPITALITY';
  if (/plumb|hvac|heat|air|roof|electr|build|remodel|contract|lawn|landscap|pest|pool|paint|clean|septic|tree|garage|handy|dock|marin|fence|concrete|pressure|gutter|floor/.test(k)) return 'CONSTRUCTION';
  return 'PROFESSIONAL_SERVICES';
}

// Validates the owner's form. Returns { ok, form } or { ok:false, error }.
export function checkForm(b) {
  const f = {
    legal: cl(b.legal, 120), btype: cl(b.btype, 40), noEin: b.noEin === true || b.noEin === 'on' || b.noEin === '1',
    ein: String(b.ein || '').replace(/\D/g, ''), industry: cl(b.industry, 40), website: cl(b.website, 200),
    street: cl(b.street, 120), city: cl(b.city, 60), state: cl(b.state, 2).toUpperCase(), zip: String(b.zip || '').replace(/[^\d-]/g, '').slice(0, 10),
    first: cl(b.first, 40), last: cl(b.last, 40), title: cl(b.title, 60), position: cl(b.position, 30), email: cl(b.email, 120).toLowerCase(),
    phone: String(b.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''), agree: b.agree === true || b.agree === 'on' || b.agree === '1'
  };
  if (!f.agree) return { ok: false, error: 'Check the box at the bottom to confirm you can register this business.' };
  if (f.legal.length < 2) return { ok: false, error: 'Add the legal business name, exactly as the IRS has it.' };
  if (!BUSINESS_TYPES.includes(f.btype)) return { ok: false, error: 'Pick the kind of business entity.' };
  if (!f.noEin && !/^\d{9}$/.test(f.ein)) return { ok: false, error: 'The EIN is nine digits, like 12-3456789.' };
  if (!INDUSTRIES[f.industry]) return { ok: false, error: 'Pick the closest industry.' };
  if (!/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(f.website)) return { ok: false, error: 'Add your website or your Google Business link, starting with https://' };
  if (!f.street || !f.city || !/^[A-Z]{2}$/.test(f.state) || !/^\d{5}(-\d{4})?$/.test(f.zip)) return { ok: false, error: 'Add the full business address: street, city, two-letter state and ZIP.' };
  if (!f.first || !f.last || !f.title) return { ok: false, error: 'Add the name and title of the person registering.' };
  if (!POSITIONS.includes(f.position)) return { ok: false, error: 'Pick the closest job position.' };
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(f.email)) return { ok: false, error: 'That email does not look right.' };
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(f.phone)) return { ok: false, error: 'Add a 10-digit cell number for the person registering.' };
  delete f.agree;
  return { ok: true, form: f };
}

// ---------------- Twilio calls ----------------
function form(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) v.forEach(x => p.append(k, String(x)));
    else p.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return p.toString();
}
async function tw(env, method, url, params, extraHeaders) {
  const r = await fetch(url, { method, headers: Object.assign({ Authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN), 'content-type': 'application/x-www-form-urlencoded' }, extraHeaders || {}), body: method === 'GET' ? undefined : form(params || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(String(j.message || ('Twilio answered ' + r.status)).slice(0, 300)); e.status = r.status; e.code = j.code; throw e; }
  return j;
}
const assign = (env, base, sid, obj) => tw(env, 'POST', TH + base + '/' + sid + '/EntityAssignments', { ObjectSid: obj });

// ---------------- the steps ----------------
async function stepProfile(env, row, f, sids) {
  const biz = f.legal;
  if (!sids.profile) sids.profile = (await tw(env, 'POST', TH + 'CustomerProfiles', { FriendlyName: biz + ' (Always Open client)', Email: env.MAIL_TO, PolicySid: SECONDARY_POLICY })).sid;
  if (!sids.bizEU) {
    sids.bizEU = (await tw(env, 'POST', TH + 'EndUsers', { Type: 'customer_profile_business_information', FriendlyName: biz + ' business information', Attributes: {
      business_name: biz, website_url: f.website, business_regions_of_operation: 'USA_AND_CANADA', business_type: f.btype,
      business_registration_identifier: 'EIN', business_identity: 'direct_customer', business_industry: f.industry, business_registration_number: f.ein } })).sid;
    await assign(env, 'CustomerProfiles', sids.profile, sids.bizEU);
  }
  if (!sids.repEU) {
    sids.repEU = (await tw(env, 'POST', TH + 'EndUsers', { Type: 'authorized_representative_1', FriendlyName: biz + ' authorized representative', Attributes: {
      first_name: f.first, last_name: f.last, business_title: f.title, job_position: f.position, email: f.email, phone_number: '+1' + f.phone } })).sid;
    await assign(env, 'CustomerProfiles', sids.profile, sids.repEU);
  }
  if (!sids.address) sids.address = (await tw(env, 'POST', 'https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/Addresses.json', { CustomerName: biz, Street: f.street, City: f.city, Region: f.state, PostalCode: f.zip, IsoCountry: 'US', FriendlyName: biz })).sid;
  if (!sids.doc) {
    sids.doc = (await tw(env, 'POST', TH + 'SupportingDocuments', { Type: 'customer_profile_address', FriendlyName: biz + ' address', Attributes: { address_sids: sids.address } })).sid;
    await assign(env, 'CustomerProfiles', sids.profile, sids.doc);
  }
  if (!sids.primaryAssigned) { await assign(env, 'CustomerProfiles', sids.profile, env.TWILIO_PRIMARY_PROFILE_SID); sids.primaryAssigned = 1; }
  const ev = await tw(env, 'POST', TH + 'CustomerProfiles/' + sids.profile + '/Evaluations', { PolicySid: SECONDARY_POLICY });
  if (ev.status !== 'compliant') return { fix: evalWhy(ev) };
  await tw(env, 'POST', TH + 'CustomerProfiles/' + sids.profile, { Status: 'pending-review' });
  return { next: 'wait_profile', wipeEin: true };
}
function evalWhy(ev) {
  const bad = [];
  for (const r of (ev.results || [])) for (const f of (r.fields || [])) if (f.passed === false) bad.push((f.friendly_name || f.object_field || 'a field') + (f.failure_reason ? ': ' + f.failure_reason : ''));
  return bad.length ? 'Twilio flagged: ' + bad.slice(0, 4).join('; ') : 'Twilio did not accept the details.';
}
async function stepWaitProfile(env, row, f, sids) {
  const p = await tw(env, 'GET', TH + 'CustomerProfiles/' + sids.profile);
  if (p.status === 'twilio-approved') return { next: 'trust' };
  if (p.status === 'twilio-rejected') return { fix: 'The business details were turned down. Check the legal name and EIN match your IRS letter exactly, then send the form again.' };
  return { wait: true };
}
async function stepTrust(env, row, f, sids) {
  const biz = f.legal;
  if (!sids.trust) sids.trust = (await tw(env, 'POST', TH + 'TrustProducts', { FriendlyName: biz + ' A2P', Email: env.MAIL_TO, PolicySid: A2P_POLICY })).sid;
  if (!sids.a2pEU) {
    sids.a2pEU = (await tw(env, 'POST', TH + 'EndUsers', { Type: 'us_a2p_messaging_profile_information', FriendlyName: biz + ' messaging profile', Attributes: { company_type: f.btype === 'Non-profit Corporation' ? 'non-profit' : 'private' } })).sid;
    await assign(env, 'TrustProducts', sids.trust, sids.a2pEU);
    await assign(env, 'TrustProducts', sids.trust, sids.profile);
  }
  const ev = await tw(env, 'POST', TH + 'TrustProducts/' + sids.trust + '/Evaluations', { PolicySid: A2P_POLICY });
  if (ev.status !== 'compliant') return { fix: evalWhy(ev) };
  await tw(env, 'POST', TH + 'TrustProducts/' + sids.trust, { Status: 'pending-review' });
  return { next: 'brand' };
}
async function stepBrand(env, row, f, sids) {
  // Low-Volume Standard: fewer than 6,000 message segments a day, which fits a small business and costs less to vet.
  if (!sids.brand) sids.brand = (await tw(env, 'POST', MSG + 'a2p/BrandRegistrations', { CustomerProfileBundleSid: sids.profile, A2PProfileBundleSid: sids.trust, SkipAutomaticSecVet: 'true' })).sid;
  return { next: 'wait_brand' };
}
async function stepWaitBrand(env, row, f, sids) {
  const b = await tw(env, 'GET', MSG + 'a2p/BrandRegistrations/' + sids.brand);
  if (b.status === 'APPROVED') return { next: 'campaign' };
  if (b.status === 'FAILED') return { fix: 'The brand was turned down' + (b.failure_reason ? ': ' + String(b.failure_reason).slice(0, 200) : '.') + ' Check the details and send the form again.' };
  return { wait: true };
}
export function campaignText(biz, ref) {
  const page = ref ? SITE + '/q/' + encodeURIComponent(ref) : SITE;
  return {
    Description: biz + ' sends text messages to its own customers: replies to customers who texted or called, one text back after a missed call, appointment and invoice reminders, a request for a review after a job, and occasional notes to past customers who agreed to hear from the business. Messages are sent through Always Open, the business’s answering and messaging service.',
    MessageFlow: 'Customers opt in in one of these ways: they text the business’s number first; they call the business and, after a missed call, get one text back that names the business and says how to stop; or they check a box agreeing to texts on the business’s request form at ' + page + ', or tell the business they agree when it records a job. Every first message names the business and says Reply STOP to end texts. HELP returns the business name and how to stop. Privacy policy: ' + SITE + '/privacy. Terms: ' + SITE + '/terms.',
    MessageSamples: [
      'Sorry we missed you. This is ' + biz + '. Reply here with what you need, or call back any time. Reply STOP to end texts.',
      'Hi Linda, this is ' + biz + '. A reminder that invoice 1042 for $240 is due Friday. Pay here: ' + SITE + '/i/example Reply STOP to end texts.',
      'Thanks for letting ' + biz + ' help today. If you have a minute, a quick Google review means a lot: https://g.page/r/example Reply STOP to end texts.'
    ]
  };
}
async function stepCampaign(env, row, f, sids, ctx) {
  const biz = f.legal;
  if (!sids.mg) sids.mg = (await tw(env, 'POST', MSG + 'Services', { FriendlyName: biz + ' (Always Open texting)', InboundRequestUrl: SITE + '/voice/sms/' + env.VOICE_KEY, InboundMethod: 'POST', UseInboundWebhookOnNumber: 'false' })).sid;
  if (!sids.campaign) {
    let usecase = 'LOW_VOLUME';
    try { const u = await tw(env, 'GET', MSG + 'Services/' + sids.mg + '/Compliance/Usa2p/Usecases?BrandRegistrationSid=' + sids.brand); const codes = (u.us_app_to_person_usecases || []).map(x => x.code); if (!codes.includes('LOW_VOLUME')) usecase = codes.includes('MIXED') ? 'MIXED' : (codes[0] || 'MIXED'); } catch (e) {}
    const t = campaignText(biz, ctx && ctx.ref);
    const c = await tw(env, 'POST', MSG + 'Services/' + sids.mg + '/Compliance/Usa2p', Object.assign({ BrandRegistrationSid: sids.brand, UsAppToPersonUsecase: usecase, HasEmbeddedLinks: 'true', HasEmbeddedPhone: 'false', PrivacyPolicyUrl: SITE + '/privacy', TermsAndConditionsUrl: SITE + '/terms' }, t), { 'X-Twilio-Api-Version': 'v1.2' });
    sids.campaign = c.sid || 'created';
  }
  return { next: 'wait_campaign' };
}
async function stepWaitCampaign(env, row, f, sids) {
  const l = await tw(env, 'GET', MSG + 'Services/' + sids.mg + '/Compliance/Usa2p');
  const c = (l.compliance || [])[0] || {};
  const st = String(c.campaign_status || '').toUpperCase();
  if (st === 'VERIFIED') return { next: 'number' };
  if (st === 'FAILED') return { fix: 'The texting campaign was turned down' + (c.errors && c.errors.length ? ': ' + String((c.errors[0] && (c.errors[0].description || c.errors[0].message)) || '').slice(0, 200) : '.') + ' We will look at it with you.' };
  return { wait: true };
}
async function stepNumber(env, row, f, sids) {
  const line = await env.DB.prepare('SELECT number FROM voice_lines WHERE client_id = ?1 AND on_air = 1 ORDER BY updated DESC LIMIT 1').bind(row.client_id).first();
  if (!line) return { wait: true };   // the Max line isn't set up yet; finish when it is
  const l = await tw(env, 'GET', 'https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/IncomingPhoneNumbers.json?PhoneNumber=' + encodeURIComponent(line.number));
  const pn = (l.incoming_phone_numbers || [])[0];
  if (!pn) return { fix: 'The business number is not in our Twilio account yet.' };
  try { await tw(env, 'POST', MSG + 'Services/' + sids.mg + '/PhoneNumbers', { PhoneNumberSid: pn.sid }); } catch (e) { if (!/already/i.test(e.message) && e.code !== 21712) throw e; }
  await tw(env, 'POST', 'https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/IncomingPhoneNumbers/' + pn.sid + '.json', { SmsUrl: SITE + '/voice/sms/' + env.VOICE_KEY, SmsMethod: 'POST' }).catch(() => {});
  const { setBrand } = await import('./sms.js');
  await setBrand(env, row.client_id, sids.mg, 'approved');
  return { done: true };
}
const STEPS = { profile: stepProfile, wait_profile: stepWaitProfile, trust: stepTrust, brand: stepBrand, wait_brand: stepWaitBrand, campaign: stepCampaign, wait_campaign: stepWaitCampaign, number: stepNumber };
const LABELS = { none: 'Not started', needs_help: 'We’ll register it with you', submitted: 'Sent, starting', in_review: 'Carriers are reviewing it', approved: 'Approved. Texting is on.', needs_fix: 'Needs a fix', failed: 'We’re looking at it' };

// Advance one client by one step. Returns the new status.
export async function advance(env, cid) {
  await ensureA2p(env);
  const row = await env.DB.prepare('SELECT * FROM a2p_reg WHERE client_id = ?1').bind(cid).first();
  if (!row || !STEPS[row.step]) return row && row.status;
  let f = {}, sids = {}; try { f = JSON.parse(row.form || '{}'); sids = JSON.parse(row.sids || '{}'); } catch (e) {}
  const c = await env.DB.prepare('SELECT business, ref FROM app_clients WHERE client_id = ?1').bind(cid).first().catch(() => null);
  const save = (status, step, error, form2) => env.DB.prepare('UPDATE a2p_reg SET status = ?1, step = ?2, sids = ?3, error = ?4, form = ?5, tries = ?6, updated = ?7 WHERE client_id = ?8')
    .bind(status, step, JSON.stringify(sids), error || '', JSON.stringify(form2 || f), status === row.status && step === row.step ? (+row.tries || 0) + 1 : 0, now(), cid).run();
  let r;
  try { r = await STEPS[row.step](env, row, f, sids, { ref: c && c.ref }); }
  catch (e) {
    await save(row.status, row.step, '', f);   // keep any SIDs created before the error
    if ((+row.tries || 0) >= 5 || (e.status && e.status < 500 && e.status !== 429)) {
      await env.DB.prepare("UPDATE a2p_reg SET status = 'failed', error = ?1 WHERE client_id = ?2").bind(String(e.message || e).slice(0, 300), cid).run();
      await opsPing(env, 'Texting registration stuck: ' + ((c && c.business) || cid), 'Step ' + row.step + ': ' + String(e.message || e).slice(0, 300), 'high', 'warning');
      return 'failed';
    }
    return row.status;
  }
  if (r.wipeEin) f = Object.assign({}, f, { ein: '' });
  if (r.fix) {
    await save('needs_fix', '', r.fix, Object.assign({}, f, { ein: '' }));
    await pushClient(env, cid, { aps: { alert: { title: 'Texting registration needs a fix', body: r.fix.slice(0, 200) }, sound: 'default' }, screen: 'home' });
    await opsPing(env, 'Texting registration needs a fix: ' + ((c && c.business) || cid), r.fix, 'default', 'warning');
    return 'needs_fix';
  }
  if (r.done) {
    await save('approved', 'done', '', f);
    await pushClient(env, cid, { aps: { alert: { title: 'Texting is on', body: 'Carriers approved texting for your business. Missed-call text-back and reminders go out from your Always Open number now.' }, sound: 'default' }, screen: 'home' });
    await opsPing(env, 'Texting approved: ' + ((c && c.business) || cid), 'Their number is in its own Messaging Service.', 'default', 'white_check_mark');
    return 'approved';
  }
  if (r.wait) { await env.DB.prepare('UPDATE a2p_reg SET updated = ?1 WHERE client_id = ?2').bind(now(), cid).run(); return row.status; }
  await save('in_review', r.next, '', f);
  return 'in_review';
}

export async function a2pCron(env) {
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PRIMARY_PROFILE_SID)) return { skipped: true };
  await ensureA2p(env);
  const rows = ((await env.DB.prepare("SELECT client_id FROM a2p_reg WHERE status IN ('submitted','in_review') ORDER BY updated LIMIT 10").all()).results) || [];
  let moved = 0;
  for (const r of rows) { try { await advance(env, r.client_id); moved++; } catch (e) {} await new Promise(x => setTimeout(x, 1100)); }   // Twilio asks for one brand/campaign request per second
  return { moved };
}

export async function textingState(env, c) {
  if (c.staff) return null;
  await ensureA2p(env);
  const r = await env.DB.prepare('SELECT status, error, updated FROM a2p_reg WHERE client_id = ?1').bind(c.client_id).first().catch(() => null);
  const status = r ? r.status : 'none';
  return { status, label: LABELS[status] || status, error: r && r.status === 'needs_fix' ? r.error : '', regulated: !!+c.regulated };
}

// ---------------- the owner's form: /app/<code>/texting ----------------
function shell(title, inner) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>' + esc(title) + '</title>' +
    '<style>:root{--ink:#ECEEF3;--slate:#A3ACBF;--line:#262E40;--paper:#0F131B;--card:#171C27;--sign:#FF6A5E}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:620px;margin:0 auto;padding:24px 16px 60px}h1{font-size:1.6rem;line-height:1.2;margin:0 0 8px}h2{font-size:1.1rem;margin:22px 0 6px}p{margin:8px 0}.sub,.fine{color:var(--slate)}.fine{font-size:14px}label{display:block;margin:12px 0 0;font-weight:600;font-size:15px}input,select{width:100%;margin-top:4px;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.row3{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px}.check{display:flex;gap:10px;align-items:flex-start;font-weight:400}.check input{width:auto;margin-top:5px}.btn{display:inline-block;margin-top:18px;padding:13px 20px;border:0;border-radius:12px;background:var(--sign);color:#1A0605;font:700 16px system-ui;cursor:pointer;text-decoration:none}.btn.line{background:transparent;color:var(--ink);border:2px solid var(--line)}.card{border:1px solid var(--line);background:var(--card);border-radius:14px;padding:14px 16px;margin:14px 0}.err{border-color:var(--sign)}a{color:var(--sign)}@media(max-width:520px){.row,.row3{grid-template-columns:1fr}}</style></head><body><main>' + inner + '</main></body></html>';
}
export async function textingPage(env, c, base, req) {
  await ensureA2p(env);
  const H = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' };
  const back = '<p><a class="btn line" href="' + esc(base) + '">Back to the app</a></p>';
  if (+c.regulated) return new Response(shell('Texting', '<h1>Texting for regulated businesses</h1><p class="sub">We set texting up with you directly, so it fits your compliance rules. Message us in Ask us and we’ll take it from there.</p>' + back), { headers: H });
  const row = await env.DB.prepare('SELECT * FROM a2p_reg WHERE client_id = ?1').bind(c.client_id).first();
  let err = '', prev = {};
  try { prev = JSON.parse((row && row.form) || '{}'); } catch (e) {}
  if (req.method === 'POST') {
    const fd = await req.formData(), b = {};
    for (const [k, v] of fd.entries()) b[k] = v;
    const chk = checkForm(b);
    if (!chk.ok) { err = chk.error; prev = Object.assign({}, b, { ein: '' }); }
    else if (row && ['submitted', 'in_review', 'approved'].includes(row.status)) err = 'This is already on its way.';
    else {
      const f = chk.form;
      const status = f.noEin ? 'needs_help' : 'submitted';
      await env.DB.prepare("INSERT INTO a2p_reg (client_id, status, step, form, sids, error, tries, created, updated) VALUES (?1,?2,?3,?4,'{}','',0,?5,?5) ON CONFLICT(client_id) DO UPDATE SET status = excluded.status, step = excluded.step, form = excluded.form, sids = '{}', error = '', tries = 0, updated = excluded.updated")
        .bind(c.client_id, status, f.noEin ? '' : 'profile', JSON.stringify(f), now()).run();
      try { const { markOnboard } = await import('./biz.js'); await markOnboard(env, c.client_id, 'texting'); } catch (e) {}
      await opsPing(env, (f.noEin ? 'Texting registration needs a sole-proprietor setup: ' : 'Texting registration sent: ') + (c.business || c.client_id), f.noEin ? 'No EIN. Register them as a sole proprietor in Twilio by hand.' : 'The registration runs on its own; HQ shows each step.', 'default', 'memo');
      const msg = f.noEin ? '<h1>Got it.</h1><p class="sub">Without an EIN, carriers use a different, simpler registration. We’ll set it up with you and message you in the app. It needs a code sent to your cell.</p>'
        : '<h1>Sent.</h1><p class="sub">Carriers review every business that texts. It usually takes a few days, sometimes a couple of weeks. You’ll get a note in the app when it’s approved, or if anything needs fixing. Calls, Max and email all work in the meantime.</p>';
      return new Response(shell('Texting', msg + back), { headers: H });
    }
  }
  if (row && ['submitted', 'in_review'].includes(row.status) && !err) return new Response(shell('Texting', '<h1>Carriers are reviewing it.</h1><p class="sub">Started ' + esc(String(row.created || '').slice(0, 10)) + '. It usually takes a few days. You’ll get a note in the app when it’s approved.</p>' + back), { headers: H });
  if (row && row.status === 'approved') return new Response(shell('Texting', '<h1>Texting is on.</h1><p class="sub">Carriers approved texting for your business. Texts go out from your Always Open number with your business name first, and replies come back to your inbox.</p>' + back), { headers: H });
  if (row && row.status === 'needs_help' && !err) return new Response(shell('Texting', '<h1>We’re setting it up with you.</h1><p class="sub">Without an EIN, carriers use a sole-proprietor registration. We’ll message you in the app.</p>' + back), { headers: H });
  const v = k => esc(prev[k] || '');
  const sel = (name, opts, cur) => '<select name="' + name + '" required>' + '<option value="">Choose</option>' + opts.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return '<option value="' + esc(val) + '"' + (cur === val ? ' selected' : '') + '>' + esc(lab) + '</option>'; }).join('') + '</select>';
  let kind = '';
  try { const l = await env.DB.prepare('SELECT industry FROM voice_lines WHERE client_id = ?1 LIMIT 1').bind(c.client_id).first(); kind = (l && l.industry) || ''; } catch (e) {}
  const ind = prev.industry || industryFor(kind);
  const fix = row && row.status === 'needs_fix' ? '<div class="card err"><b>Needs a fix.</b><p>' + esc(row.error) + '</p></div>' : '';
  const html = '<h1>Texting under your business name</h1><p class="sub">Phone carriers require every business that texts customers to be registered. Fill this in once and we handle the rest. It usually takes a few days. Texts go out from your Always Open number with your business name first.</p>' + fix +
    (err ? '<div class="card err"><b>' + esc(err) + '</b></div>' : '') +
    '<form method="post" autocomplete="on">' +
    '<h2>The business</h2>' +
    '<label>Legal business name, exactly as the IRS has it<input name="legal" required maxlength="120" value="' + v('legal') + '"></label>' +
    '<div class="row"><label>Kind of entity' + sel('btype', BUSINESS_TYPES, prev.btype) + '</label><label>Industry' + sel('industry', Object.entries(INDUSTRIES), ind) + '</label></div>' +
    '<label>EIN (federal tax ID)<input name="ein" inputmode="numeric" autocomplete="off" maxlength="11" placeholder="12-3456789"></label>' +
    '<label class="check"><input type="checkbox" name="noEin" value="1"' + (prev.noEin ? ' checked' : '') + '> <span>I don’t have an EIN (sole proprietor using my Social Security number). We’ll set this up with you instead; never type an SSN here.</span></label>' +
    '<label>Website or Google Business link<input name="website" type="url" required maxlength="200" placeholder="https://" value="' + v('website') + '"></label>' +
    '<h2>Business address</h2>' +
    '<label>Street<input name="street" required maxlength="120" autocomplete="street-address" value="' + v('street') + '"></label>' +
    '<div class="row3"><label>City<input name="city" required maxlength="60" value="' + v('city') + '"></label><label>State<input name="state" required maxlength="2" placeholder="GA" value="' + v('state') + '"></label><label>ZIP<input name="zip" required inputmode="numeric" maxlength="10" value="' + v('zip') + '"></label></div>' +
    '<h2>Who is registering</h2>' +
    '<div class="row"><label>First name<input name="first" required maxlength="40" autocomplete="given-name" value="' + v('first') + '"></label><label>Last name<input name="last" required maxlength="40" autocomplete="family-name" value="' + v('last') + '"></label></div>' +
    '<div class="row"><label>Title<input name="title" required maxlength="60" placeholder="Owner" value="' + v('title') + '"></label><label>Closest position' + sel('position', POSITIONS, prev.position || 'CEO') + '</label></div>' +
    '<div class="row"><label>Email<input name="email" type="email" required maxlength="120" autocomplete="email" value="' + v('email') + '"></label><label>Cell number<input name="phone" type="tel" required maxlength="20" autocomplete="tel" value="' + v('phone') + '"></label></div>' +
    '<label class="check" style="margin-top:18px"><input type="checkbox" name="agree" value="1" required> <span>I can register this business for text messaging, and these details match our IRS records. Texts go only to customers who agree, and every first text says how to stop.</span></label>' +
    '<button class="btn" type="submit">Send for approval</button>' +
    '<p class="fine">Your EIN goes to our texting provider for the carriers’ check and is not kept on our side once it’s sent. <a href="' + SITE + '/privacy" target="_blank" rel="noopener">Privacy</a></p>' +
    '</form>' + back;
  return new Response(shell('Texting registration', html), { headers: H });
}
