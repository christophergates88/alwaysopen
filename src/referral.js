// Referrals: one free month for each business owner you send us who stays.
//  - Attribution is first-touch and recorded when the new owner signs up (their link, or an earlier website request with the same email or phone).
//  - EARNED once the new owner has paid three monthly charges (the first month's 30-day refund window has passed, plus two more months) with no
//    refund, chargeback or failed payment along the way. A refund, chargeback, failed payment, cancellation, or the same person, card, address,
//    email domain, phone or business name as the referrer voids it.
//  - CREDITED as one month of the referrer's own plan and extras, as Stripe account credit that comes off their next invoices. Credits stack. At
//    most 6 free months in any rolling 12 months. No cash value; unused credit ends if the referrer cancels.
//  - Business to business only. Never for customers, patients, policyholders or reviews.
// Pure database and Stripe calls on purpose: no email or push imports, so billing.js can use it. The caller passes helpers in `h`.
export const CAP = 6;
export const NEED_PAID = 3;
const DAY = 86400000;
const iso = t => new Date(t).toISOString();
const digits = s => String(s || '').replace(/\D/g, '').slice(-10);
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const money = c => '$' + (c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
export const REF_RE = /^[A-Za-z0-9_-]{4,40}$/;
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|aol|icloud|me|mac|proton|protonmail|pm|comcast|att|sbcglobal|bellsouth|verizon|cox|charter|earthlink|mail|gmx|zoho)\./;
const domain = e => { const m = String(e || '').toLowerCase().trim().match(/@([^@\s]+)$/); return m && !FREE_MAIL.test(m[1]) ? m[1] : ''; };

export async function ensureReferrals(env) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS referrals (id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_id TEXT NOT NULL, referred_id TEXT NOT NULL UNIQUE, source TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created TEXT NOT NULL, last_check TEXT DEFAULT '', earned_at TEXT, credited_at TEXT, credit_cents INTEGER DEFAULT 0, txn TEXT DEFAULT '', note TEXT DEFAULT '')"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals (referrer_id, status)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS referral_bank (client_id TEXT PRIMARY KEY, cents INTEGER DEFAULT 0, at TEXT)')
  ]);
}
const one = async (env, sql, ...p) => { try { return await env.DB.prepare(sql).bind(...p).first(); } catch (e) { return null; } };
const bill = (env, cid) => one(env, 'SELECT client_id, customer, sub, status, email, phone, business FROM billing WHERE client_id = ?1', cid);

