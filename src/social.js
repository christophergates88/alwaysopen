// Always Open's own Facebook and Instagram, on their own. Three posts a week (Monday, Wednesday and Friday, in the
// 10 AM hour Eastern): a branded card from public/social and a caption Claude writes from that week's real numbers,
// posted to the Always Open Page and its Instagram through the same connection owners use (extras.js).
// The Page is connected once from the ops board (/meta/connect?hq=<token>). Christopher is an admin of the Meta app, so
// that works before Meta's review; clients' Pages wait for the review (launch.js). Every post is logged in social_posts;
// a post that fails is one alert, and the next posting day tries again. Until the Page is connected, a reminder with the
// link goes to the phone every three days and nothing else happens.
import { metaPublish, metaReady } from './extras.js';
export const HQ = 'always-open';
const SITE = 'https://alwaysopenoffice.com';
const DAY = 864e5;
export const POST_DAYS = [1, 3, 5];   // Monday, Wednesday, Friday
export const POST_HOUR = 10;          // Eastern

// The rotation. Each theme has a card (public/social/<name>.jpg), what to tell Claude, and the caption used if Claude
// cannot answer, so a posting day never goes quiet. Numbers in a caption come only from what we measured.
export const THEMES = [
  { name: 'report', card: 'report.jpg', about: 'The monthly page. On the 2nd of every month, each business gets one page that shows what Always Open did: calls answered and when the phone rang, why callers did not book, reviews and how fast they got replies, three-day check-ins, follow-ups, and what after-hours calls were worth. It prints on one page and can be forwarded. A full sample is at alwaysopenoffice.com/sample-report. Do not invent numbers.',
    fallback: 'On the 2nd of every month, every business we work for gets one page: calls answered and when the phone rang, reviews replied to, three-day check-ins, follow-ups, and what it was all worth. See a sample: alwaysopenoffice.com/sample-report' },
  { name: 'office', card: 'office.jpg', about: 'What Always Open is: the back side of a small business, run for the owner. Calls answered day and night, every review replied to, quotes and invoices followed up, open days filled from past customers who are due, the Google listing kept current, and a network of member businesses that send each other work. Max is the voice on the phone; the rest is a team working while the owner works. The owner approves everything from their phone.',
    fallback: 'We run the back side of your business: calls answered day and night, every review replied to, quotes and invoices followed up, open days filled from your own customer list, and your Google listing kept current. You approve it all from your phone. alwaysopenoffice.com' },
  { name: 'checkin', card: 'checkin.jpg', about: 'The three-day check-in. Three days after a job, Max calls the customer to ask whether the work held up. Pressing 1 turns into a review request; pressing 2 reaches the owner first, so they can fix it before it becomes a bad review.',
    fallback: 'Three days after the job, Max calls your customer: did it hold up? A yes turns into a review request. A no comes straight to you, so you can make it right before it turns into a one-star review. alwaysopenoffice.com' },
  { name: 'missed', card: 'missed.jpg', about: 'The call the business missed. Most callers who reach voicemail hang up and call the next name on Google. Max answers every call, day or night, and texts the owner the lead.',
    fallback: 'Most callers who get voicemail don’t leave a message. They call the next name on Google. Max picks up every call to your business, day or night, and texts you who called and what they need. alwaysopenoffice.com' },
  { name: 'grade', card: 'grade.jpg', about: 'The free grade: type a business name and town at alwaysopenoffice.com and the grade shows in a few seconds (reviews, Google profile, hours, website). No sign-up.',
    fallback: 'How does your business look to someone searching Google right now? Type your business name and town at alwaysopenoffice.com and your grade shows up in a few seconds. Free, no sign-up, no call from us.' },
  { name: 'fillweek', card: 'fillweek.jpg', about: 'Fill my week. When a day on the owner\'s calendar is wide open, past customers who are due for service, and said yes to texts, get offered the open time by text. The first yes is booked on the calendar.',
    fallback: 'Got a wide-open Thursday? Always Open texts past customers who are due for service, and said yes to texts, and offers them the time. The first yes goes on your calendar. alwaysopenoffice.com' },
  { name: 'caught', card: 'caught.jpg', about: 'What Max caught this week for the businesses we work for. Use the numbers given, nothing else.',
    fallback: '' },   // only posted with real numbers; otherwise the next theme runs
  { name: 'storm', card: 'storm.jpg', about: 'Storm Desk. When the National Weather Service issues a warning for the business\'s county, a storm-day post is drafted that minute. The owner approves it from their phone and it goes up on their Google profile while people are searching.',
    fallback: 'When a storm warning hits your county, Always Open drafts a storm-day post for your business that same minute. Approve it from wherever you are, and it goes up on your Google profile while people are searching. alwaysopenoffice.com' },
  { name: 'tip', card: 'tip.jpg', about: 'One practical tip for a small business owner, given below. Just the tip, in plain words, and one line on how Always Open does it for them.',
    fallback: 'Reply to every review within a day, the good ones too. People read the replies as closely as the reviews, and Google notices a business that answers. Always Open drafts every reply for you to approve from your phone. alwaysopenoffice.com' },
  { name: 'handoff', card: 'handoff.jpg', about: 'Hand-offs between businesses. When a caller needs work the business does not do, Max offers to put them through to a nearby business on Always Open, and that business can send work back.',
    fallback: 'A caller needs work you don\u2019t do? Max offers to put them through to a nearby business on Always Open, and theirs can send work back to you. The caller gets helped either way. alwaysopenoffice.com' },
  { name: 'local', card: 'local.jpg', about: 'Always Open is based in Lake Country, Georgia (Eatonton and Milledgeville) and works with businesses anywhere in the U.S. Everything is approved by the owner from their phone; nothing goes out in their name without their OK.',
    fallback: 'We’re a small company in Lake Country, Georgia, working for plumbers, HVAC companies, salons, agencies and shops anywhere in the U.S. Calls answered, reviews handled, jobs followed up. You approve it all from your phone. alwaysopenoffice.com' },
  { name: 'callback', card: 'callback.jpg', about: 'Call-backs with a time on them. Instead of "someone will call you," Max books a call-back time from the owner\'s calendar, and if it slips, calls the customer to set a new one.',
    fallback: 'No more \u201csomeone will call you back.\u201d Max books a real call-back time from your calendar, like 4:15 today. If it slips, he calls the customer to set a new one. alwaysopenoffice.com' },
  { name: 'max', card: 'max.jpg', about: 'Meet Max, the phone line. Anyone can call (706) 460-2226 right now and hear how Max answers for a business. Dare them to.',
    fallback: 'Want to hear what your callers would get? Call Max. We dare you. (706) 460-2226. He answers for businesses like yours day and night, takes the details, and texts the owner. alwaysopenoffice.com' },
  { name: 'assistants', card: 'assistants.jpg', about: 'What answer assistants say about the business. More customers ask an answer assistant who to call. Once a month Always Open asks them about each business it works for and fixes whatever they get wrong at the source, such as an old phone number on a listing site.',
    fallback: 'More customers ask an answer assistant on their phone who to call. Does it give the right number for your business? Once a month we ask them about you, and fix whatever they get wrong at the source. alwaysopenoffice.com' }
];
export const TIPS = [
  'Reply to every review within a day, the good ones too. People read the replies as closely as the reviews.',
  'Put your holiday hours on Google before the holiday, not after. "Closed" on the day costs you the callers who checked first.',
  'Your hours should match on Google, Facebook and your website. When they disagree, callers trust none of them.',
  'Ask for the review the day the job is done, by text, with the link. A week later the moment is gone.',
  'Call back a missed call within five minutes. After that, most people have already called someone else.',
  'Add one photo of real work to your Google profile every week. Profiles with recent photos get more calls.',
  'Answer the phone with your business name. "Hello?" makes callers wonder if they dialed right.',
  'Text a quote the same day you give it. The follow-up two days later is where most quotes are won.'
];

