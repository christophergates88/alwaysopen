// The demo client's sample month. Everything here is fictional: names, 555-01xx numbers, reviews, rivals.
// The app labels every screen "Sample data" for this client, and the cron jobs that reach out (invoice reminders,
// competitor lookups, weekly emails) skip it, so nothing sample ever counts as real or leaves the system.
export const DEMO_ID = 'demo-plumbing';
export const isDemo = id => id === DEMO_ID;

const H = 3600e3, D = 24 * H;
const ph = n => '+1404555' + String(100 + n).padStart(4, '0').slice(-4); // +1404555 01xx

const CALLS = [
  // [daysAgo, hour, name, n, reason, details, wants, urgent, summary, status]
  [0, 7, 'Dana Whitfield', 1, 'No hot water', 'Water heater is cold since last night.', 'Today if possible', 1, 'Dana has no hot water since last night. She wants someone today and asked for a call back before noon.', 'new'],
  [1, 19, 'Marcus Bell', 2, 'Leaking faucet', 'Kitchen faucet drips constantly.', 'This week', 0, 'Marcus has a dripping kitchen faucet. Any weekday morning works for him.', 'new'],
  [1, 22, 'Priya Raman', 3, 'Clogged drain', 'Bathtub drains very slowly.', 'Tomorrow', 0, 'Priya’s tub drains slowly. She booked a visit for tomorrow morning.', 'handled'],
  [2, 12, 'Walt Greer', 4, 'Estimate', 'Replace 40-gallon water heater.', 'Next week', 0, 'Walt wants an estimate to replace a 40-gallon water heater. Next week is fine.', 'handled'],
  [3, 6, 'Tamika Dorsey', 5, 'Burst pipe', 'Pipe burst under the laundry sink.', 'Now', 1, 'Tamika has a burst pipe under the laundry sink and shut the water off. She needs someone now.', 'handled'],
  [3, 15, 'Ben Okafor', 6, 'Toilet running', 'Toilet runs all day.', 'Any day', 0, 'Ben’s toilet runs all day. He is flexible on timing.', 'handled'],
  [4, 18, 'Colleen Marsh', 7, 'Sump pump', 'Pump alarm going off in basement.', 'Today', 1, 'Colleen’s sump pump alarm is going off. She asked for a same-day call back.', 'handled'],
  [5, 9, 'Rudy Alvarez', 8, 'Garbage disposal', 'Disposal hums but will not spin.', 'This week', 0, 'Rudy’s disposal hums and will not spin. He wants a quote.', 'handled'],
  [6, 20, 'Hannah Pruitt', 9, 'New install', 'Wants a dishwasher hooked up.', 'Saturday', 0, 'Hannah bought a dishwasher and needs it hooked up Saturday.', 'handled'],
  [7, 11, 'Gerald Stone', 10, 'Low pressure', 'Shower pressure dropped.', 'Next week', 0, 'Gerald’s shower pressure dropped. He wants someone to take a look next week.', 'handled'],
  [8, 5, 'Nora Fields', 11, 'Outdoor spigot', 'Spigot froze and cracked.', 'This week', 0, 'Nora’s outdoor spigot cracked. She asked for the earliest visit.', 'handled'],
  [9, 14, 'Isaiah Tran', 12, 'Smell from drain', 'Sewer smell in basement.', 'This week', 0, 'Isaiah smells sewer gas in the basement. He asked for a call back with a time.', 'handled'],
  [10, 8, 'Lena Hoffman', 13, 'Estimate', 'Re-pipe two bathrooms.', 'Next month', 0, 'Lena wants an estimate to re-pipe two bathrooms. No rush.', 'handled'],
  [12, 17, 'Calvin Reeves', 14, 'Water heater', 'Pilot will not stay lit.', 'Tomorrow', 0, 'Calvin’s pilot light keeps going out. He booked tomorrow afternoon.', 'handled'],
  [13, 21, 'Mei Zhang', 15, 'Leak under sink', 'Small leak under bathroom sink.', 'This week', 0, 'Mei has a small leak under the bathroom sink and left her number.', 'handled'],
  [15, 10, 'Oscar Lindqvist', 16, 'Hose bib', 'Wants two hose bibs added.', 'Whenever', 0, 'Oscar wants two hose bibs added. No deadline.', 'handled'],
  [17, 13, 'Faith Okoye', 17, 'Toilet replacement', 'Replace an old toilet.', 'Next week', 0, 'Faith wants an old toilet replaced next week.', 'handled'],
  [19, 16, 'Dennis Hall', 18, 'Clogged kitchen sink', 'Kitchen sink backs up.', 'Today', 0, 'Dennis’s kitchen sink backs up. Someone went out the same day.', 'handled'],
  [22, 7, 'Vera Collins', 19, 'Tankless heater', 'Asked about a tankless heater.', 'This month', 0, 'Vera asked about a tankless heater and wants a quote this month.', 'handled'],
  [26, 19, 'Theo Park', 20, 'Frozen pipe', 'Pipe in crawlspace may be frozen.', 'Tonight', 1, 'Theo thinks a pipe froze in the crawlspace. He asked for a call back tonight.', 'handled']
];
const TALK = [
  ['ai', 'Thanks for calling Demo Plumbing. I’m Max, a phone assistant, and this call may be recorded. How can I help?'],
  ['caller', '{NAME_REASON}'],
  ['ai', 'Got it. What’s the best number to reach you?'],
  ['caller', 'This one is fine.'],
  ['ai', 'Thanks. I’ve passed that to the team and someone will call you back. Anything else?'],
  ['caller', 'No, that’s it.']
];
const REQUESTS = [
  [0, 'Allison Pierce', 31, 'Water softener installation quote'], [1, 'Jerome Wiley', 32, 'Bathroom remodel rough-in'], [2, 'Sofia Mendes', 33, 'Garbage disposal replacement'],
  [4, 'Harold Breck', 34, 'Annual water heater flush'], [6, 'Naomi Frost', 35, 'Kitchen faucet replacement'], [9, 'Quinn Abbott', 36, 'Shower valve leaking'],
  [13, 'Ruth Calloway', 37, 'Gas line for new range'], [18, 'Leo Santangelo', 38, 'Backflow test']
];
const BOOKINGS = [
  [1, 'Priya Raman', 3, 'Tue 9:00 AM · Clogged tub drain'], [2, 'Calvin Reeves', 14, 'Wed 2:00 PM · Water heater pilot'], [5, 'Hannah Pruitt', 9, 'Sat 10:00 AM · Dishwasher hookup'],
  [8, 'Dennis Hall', 18, 'Mon 8:00 AM · Kitchen sink'], [14, 'Nora Fields', 11, 'Thu 1:00 PM · Spigot repair']
];
const REVIEWS = [
  // [daysAgo, name, stars, text, reply]
  [1, 'Karen M.', 5, 'Called at 7 PM and left a message with the phone assistant. Someone called back within the hour and fixed our leak the next morning. Great service and fair price.', 'Thank you, Karen. We are glad the leak is fixed and that the call back came quickly. We appreciate you trusting us with your home.'],
  [2, 'Doug R.', 5, 'On time, clean work, explained everything. Replaced our water heater in one afternoon.', 'Thanks, Doug. A same-day water heater swap is what we aim for, and we appreciate the kind words.'],
  [4, 'Shannon T.', 4, 'Good work on the drain. Took a little longer than quoted, but the tech was polite and cleaned up.', 'Thank you for the honest note, Shannon. Sorry the visit ran past the quote. We will take that feedback to the team.'],
  [5, 'Pete L.', 5, 'Best plumber we have used. Fair price and no surprises.', 'Thank you, Pete. We appreciate it and are here whenever you need us.'],
  [7, 'Alicia B.', 2, 'Had to wait two days for a callback about a quote. Work was fine once they came.', 'Alicia, you are right that two days is too long to wait. Thank you for telling us. We will look at how quotes get answered, and please call us directly if anything else comes up.'],
  [9, 'Greg H.', 5, 'Fixed a burst pipe on a Sunday. Lifesaver.', 'Thank you, Greg. We are glad we could get there on a Sunday.'],
  [11, 'Tonya W.', 5, 'The tech explained what was wrong and what it would cost before starting. Appreciated that.', 'Thank you, Tonya. Telling you the price first is how we like to work.'],
  [14, 'Mark S.', 4, 'Solid job on our new faucets. Would use again.', 'Thanks, Mark. We appreciate you choosing us for the new faucets.'],
  [17, 'Jill A.', 5, 'Friendly and fast. Cleared our main line and showed us how to avoid it next time.', 'Thank you, Jill. We are happy the main line is clear.'],
  [20, 'Raymond K.', 3, 'The repair worked, but scheduling took a few tries.', 'Thank you, Raymond. We are sorry the scheduling took a few tries. We would like to make that smoother.'],
  [24, 'Beth N.', 5, 'Called after hours, got a real answer, and a visit booked for first thing. Impressed.', 'Thank you, Beth. We are glad your call was answered and the visit was set up.'],
  [27, 'Carl D.', 5, 'Honest about what needed fixing and what did not. Will recommend.', 'Thank you, Carl. We only fix what needs fixing, and we appreciate the recommendation.']
];
const RIVALS = [
  ['DEMO_RIVAL_ME_0001', 'Demo Plumbing (you)', 1, 4.7, 52, 4.7, 40], ['DEMO_RIVAL_A_0001', 'Riverbend Plumbing (sample)', 0, 4.8, 211, 4.8, 203],
  ['DEMO_RIVAL_B_0001', 'Hollis & Sons Plumbing (sample)', 0, 4.5, 148, 4.5, 146], ['DEMO_RIVAL_C_0001', 'Clearwater Drain Co. (sample)', 0, 4.2, 91, 4.2, 91],
  ['DEMO_RIVAL_D_0001', 'Oakline Plumbing (sample)', 0, 4.9, 64, 4.9, 57]
];