// A new client came in with (or after) a referral link. Returns 'none', 'have', 'pending' or 'void'.
export async function noteSignup(env, s) {
  const ref = String(s.ref || '').trim();
  if (!REF_RE.test(ref) || !s.clientId) return 'none';
  await ensureReferrals(env);
  const r = await one(env, 'SELECT client_id, business, phone FROM app_clients WHERE ref = ?1 AND active = 1', ref);
  if (!r || r.client_id === s.clientId) return 'none';
  if (await one(env, 'SELECT id FROM referrals WHERE referred_id = ?1', s.clientId)) return 'have';
  const rb = await bill(env, r.client_id);
  const why = (s.email && rb && rb.email && String(rb.email).toLowerCase() === String(s.email).toLowerCase()) ? 'same email'
    : (digits(s.phone).length === 10 && [r.phone, rb && rb.phone].some(p => digits(p) === digits(s.phone))) ? 'same phone'
    : (norm(s.business).length > 2 && [r.business, rb && rb.business].some(b => norm(b) === norm(s.business))) ? 'same business name'
    : (domain(s.email) && rb && domain(rb.email) === domain(s.email)) ? 'same email domain' : '';
  await env.DB.prepare('INSERT OR IGNORE INTO referrals (referrer_id, referred_id, source, status, created, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(r.client_id, s.clientId, s.source || 'link', why ? 'void' : 'pending', iso(s.now || Date.now()), why).run();
  return why ? 'void' : 'pending';
}

// Website requests that came with a referral link and later became a signup (same email or phone, signed up after the request).
export async function matchLeads(env, now) {
  await ensureReferrals(env);
  let leads = [], cands = [];
  try {
    leads = ((await env.DB.prepare("SELECT at, email, phone, ref FROM leads WHERE ref IS NOT NULL AND ref != '' AND status != 'spam' AND at > ?1 ORDER BY id DESC LIMIT 200").bind(iso(now - 120 * DAY)).all()).results) || [];
    if (!leads.length) return 0;
    cands = ((await env.DB.prepare('SELECT client_id, email, phone, business, created FROM billing WHERE created > ?1 AND NOT EXISTS (SELECT 1 FROM referrals r WHERE r.referred_id = billing.client_id) ORDER BY created LIMIT 300').bind(iso(now - 120 * DAY)).all()).results) || [];
  } catch (e) { return 0; }
  let n = 0;
  for (const l of leads) {
    const em = String(l.email || '').toLowerCase().trim(), ph = digits(l.phone);
    // The same email only: a phone number is easy to copy off a business's own website, so a phone match alone could
    // let a client claim credit for businesses that found us on their own.
    const c = cands.find(x => x.created > l.at && em && String(x.email || '').toLowerCase() === em);
    if (!c) continue;
    const res = await noteSignup(env, { clientId: c.client_id, ref: l.ref, email: c.email, phone: c.phone, business: c.business, source: 'lead', now });
    if (res === 'pending' || res === 'void') { n++; cands.splice(cands.indexOf(c), 1); }
  }
  return n;
}

export async function usedMonths(env, referrerId, now) {
  const r = await one(env, "SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ?1 AND status = 'credited' AND credited_at > ?2", referrerId, iso((now || Date.now()) - 365 * DAY));
  return (r && +r.n) || 0;
}

// What one month of this subscription costs, from the subscription's own monthly items.
export function monthCents(sub) {
  const items = (sub && sub.items && sub.items.data) || [];
  let t = 0;
  for (const it of items) {
    const p = it.price || {};
    if (p.recurring && p.recurring.interval && p.recurring.interval !== 'month') return 0;
    t += (+p.unit_amount || 0) * (+it.quantity || 1);
  }
  return t > 0 && t <= 200000 ? t : 0;
}

// Same card or same address on both Stripe customers: the same person paying for both.
async function sameIdentity(env, h, a, b) {
  if (!h.stripe || !a || !b || !a.customer || !b.customer) return '';
  const cards = async cus => { try { return ((await h.stripe(env, 'GET', 'payment_methods?customer=' + encodeURIComponent(cus) + '&type=card&limit=5')).data || []).map(p => p.card && p.card.fingerprint).filter(Boolean); } catch (e) { return []; } };
  const addr = async cus => { try { const c = await h.stripe(env, 'GET', 'customers/' + encodeURIComponent(cus)); const x = c && c.address; return x ? norm((x.line1 || '') + (x.postal_code || '')) : ''; } catch (e) { return ''; } };
  const [ca, cb] = [await cards(a.customer), await cards(b.customer)];
  if (ca.some(f => cb.indexOf(f) > -1)) return 'same card';
  const [aa, ab] = [await addr(a.customer), await addr(b.customer)];
  if (aa.length > 6 && aa === ab) return 'same address';
  return '';
}

async function judge(env, h, r, now) {
  const a = await one(env, 'SELECT active FROM app_clients WHERE client_id = ?1', r.referred_id);
  if (!a || !+a.active) return { v: 'void', why: 'left before qualifying' };
  const age = now - Date.parse(r.created);
  const b = await bill(env, r.referred_id);
  if (!b || !b.customer) return age >= 60 * DAY ? { v: 'manual' } : { v: 'wait' };
  if (b.status === 'canceled') return { v: 'void', why: 'canceled before qualifying' };
  if (!h.stripe) return { v: 'wait' };
  const inv = ((await h.stripe(env, 'GET', 'invoices?customer=' + encodeURIComponent(b.customer) + '&limit=12&expand[]=data.charge')) || {}).data || [];
  const ch = i => (i.charge && typeof i.charge === 'object') ? i.charge : null;
  if (inv.some(i => ch(i) && +ch(i).amount_refunded > 0)) return { v: 'void', why: 'refunded' };
  if (inv.some(i => ch(i) && ch(i).disputed)) return { v: 'void', why: 'chargeback' };
  if (inv.some(i => i.status !== 'void' && i.status !== 'draft' && (i.status === 'uncollectible' || +i.attempt_count > 1 || (i.status === 'open' && +i.attempt_count >= 1)))) return { v: 'void', why: 'payment failed' };
  const monthly = inv.filter(i => i.status === 'paid' && +i.amount_paid > 0 && (!i.billing_reason || i.billing_reason === 'subscription_create' || i.billing_reason === 'subscription_cycle'));
  if (monthly.length < NEED_PAID) return { v: 'wait' };
  const first = Math.min(...monthly.map(i => 1000 * ((i.status_transitions && i.status_transitions.paid_at) || i.created || 0)));
  if (now - first < 55 * DAY) return { v: 'wait' };
  const who = await sameIdentity(env, h, await bill(env, r.referrer_id), b);
  return who ? { v: 'void', why: who } : { v: 'earned' };
}

async function tell(env, h, r, cents) {
  const who = await one(env, 'SELECT business FROM app_clients WHERE client_id = ?1', r.referred_id);
  const me = await one(env, 'SELECT business FROM app_clients WHERE client_id = ?1', r.referrer_id);
  const text = 'Thank you for sending ' + ((who && who.business) || 'a business') + ' our way. They have stayed three months, so one month is on us: ' + money(cents) + ' comes off your next bill.';
  try { await env.DB.prepare("INSERT INTO app_messages (client_id, at, by, text, hq_synced, dir, notified) VALUES (?1, ?2, 'Our team', ?3, 1, 'out', 0)").bind(r.referrer_id, iso(Date.now()), text).run(); } catch (e) { /* the credit stands */ }
  if (h.notify) await h.notify('Referral credit applied: ' + ((me && me.business) || r.referrer_id), money(cents) + ' off, for sending ' + ((who && who.business) || r.referred_id) + '.').catch(() => {});
}

// How much credit is sitting on a referrer's Stripe account right now (shown in the app as "banked").
async function bank(env, h, cid, now) {
  const b = await bill(env, cid);
  if (!b || !b.customer || !h.stripe) return;
  try {
    const c = await h.stripe(env, 'GET', 'customers/' + encodeURIComponent(b.customer));
    await env.DB.prepare('INSERT INTO referral_bank (client_id, cents, at) VALUES (?1, ?2, ?3) ON CONFLICT(client_id) DO UPDATE SET cents = excluded.cents, at = excluded.at').bind(cid, Math.max(0, -(+c.balance || 0)), iso(now)).run();
  } catch (e) { /* the next run tries again */ }
}

async function pay(env, h, r, now) {
  if (/^manual/.test(r.note || '')) return 'manual';
  const b = await bill(env, r.referrer_id);
  if (!b || !b.customer || !b.sub) {
    await env.DB.prepare("UPDATE referrals SET note = 'manual: give a free month by hand' WHERE id = ?1 AND status = 'earned'").bind(r.id).run();
    if (h.notify) { const me = await one(env, 'SELECT business FROM app_clients WHERE client_id = ?1', r.referrer_id); await h.notify('Referral earned: ' + ((me && me.business) || r.referrer_id), 'Give them one free month by hand. It is on your weekly list.').catch(() => {}); }
    return 'manual';
  }
  if (b.status === 'canceled') { await env.DB.prepare("UPDATE referrals SET status = 'void', note = 'referrer left' WHERE id = ?1 AND status = 'earned'").bind(r.id).run(); return 'void'; }
  if (b.status !== 'active') return 'wait';
  if ((await usedMonths(env, r.referrer_id, now)) >= CAP) return 'cap';
  if (!h.stripe) return 'wait';
  const claim = await env.DB.prepare("UPDATE referrals SET status = 'crediting', last_check = ?1 WHERE id = ?2 AND status = 'earned'").bind(iso(now), r.id).run();
  if (!(claim.meta && claim.meta.changes)) return 'wait';
  try {
    const cents = monthCents(await h.stripe(env, 'GET', 'subscriptions/' + b.sub));
    if (!cents) throw new Error('could not price the month');
    const tx = await h.stripe(env, 'POST', 'customers/' + b.customer + '/balance_transactions', { amount: -cents, currency: 'usd', description: 'Referral: one free month', metadata: { referral: String(r.id) } });
    await env.DB.prepare("UPDATE referrals SET status = 'credited', credited_at = ?1, credit_cents = ?2, txn = ?3, note = '' WHERE id = ?4").bind(iso(now), cents, (tx && tx.id) || '', r.id).run();
    await tell(env, h, r, cents);
    await bank(env, h, r.referrer_id, now);
    return 'credited';
  } catch (e) {
    await env.DB.prepare("UPDATE referrals SET status = 'earned', note = ?1 WHERE id = ?2 AND status = 'crediting'").bind('credit failed: ' + String((e && e.message) || e).slice(0, 120), r.id).run();
    if (h.alert) await h.alert('referral-credit', 'A referral credit did not go through', 'Referral ' + r.id + ': ' + String((e && e.message) || e).slice(0, 200) + '. It will try again.').catch(() => {});
    return 'failed';
  }
}

// A credit that was claimed but never confirmed (the Worker stopped mid-way): look for it in Stripe before deciding.
async function recoverStuck(env, h, now) {
  const rows = ((await env.DB.prepare("SELECT * FROM referrals WHERE status = 'crediting' AND last_check < ?1 LIMIT 20").bind(iso(now - 30 * 60000)).all()).results) || [];
  for (const r of rows) {
    let found = null;
    try {
      const b = await bill(env, r.referrer_id);
      if (b && b.customer && h.stripe) {
        const list = await h.stripe(env, 'GET', 'customers/' + b.customer + '/balance_transactions?limit=30');
        found = ((list && list.data) || []).find(t => t.metadata && String(t.metadata.referral) === String(r.id));
      }
    } catch (e) { continue; }
    if (found) await env.DB.prepare("UPDATE referrals SET status = 'credited', credited_at = ?1, credit_cents = ?2, txn = ?3, note = '' WHERE id = ?4").bind(iso(now), Math.abs(+found.amount || 0), found.id || '', r.id).run();
    else await env.DB.prepare("UPDATE referrals SET status = 'earned' WHERE id = ?1 AND status = 'crediting'").bind(r.id).run();
  }
}

// Every six hours (the Worker's 10-minute cron calls this; `force` is for tests).
export async function referralCron(env, h, at, force) {
  const now = at || Date.now(), d = new Date(now);
  if (!force && !(d.getUTCMinutes() < 10 && d.getUTCHours() % 6 === 0)) return { skipped: true };
  await ensureReferrals(env);
  h = h || {};
  const out = { matched: await matchLeads(env, now).catch(() => 0), earned: 0, credited: 0, voided: 0 };
  await recoverStuck(env, h, now).catch(() => {});
  const rows = ((await env.DB.prepare("SELECT * FROM referrals WHERE status IN ('pending', 'earned') ORDER BY id LIMIT 100").all()).results) || [];
  for (const r of rows) {
    try {
      let row = r;
      if (r.status === 'pending') {
        if (now - Date.parse(r.created) < 55 * DAY) continue;
        if (r.last_check && now - Date.parse(r.last_check) < 20 * 3600000) continue;
        await env.DB.prepare('UPDATE referrals SET last_check = ?1 WHERE id = ?2').bind(iso(now), r.id).run();
        const j = await judge(env, h, r, now);
        if (j.v === 'void') { await env.DB.prepare("UPDATE referrals SET status = 'void', note = ?1 WHERE id = ?2").bind(j.why, r.id).run(); out.voided++; continue; }
        if (j.v === 'wait') continue;
        const note = j.v === 'manual' ? 'manual: confirm they have paid three months' : '';
        await env.DB.prepare("UPDATE referrals SET status = 'earned', earned_at = ?1, note = ?2 WHERE id = ?3").bind(iso(now), note, r.id).run();
        out.earned++;
        row = Object.assign({}, r, { status: 'earned', note });
        if (j.v === 'manual' && h.notify) { const who = await one(env, 'SELECT business FROM app_clients WHERE client_id = ?1', r.referred_id); await h.notify('Referral to check', ((who && who.business) || r.referred_id) + ' has been with us 60+ days. Confirm they paid three months; it is on your weekly list.').catch(() => {}); }
      }
      if (row.status === 'earned') { const res = await pay(env, h, row, now); if (res === 'credited') out.credited++; }
    } catch (e) { /* the next run tries again */ }
  }
  // Keep each referrer's banked credit fresh (their invoices use it up as they go).
  try {
    const refs = ((await env.DB.prepare("SELECT DISTINCT referrer_id FROM referrals WHERE status = 'credited' AND credited_at > ?1 LIMIT 100").bind(iso(now - 400 * DAY)).all()).results) || [];
    for (const x of refs) await bank(env, h, x.referrer_id, now);
  } catch (e) { /* the app shows the last number */ }
  return out;
}

// The referrer left: any unused referral credit ends with their plan.
export async function expireCredits(env, h, clientId, now) {
  try {
    await ensureReferrals(env);
    const b = await bill(env, clientId);
    if (!b || !b.customer || !h.stripe) return 0;
    const given = await one(env, "SELECT COALESCE(SUM(credit_cents), 0) AS n FROM referrals WHERE referrer_id = ?1 AND status = 'credited'", clientId);
    const cus = await h.stripe(env, 'GET', 'customers/' + encodeURIComponent(b.customer));
    const left = Math.min(Math.max(0, -(+cus.balance || 0)), (given && +given.n) || 0);
    if (left <= 0) return 0;
    await h.stripe(env, 'POST', 'customers/' + b.customer + '/balance_transactions', { amount: left, currency: 'usd', description: 'Referral credit ended with the plan', metadata: { referral: 'expired' } });
    await env.DB.prepare('INSERT INTO referral_bank (client_id, cents, at) VALUES (?1, 0, ?2) ON CONFLICT(client_id) DO UPDATE SET cents = 0, at = excluded.at').bind(clientId, iso(now || Date.now())).run();
    return left;
  } catch (e) { return 0; }
}

// For the app: the owner's tally and list (business names only; a reason for a referral not counting is never shown).
export async function referralState(env, c, now) {
  now = now || Date.now();
  let rows = [], bk = null;
  try {
    await ensureReferrals(env);
    rows = ((await env.DB.prepare("SELECT r.status, r.created, r.credited_at, a.business FROM referrals r LEFT JOIN app_clients a ON a.client_id = r.referred_id WHERE r.referrer_id = ?1 ORDER BY r.id DESC LIMIT 30").bind(c.client_id).all()).results) || [];
    bk = await one(env, 'SELECT cents FROM referral_bank WHERE client_id = ?1', c.client_id);
  } catch (e) { rows = []; }
  const label = s => s === 'credited' ? 'Free month applied' : (s === 'pending' ? 'Signed up. Counts after three months.' : (s === 'void' ? 'Did not qualify' : 'Earned. Your free month is on its way.'));
  const kind = s => s === 'credited' ? 'applied' : (s === 'pending' ? 'waiting' : (s === 'void' ? 'voided' : 'earned'));
  return {
    cap: CAP,
    used: rows.filter(r => r.status === 'credited' && r.credited_at && now - Date.parse(r.credited_at) < 365 * DAY).length,
    earned: rows.filter(r => r.status === 'credited').length,
    waiting: rows.filter(r => r.status === 'pending' || r.status === 'earned' || r.status === 'crediting').length,
    bank: (bk && +bk.cents) || 0,
    list: rows.slice(0, 12).map(r => ({ business: r.business || 'A business', label: label(r.status), status: kind(r.status) })),
    nudge: nudgeOf(rows, now)
  };
}
// The one line Home shows every day: the newest referral that is moving, or the plain invitation. `key` changes when the
// state does, so a card the owner put away comes back when there is news. Pure, for tests.
export function nudgeOf(rows, now) {
  const biz = r => r.business || 'A business';
  const w = rows.find(r => r.status === 'pending'), e = rows.find(r => r.status === 'earned' || r.status === 'crediting');
  const a = rows.find(r => r.status === 'credited' && r.credited_at && (now || Date.now()) - Date.parse(r.credited_at) < 30 * DAY);
  if (e) return { kind: 'earned', key: 'earned:' + biz(e), text: biz(e) + ' stayed three months. Your free month is on its way.' };
  if (a) return { kind: 'applied', key: 'applied:' + biz(a), text: 'Your free month for sending ' + biz(a) + ' is applied to your account.' };
  if (w) return { kind: 'waiting', key: 'waiting:' + biz(w), text: biz(w) + ' signed up from your link. When they’ve stayed three months, your next month is free.' };
  return { kind: 'invite', key: 'invite', text: 'Know an owner who misses calls? Send them your link. When they’ve stayed three months, your next month is free.' };
}

// By hand: the weekly list ticks a manual referral off.
export async function markCredited(env, id, now) {
  await ensureReferrals(env);
  await env.DB.prepare("UPDATE referrals SET status = 'credited', credited_at = ?1, note = 'applied by hand' WHERE id = ?2 AND status = 'earned'").bind(iso(now || Date.now()), id).run();
}