const ready = new WeakSet();
async function ensure(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS social_posts (day TEXT PRIMARY KEY, at TEXT, theme TEXT, text TEXT, result TEXT)').run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS social_state (k TEXT PRIMARY KEY, v TEXT DEFAULT '')").run();
  ready.add(env.DB);
}
export function eastern(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short' }).formatToParts(now).map(x => [x.type, x.value]));
  return { day: p.year + '-' + p.month + '-' + p.day, hour: +p.hour % 24, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

export async function connected(env) {
  if (!metaReady(env)) return null;
  try { return await env.DB.prepare('SELECT page_name, ig_id, connected_at FROM meta_pages WHERE client_id = ?1').bind(HQ).first(); } catch (e) { return null; }
}
// This week's real numbers across every real client: after-hours calls Max answered, leads, jobs booked.
export async function weekNumbers(env, now) {
  const from = new Date(now - 7 * DAY).toISOString();
  const q = async (sql, ...a) => { try { const r = await env.DB.prepare(sql).bind(...a).first(); return +(r && r.n) || 0; } catch (e) { return 0; } };
  return {
    calls: await q("SELECT COUNT(*) AS n FROM app_calls WHERE at >= ?1 AND test = 0 AND outcome NOT IN ('limited', 'spam') AND client_id NOT IN ('demo-plumbing', 'always-open')", from),
    after: await q("SELECT COUNT(*) AS n FROM app_calls WHERE at >= ?1 AND test = 0 AND outcome NOT IN ('limited', 'spam') AND client_id NOT IN ('demo-plumbing', 'always-open') AND (CAST(strftime('%w', at) AS INTEGER) IN (0, 6) OR CAST(strftime('%H', at) AS INTEGER) < 12 OR CAST(strftime('%H', at) AS INTEGER) >= 23)", from),   // outside 8 AM to 6 PM Eastern, erring short in both seasons
    leads: await q("SELECT COUNT(*) AS n FROM leads WHERE at >= ?1 AND status != 'spam'", from),
    booked: await q("SELECT COUNT(*) AS n FROM biz_jobs WHERE stage = 'booked' AND updated >= ?1 AND client_id != 'demo-plumbing'", from)
  };
}
// Which theme is next: the rotation by count of posts so far; 'caught' only with enough real calls to say something.
export function pickTheme(count, nums) {
  let t = THEMES[count % THEMES.length];
  if (t.name === 'caught' && !(nums && nums.calls >= 5)) t = THEMES[(count + 1) % THEMES.length];
  return t;
}
export function caughtFallback(n) {
  const w = (k, one, many) => k + ' ' + (k === 1 ? one : many);
  return 'This week Max answered ' + w(n.calls, 'call', 'calls') + ' for the businesses we work for' + (n.after ? ', ' + w(n.after, 'of them', 'of them') + ' after hours or on the weekend' : '') + (n.leads ? ', and passed on ' + w(n.leads, 'new lead', 'new leads') : '') + (n.booked ? ' with ' + w(n.booked, 'job booked', 'jobs booked') : '') + '. Every one of those callers heard a real answer instead of voicemail. alwaysopenoffice.com';
}

const SYS = 'You write the Facebook and Instagram caption for Always Open, a small company in Lake Country, Georgia that runs the back side of small businesses: it answers their phones (Max, its phone line, takes the call and texts the owner), replies to their reviews, keeps their Google profile current and follows up on jobs. It also calls customers three days after a job, offers open days to past customers, drafts storm-day posts, books call-backs at set times, passes callers to nearby member businesses and checks what AI assistants say about each business. The owner approves everything from their phone. ' +
  'Never use the word AI. Present Always Open as the whole back office, with Max as one part of it, not as an answering service. Return only the caption: two to four short sentences, plain words, warm and direct, written to a small business owner. No hype, no emoji, no hashtags, no exclamation marks, no quotes around it, no "we" claims that are not in the notes. Use only the numbers in the notes and say nothing about results we did not measure. End with alwaysopenoffice.com or, when the notes give it, the phone number.';
export async function writeCaption(env, theme, notes) {
  if (!env.ANTHROPIC_API_KEY) return '';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: Object.assign({ authorization: 'Bearer ' + env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, env.ANTHROPIC_WORKSPACE ? { 'anthropic-workspace': env.ANTHROPIC_WORKSPACE } : {}),
    body: JSON.stringify({ model: env.SOCIAL_MODEL || 'claude-sonnet-5-5', max_tokens: 300, system: SYS, messages: [{ role: 'user', content: 'Theme: ' + theme.about + '\n\nNotes:\n' + notes }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { try { await (await import('./funding.js')).claudeProblem(env, (j.error && j.error.message) || ''); } catch (e) {} return ''; }
  const t = (j.content || []).map(x => x.text || '').join('').trim().replace(/^"|"$/g, '');
  return t.length >= 40 && t.length <= 900 && !/#|[\u{1F300}-\u{1FAFF}]/u.test(t) ? t : '';
}

// h: { ping(title, body, priority, tags, click), alert(type, who, detail), boardToken() }
// opts.force: post now whatever the day and hour (the ops route), logged under the day and hour.
export async function socialCron(env, now, h, opts) {
  now = now || Date.now();
  if (!metaReady(env)) return { skipped: 'no keys' };
  await ensure(env);
  const pg = await connected(env);
  if (!pg) return opts && opts.force ? { skipped: 'not connected' } : remind(env, now, h);
  const e = eastern(now), force = !!(opts && opts.force);
  if (!force && (!POST_DAYS.includes(e.dow) || e.hour !== POST_HOUR)) return { skipped: 'not the hour' };
  const key = force ? e.day + 'T' + String(e.hour).padStart(2, '0') + 'x' + Math.floor(now / 60e3 % 60) : e.day;
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO social_posts (day, at, theme, text, result) VALUES (?1, ?2, '', '', 'working')").bind(key, new Date(now).toISOString()).run();
  if (!(ins.meta && ins.meta.changes)) return { skipped: 'done today' };
  const count = +((await env.DB.prepare("SELECT COUNT(*) AS n FROM social_posts WHERE result LIKE 'fb:ok%'").first()) || {}).n || 0;
  const nums = await weekNumbers(env, now);
  const theme = pickTheme(count, nums);
  let notes = '';
  if (theme.name === 'caught') notes = 'This week, across the businesses we work for: ' + nums.calls + ' calls answered by Max, ' + nums.after + ' of them after hours or on the weekend, ' + nums.leads + ' new leads passed to owners, ' + nums.booked + ' jobs booked.';
  else if (theme.name === 'tip') notes = 'The tip: ' + TIPS[Math.floor(count / THEMES.length) % TIPS.length];
  else if (theme.name === 'max') notes = 'The number to call: (706) 460-2226.';
  else notes = 'Website: alwaysopenoffice.com. Plans start at $149 a month; say that only if it fits naturally.';
  let text = '';
  try { text = await writeCaption(env, theme, notes); } catch (e) { text = ''; }
  const fell = !text;
  if (fell) text = theme.name === 'caught' ? caughtFallback(nums) : theme.fallback;
  let result;
  try { result = await metaPublish(env, HQ, text, SITE + '/social/' + theme.card); } catch (err) { result = 'error: ' + String((err && err.message) || err).slice(0, 160); }
  result = result + (fell ? ' (own words)' : '');
  await env.DB.prepare('UPDATE social_posts SET theme = ?1, text = ?2, result = ?3 WHERE day = ?4').bind(theme.name, text, result, key).run();
  if (!/^fb:ok/.test(result)) { if (h && h.alert) await h.alert('social', HQ, 'Today’s Always Open post (' + theme.name + ') did not go up: ' + result + '. The Page connection may need redoing from the ops board.'); }
  else if (h && h.ping) await h.ping('Posted to Facebook' + (/ig:ok/.test(result) ? ' and Instagram' : ''), text.slice(0, 180), 'low', 'speech_balloon');
  return { posted: /^fb:ok/.test(result), theme: theme.name, result };
}
// Until the Page is connected: the one-tap link to the phone, every three days.
async function remind(env, now, h) {
  const row = await env.DB.prepare("SELECT v FROM social_state WHERE k = 'asked'").first().catch(() => null);
  if (row && now - Date.parse(row.v) < 3 * DAY) return { skipped: 'not connected' };
  const t = h && h.boardToken ? await h.boardToken() : '';
  if (!t) return { skipped: 'not connected' };
  const link = SITE + '/meta/connect?hq=' + t;
  if (h.ping) await h.ping('Always Open: connect the Facebook Page (one time)', 'Tap here, sign in to Facebook as yourself, and pick the Always Open Page (and its Instagram). From then on three posts a week go up on their own. One time.', 'high', 'link', link);
  await env.DB.prepare("INSERT INTO social_state (k, v) VALUES ('asked', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(new Date(now).toISOString()).run();
  return { skipped: 'not connected', asked: true };
}
// One line for the ops board.
export async function socialLine(env) {
  if (!metaReady(env)) return 'keys not set yet';
  const pg = await connected(env);
  if (!pg) return 'the Always Open Page is not connected yet';
  await ensure(env);
  const last = await env.DB.prepare("SELECT day, theme, result FROM social_posts WHERE result != 'working' ORDER BY day DESC LIMIT 1").first().catch(() => null);
  return 'posting to ' + (pg.page_name || 'the Page') + (pg.ig_id ? ' and Instagram' : '') + ' Monday, Wednesday and Friday' + (last ? '; last: ' + last.day + ' (' + last.theme + ', ' + last.result + ')' : '; no post yet');
}
