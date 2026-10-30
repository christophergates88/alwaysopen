// Max's minutes: counted per business per calendar month from the calls Max took, shown in the app, and billed past the
// plan's 300 (600 with the extra-minutes add-on) at 25 cents a minute, the way the pricing page says.
//   - at 80 percent the owner gets one push, at 100 percent one more; Max keeps answering either way
//   - on the 2nd of the month, the overage from last month goes on the business's next Stripe invoice, once
//   - a daily safety cap (120 minutes or 80 calls in one day on one line) switches that line to a short message and
//     tells Christopher: that is a robocall storm or abuse, not a busy day
const DAY = 864e5;
export const INCLUDED_MIN = 300;
export const OVER_CENTS_PER_MIN = 25;
export const DAY_MINUTE_CAP = 120;
const ready = new WeakSet();
export async function ensureMinutes(env) {
  if (ready.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS minute_marks (client_id TEXT, month TEXT, mark TEXT, at TEXT, PRIMARY KEY (client_id, month, mark))'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS minute_overage (client_id TEXT, month TEXT, minutes INTEGER, cents INTEGER, invoiced TEXT, invoice_item TEXT, PRIMARY KEY (client_id, month))')
  ]);
  ready.add(env.DB);
}
export function monthKey(now) { return new Date(now).toISOString().slice(0, 7); }
function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)).toISOString(), to: new Date(Date.UTC(y, m, 1)).toISOString() };
}
// Billable minutes: each call rounded up to the next minute, like a phone company. Test calls and rehearsals don't count.
export async function usedMinutes(env, cid, key) {
  const { from, to } = monthRange(key);
  const r = await env.DB.prepare("SELECT SUM(CASE WHEN seconds > 0 THEN (seconds + 59) / 60 ELSE 0 END) AS m, COUNT(*) AS n FROM app_calls WHERE client_id = ?1 AND test = 0 AND outcome NOT IN ('limited', 'spam') AND at >= ?2 AND at < ?3").bind(cid, from, to).first();
  return { minutes: +(r && r.m) || 0, calls: +(r && r.n) || 0 };
}
export async function includedFor(env, cid) {
  const b = await env.DB.prepare('SELECT max FROM billing WHERE client_id = ?1').bind(cid).first().catch(() => null);
  return INCLUDED_MIN * (1 + (b && +b.max ? 1 : 0));
}
// For the app and the report.
export async function meterFor(env, cid, now) {
  const key = monthKey(now || Date.now());
  const [u, included] = await Promise.all([usedMinutes(env, cid, key), includedFor(env, cid)]);
  const over = Math.max(0, u.minutes - included);
  return { month: key, used: u.minutes, calls: u.calls, included, over, overCents: over * OVER_CENTS_PER_MIN, pct: Math.min(999, Math.round(100 * u.minutes / included)) };
}
export function meterText(m) {
  if (!m) return '';
  return m.over ? m.used + ' minutes this month, ' + m.over + ' past the ' + m.included + ' in your plan ($' + (m.overCents / 100).toFixed(2) + ' at 25¢ a minute)' : m.used + ' of ' + m.included + ' minutes this month';
}