export async function seedDemo(env, mods, now) {
  now = now || Date.now();
  const { ensureBiz, ensureInvoices, ensureRivals, ensureReviews, isoWeek } = mods;
  const c = await env.DB.prepare('SELECT * FROM app_clients WHERE client_id = ?1').bind(DEMO_ID).first();
  if (!c) return { ok: false, error: 'There is no ' + DEMO_ID + ' client yet.' };
  await ensureBiz(env); await ensureInvoices(env); await ensureRivals(env); await ensureReviews(env);
  const cid = DEMO_ID;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_settings (client_id TEXT PRIMARY KEY, avg_job INTEGER DEFAULT 0, win_rate INTEGER DEFAULT 30, updated TEXT)').run();
  const iso = ms => new Date(ms).toISOString();
  const ago = (d, h) => { const t = new Date(now - d * D); t.setUTCHours(h == null ? 15 : h, (d * 7) % 60, 0, 0); return t.getTime() > now ? now - H : t.getTime(); };
  // wipe the old sample, then lay it down again
  for (const [t, col] of [['app_calls', 'client_id'], ['app_items', 'client_id'], ['app_leads', 'client_id'], ['biz_jobs', 'client_id'], ['biz_quotes', 'client_id'], ['app_invoices', 'client_id'],
    ['biz_msgs', 'client_id'], ['biz_insights', 'client_id'], ['app_months', 'client_id'], ['rival_snap', 'client_id'], ['rival_list', 'client_id'], ['rival_profile', 'client_id'], ['voice_lines', 'client_id'], ['app_settings', 'client_id']]) {
    try { await env.DB.prepare('DELETE FROM ' + t + ' WHERE ' + col + ' = ?1').bind(cid).run(); } catch (e) { /* table not made yet */ }
  }
  const st = [];
  // Tier and features so every part of the app shows. The sign-in code is not touched.
  st.push(env.DB.prepare("UPDATE app_clients SET tier = 'Pro', feats = 'calls,followups,textback', business = CASE WHEN business = '' THEN 'Demo Plumbing' ELSE business END, updated = ?1 WHERE client_id = ?2").bind(iso(now), cid));
  const line = '+14045550100';
  st.push(env.DB.prepare("INSERT OR REPLACE INTO voice_lines (number, client_id, business, on_air, regulated, industry, town, facts, transfer_to, transfer_when, spanish, updated, owner_set) VALUES (?1, ?2, ?3, 1, 0, 'plumbing', 'Sampleton', '{}', '', 'never', 0, ?4, '{}')").bind(line, cid, c.business || 'Demo Plumbing', iso(now)));
  st.push(env.DB.prepare('INSERT OR REPLACE INTO app_settings (client_id, avg_job, win_rate, updated) VALUES (?1, 380, 40, ?2)').bind(cid, iso(now)));
  // 20 calls
  CALLS.forEach((r, i) => {
    const [d, h, name, n, reason, details, wants, urgent, summary, status] = r;
    const at = iso(ago(d, h)), who = ph(n);
    const tr = JSON.stringify(TALK.map((x, k) => ({ w: x[0], t: x[1].replace('{NAME_REASON}', 'Hi, this is ' + name + '. ' + details) })));
    st.push(env.DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, caller_name, reason, details, wants, callback, urgency, summary, transcript, lang, turns, seconds, relay_seconds, outcome, status, handled_by, handled_at, notified, hq_synced, test) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?5,?10,?11,?12,'en-US',6,75,75,'done',?13,?14,?15,1,1,0)")
      .bind('CADEMO' + String(i + 1).padStart(28, '0'), cid, line, at, who, name, reason, details, wants, urgent ? 'urgent' : '', summary, tr, status, status === 'handled' ? 'Sample owner' : '', status === 'handled' ? iso(ago(d, h) + 2 * H) : ''));
  });
  // 8 requests and 5 bookings
  REQUESTS.forEach(r => st.push(env.DB.prepare("INSERT INTO app_leads (client_id, at, name, phone, need, sms_ok, status, done_at, ip_hash) VALUES (?1,?2,?3,?4,?5,0,?6,?7,'')").bind(cid, iso(ago(r[0], 10)), r[1], ph(r[2]), r[3], r[0] > 5 ? 'done' : 'new', r[0] > 5 ? iso(ago(r[0] - 1, 11)) : null)));
  BOOKINGS.forEach(r => st.push(env.DB.prepare("INSERT INTO app_leads (client_id, at, name, phone, need, sms_ok, status, done_at, ip_hash) VALUES (?1,?2,?3,?4,?5,0,'done',?6,'')").bind(cid, iso(ago(r[0], 12)), r[1], ph(r[2]), 'Booked ' + r[3], iso(ago(r[0], 13)))));
  // 12 reviews with replies (the newest two still waiting for the owner's OK)
  REVIEWS.forEach((r, i) => {
    const waiting = i < 2, at = iso(ago(r[0], 16));
    st.push(env.DB.prepare("INSERT INTO app_items (id, client_id, kind, title, context, stars, text, status, decided_text, decided_at, decided_by, hq_synced, checked, created, updated, notified, photo) VALUES (?1,?2,'reply',?3,?4,?5,?6,?7,?8,?9,?10,1,1,?11,?11,1,'')")
      .bind('ITDEMO' + String(i + 1).padStart(26, '0'), cid, r[1], r[3], r[2], r[4], waiting ? 'pending' : 'approved', waiting ? null : r[4], waiting ? null : iso(ago(r[0], 18)), waiting ? null : 'Sample owner', at));
  });
  // 6 jobs across stages (the 5 bookings above are customers too; these are the jobs on the board)
  const JOBS = [['Walt Greer', 21, 'Replace 40-gallon water heater', 'new', 0, 1], ['Lena Hoffman', 13, 'Re-pipe two bathrooms', 'quoted', 640000, 3], ['Vera Collins', 19, 'Tankless heater', 'quoted', 520000, 6],
    ['Priya Raman', 3, 'Clogged tub drain', 'booked', 18500, 1], ['Dennis Hall', 18, 'Kitchen sink', 'done', 21000, 8], ['Tamika Dorsey', 5, 'Burst pipe repair', 'paid', 38500, 3]];
  JOBS.forEach((j, i) => st.push(env.DB.prepare("INSERT INTO biz_jobs (client_id, name, phone, email, title, stage, amount, source, source_id, quote_id, invoice_id, created, updated, by) VALUES (?1,?2,?3,'',?4,?5,?6,'demo',?7,0,0,?8,?8,'Sample owner')").bind(cid, j[0], ph(j[1]), j[2], j[3], j[4], 'demo' + i, iso(ago(j[5], 9)))));
  // 2 estimates
  st.push(env.DB.prepare("INSERT INTO biz_quotes (client_id, token, number, name, phone, email, items, tax_rate, notes, subtotal, tax, total, status, job_id, invoice_id, created, accepted_at, by) VALUES (?1,?2,'E-1001',?3,?4,'',?5,0,'Sample estimate. Not a real customer.',?6,0,?6,'open',0,0,?7,'','Sample owner')")
    .bind(cid, 'DEMOQUOTE' + '1'.padStart(15, '0'), 'Lena Hoffman', ph(13), JSON.stringify([{ d: 'Re-pipe two bathrooms (PEX), labor and materials', q: 1, p: 640000 }]), 640000, iso(ago(3, 9))));
  st.push(env.DB.prepare("INSERT INTO biz_quotes (client_id, token, number, name, phone, email, items, tax_rate, notes, subtotal, tax, total, status, job_id, invoice_id, created, accepted_at, by) VALUES (?1,?2,'E-1002',?3,?4,'',?5,0,'Sample estimate. Not a real customer.',?6,0,?6,'open',0,0,?7,'','Sample owner')")
    .bind(cid, 'DEMOQUOTE' + '2'.padStart(15, '0'), 'Vera Collins', ph(19), JSON.stringify([{ d: 'Tankless water heater, install', q: 1, p: 520000 }]), 520000, iso(ago(6, 9))));
  // 3 invoices (1 paid)
  [['I-2001', 'Dennis Hall', 18, 21000, 'open', 4], ['I-2002', 'Colleen Marsh', 7, 14500, 'open', 2], ['I-2003', 'Tamika Dorsey', 5, 38500, 'paid', 3]].forEach((v, i) => {
    st.push(env.DB.prepare("INSERT INTO app_invoices (client_id, token, number, name, phone, email, amount, due, pay_link, sms_ok, status, created, paid_at, reminded) VALUES (?1,?2,?3,?4,?5,'',?6,?7,'',0,?8,?9,?10,'')")
      .bind(cid, 'DEMOINV' + String(i + 1).padStart(17, '0'), v[0], v[1], ph(v[2]), v[3], iso(now + (10 - v[5]) * D).slice(0, 10), v[4], iso(ago(v[5] + 2, 9)), v[4] === 'paid' ? iso(ago(v[5] - 1, 14)) : ''));
  });
  // inbox
  [['Sunday', 'in', 'Hi, do you do water softeners?'], ['Sunday', 'out', 'We do. Want us to send over an estimate?'], ['Friday', 'in', 'Thanks for fixing the faucet!']].forEach((m, i) => {
    st.push(env.DB.prepare("INSERT INTO biz_msgs (client_id, channel, thread, name, text, dir, at, by, status, ext_id) VALUES (?1,'facebook',?2,?3,?4,?5,?6,?7,'done',?8)").bind(cid, 'demo-thread-' + (i < 2 ? 1 : 2), i < 2 ? 'Allison Pierce' : 'Mark S.', m[2], m[1], iso(ago(i < 2 ? 2 : 4, 11 + i)), m[1] === 'out' ? 'Sample owner' : '', 'demoext' + i));
  });
  // insights for the current month and two months of record
  const ym = d => iso(d).slice(0, 7);
  st.push(env.DB.prepare('INSERT INTO biz_insights (client_id, month, data, reviews, at) VALUES (?1,?2,?3,12,?4)').bind(cid, ym(now), JSON.stringify({
    praise: [{ theme: 'Fast response', count: 6 }, { theme: 'Fair, upfront pricing', count: 4 }, { theme: 'Clean, polite techs', count: 3 }, { theme: 'Answered after hours', count: 2 }],
    complaints: [{ theme: 'Slow quote callbacks', count: 2 }, { theme: 'Scheduling took tries', count: 1 }],
    summary: 'Customers praise how quickly the team responds and the upfront pricing. The one pattern to watch is how long quotes take to come back.' }), iso(now)));
  const m1 = new Date(now); m1.setUTCDate(1); m1.setUTCMonth(m1.getUTCMonth() - 1); const m2 = new Date(m1); m2.setUTCMonth(m2.getUTCMonth() - 1);
  [[m1, 'rating', 4.6, 9], [m2, 'rating', 4.5, 7]].forEach((x, i) => {
    st.push(env.DB.prepare('INSERT INTO app_months (client_id, month, data, hash, updated) VALUES (?1,?2,?3,?4,?5)').bind(cid, ym(x[0].getTime()), JSON.stringify({ label: x[0].toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) + ' (sample)', stats: { rating: x[2], count: x[3], replies: x[3], posts: 4 }, prev: null, note: 'Sample month. Every review got a reply you approved.' }), 'demo' + i, iso(now)));
  });
  // competitor watch: this week and last, no Google lookups
  const wk = isoWeek(now), wk0 = isoWeek(now - 7 * D);
  st.push(env.DB.prepare("INSERT OR REPLACE INTO rival_profile (client_id, place_id, name, ptype, lat, lng, found, tried, spent_week, spent, lock, updated) VALUES (?1,'DEMO_RIVAL_ME_0001','Demo Plumbing','plumber',33.0,-84.0,1,?2,'',0,'',?3)").bind(cid, wk, iso(now)));
  RIVALS.forEach(r => {
    if (!r[2]) st.push(env.DB.prepare("INSERT OR REPLACE INTO rival_list (client_id, place_id, name, active, custom, added) VALUES (?1,?2,?3,1,0,?4)").bind(cid, r[0], r[1], iso(now)));
    st.push(env.DB.prepare('INSERT OR REPLACE INTO rival_snap (client_id, week, place_id, name, own, rating, reviews, at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)').bind(cid, wk, r[0], r[1], r[2], r[3], r[4], iso(now)));
    st.push(env.DB.prepare('INSERT OR REPLACE INTO rival_snap (client_id, week, place_id, name, own, rating, reviews, at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)').bind(cid, wk0, r[0], r[1], r[2], r[5], r[6], iso(now - 7 * D)));
  });
  await env.DB.batch(st);
  return { ok: true, calls: CALLS.length, requests: REQUESTS.length, bookings: BOOKINGS.length, jobs: JOBS.length, invoices: 3, estimates: 2, reviews: REVIEWS.length };
}
