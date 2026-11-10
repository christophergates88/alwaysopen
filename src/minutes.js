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
// Max's own seconds on a call: the relay's own length when we have it (Twilio's status callback can go missing, and a
// call put through to the owner runs on long after Max is gone), else the call's length less the owner's part (Nov 10:
// owners were metered for their own talk, and that talk tripped the daily cap).
export const MAX_SECS = "(CASE WHEN COALESCE(relay_seconds, 0) > 0 THEN relay_seconds ELSE MAX(0, COALESCE(seconds, 0) - COALESCE(transfer_seconds, 0)) END)";
// Billable minutes: each call rounded up to the next minute, like a phone company. Test calls and rehearsals don't count.
export async function usedMinutes(env, cid, key) {
  const { from, to } = monthRange(key);
  const r = await env.DB.prepare("SELECT SUM(CASE WHEN " + MAX_SECS + " > 0 THEN (" + MAX_SECS + " + 59) / 60 ELSE 0 END) AS m, COUNT(*) AS n FROM app_calls WHERE client_id = ?1 AND test = 0 AND outcome NOT IN ('limited', 'spam') AND at >= ?2 AND at < ?3").bind(cid, from, to).first();
  return { minutes: +(r && r.m) || 0, calls: +(r && r.n) || 0 };
}
export async function includedFor(env, cid) {
  const b = await env.DB.prepare('SELECT max FROM billing WHERE client_id = ?1').bind(cid).first().catch(() => null);
  return INCLUDED_MIN * (1 + (b && +b.max ? 1 : 0));
}
// The minutes a client had in a month. A month counts at 600 when the add-on was on at any point in it (marked by the
// 10-minute job, and by Stripe's event when it changes); a month that has passed is never judged by today's add-on
// (Nov 10: dropping it before the 2nd billed 500 of 600 as overage; buying it on the 1st wiped out October's).
export async function noteAddon(env, cid, on, now) {
  await ensureMinutes(env);
  const key = monthKey(now), at = new Date(now).toISOString();
  const mark = (m, k) => env.DB.prepare('INSERT OR IGNORE INTO minute_marks (client_id, month, mark, at) VALUES (?1, ?2, ?3, ?4)').bind(cid, m, k, at).run();
  if (on) { await mark(key, 'added'); await mark(key, 'max600'); return; }
  // dropped: they had it this month, and through the end of last month, unless last month is already billed
  await mark(key, 'max600');
  const last = monthKey(Date.parse(monthRange(key).from) - DAY);
  const billed = await env.DB.prepare('SELECT 1 AS x FROM minute_overage WHERE client_id = ?1 AND month = ?2').bind(cid, last).first().catch(() => null);
  if (!billed) await mark(last, 'max600');
}
async function includedIn(env, cid, month, now) {
  const has = k => env.DB.prepare('SELECT 1 AS x FROM minute_marks WHERE client_id = ?1 AND month = ?2 AND mark = ?3').bind(cid, month, k).first().catch(() => null);
  if (await has('max600')) {
    // a mark from the add-on bought this month (not last) does not reach back
    return INCLUDED_MIN * 2;
  }
  const b = await env.DB.prepare('SELECT max FROM billing WHERE client_id = ?1').bind(cid).first().catch(() => null);
  if (!(b && +b.max)) return INCLUDED_MIN;
  // on now: it counts for that month unless it was bought after the month ended
  const after = await env.DB.prepare("SELECT 1 AS x FROM minute_marks WHERE client_id = ?1 AND month > ?2 AND mark = 'added'").bind(cid, month).first().catch(() => null);
  return after ? INCLUDED_MIN : INCLUDED_MIN * 2;
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
    if (m.included > INCLUDED_MIN) await env.DB.prepare("INSERT OR IGNORE INTO minute_marks (client_id, month, mark, at) VALUES (?1, ?2, 'max600', ?3)").bind(c.client_id, key, new Date(now).toISOString()).run().catch(() => {});
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
      const u = await usedMinutes(env, c.client_id, last), included = await includedIn(env, c.client_id, last, now);
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
  const r = await env.DB.prepare("SELECT SUM(" + MAX_SECS + ") AS s, COUNT(*) AS n FROM app_calls WHERE number = ?1 AND at > ?2 AND outcome NOT IN ('limited')").bind(number, new Date((now || Date.now()) - DAY).toISOString()).first();
  return (+(r && r.s) || 0) >= DAY_MINUTE_CAP * 60;
}