// Every 10 minutes: pushes at 80 and 100 percent, and on the 2nd of the month the overage goes on the invoice.
export async function minutesCron(env, now, h) {
  now = now || Date.now();
  await ensureMinutes(env);
  const push = (h && h.push) || (async () => 0), stripe = h && h.stripe, alert = (h && h.alert) || (async () => 0);
  const out = { warned: 0, full: 0, invoiced: 0 };   // invoiced counts Stripe invoice items; by-hand ones are alerted instead
  const key = monthKey(now);
  const clients = ((await env.DB.prepare("SELECT c.client_id, c.business FROM app_clients c JOIN voice_lines l ON l.client_id = c.client_id WHERE c.active = 1 AND c.client_id != 'demo-plumbing' AND c.client_id != 'always-open' GROUP BY c.client_id").all()).results) || [];
  for (const c of clients) {
    const m = await meterFor(env, c.client_id, now);
    const mark = async (k) => (await env.DB.prepare('INSERT OR IGNORE INTO minute_marks (client_id, month, mark, at) VALUES (?1, ?2, ?3, ?4)').bind(c.client_id, key, k, new Date(now).toISOString()).run()).meta.changes > 0;
    if (m.pct >= 100 && await mark('full')) {
      out.full++;
      await push(c.client_id, { title: 'Max has used your ' + m.included + ' minutes this month', body: 'He keeps answering. Minutes past that are 25¢ each on your next invoice. Add 300 more a month in the app if this is your normal.' });
    } else if (m.pct >= 80 && await mark('warn')) {
      out.warned++;
      await push(c.client_id, { title: 'Max has used ' + m.used + ' of your ' + m.included + ' minutes', body: 'That is ' + m.pct + '% with ' + Math.max(1, Math.ceil((Date.parse(monthRange(key).to) - now) / DAY)) + ' days left in the month. Past ' + m.included + ', minutes are 25¢ each.' });
    }
  }
  // The 2nd of the month: last month's overage, once, on the next invoice.
  if (new Date(now).getUTCDate() >= 2) {
    const last = monthKey(Date.parse(monthRange(key).from) - DAY), lr = monthRange(last);
    // Everyone Max answered for last month, including a client who has since ended or paused.
    const billed = ((await env.DB.prepare("SELECT DISTINCT a.client_id, c.business FROM app_calls a JOIN app_clients c ON c.client_id = a.client_id WHERE a.at >= ?1 AND a.at < ?2 AND a.test = 0 AND a.client_id NOT IN ('demo-plumbing', 'always-open')").bind(lr.from, lr.to).all()).results) || [];
    for (const c of billed) {
      const done = await env.DB.prepare('SELECT invoiced FROM minute_overage WHERE client_id = ?1 AND month = ?2').bind(c.client_id, last).first();
      if (done && done.invoiced) continue;
      const u = await usedMinutes(env, c.client_id, last), included = await includedFor(env, c.client_id);
      const over = Math.max(0, u.minutes - included), cents = over * OVER_CENTS_PER_MIN;
      let item = '';
      if (over > 0 && stripe) {
        const b = await env.DB.prepare('SELECT customer, status FROM billing WHERE client_id = ?1').bind(c.client_id).first().catch(() => null);
        if (b && b.customer) {
          try {
            const idem = 'overage-' + c.client_id + '-' + last;
            const r = await stripe(env, 'POST', 'invoiceitems', { customer: b.customer, amount: cents, currency: 'usd', description: 'Max minutes past ' + included + ' in ' + last + ': ' + over + ' minutes at 25¢' }, idem);
            item = r && r.id ? r.id : '';
            // No next invoice is coming for a client who ended, is ending or is paused: bill it now on its own.
            if (/^(canceled|canceling|paused)$/.test(b.status || '')) {
              const inv = await stripe(env, 'POST', 'invoices', { customer: b.customer, auto_advance: 'true', collection_method: 'charge_automatically', pending_invoice_items_behavior: 'include', description: 'Max minutes in ' + last }, idem + '-invoice');
              if (inv && inv.id) await stripe(env, 'POST', 'invoices/' + inv.id + '/finalize', {}, idem + '-finalize');
            }
          } catch (e) { await alert('minutes-invoice', c.client_id, 'Could not add ' + over + ' overage minutes for ' + (c.business || c.client_id) + ' to their Stripe invoice: ' + String((e && e.message) || e).slice(0, 120)); continue; }
        } else {
          item = 'manual';
          await alert('minutes-invoice', c.client_id, (c.business || c.client_id) + ' used ' + over + ' minutes past their plan in ' + last + ' ($' + (cents / 100).toFixed(2) + ') but has no Stripe customer on file. Bill it by hand.');
        }
      }
      await env.DB.prepare('INSERT OR REPLACE INTO minute_overage (client_id, month, minutes, cents, invoiced, invoice_item) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(c.client_id, last, over, cents, new Date(now).toISOString(), item).run();
      if (item && item !== 'manual') out.invoiced++;
    }
  }
  return out;
}

// The daily safety cap, checked when a call comes in. Returns true when this line should take a short message instead.
export async function overDailyCap(env, number, now) {
  const r = await env.DB.prepare("SELECT SUM(seconds) AS s, COUNT(*) AS n FROM app_calls WHERE number = ?1 AND at > ?2 AND outcome NOT IN ('limited')").bind(number, new Date((now || Date.now()) - DAY).toISOString()).first();
  return (+(r && r.s) || 0) >= DAY_MINUTE_CAP * 60;
}
