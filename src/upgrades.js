// Upgrades for you: every plan step and add-on this business doesn't have yet, each with a fit score (how useful it looks
// for this business) and the plain reasons behind it, worked out from the business's own last 30 days and its kind of work.
// It is a guide, not a promise: the score only moves on numbers we can see, and says so when we can't see much.
// Owner only. Nothing is sold here: "Ask about this" sends a note to the Always Open team.

const TRADES = /plumb|hvac|heat|air|roof|electr|build|remodel|contract|lawn|landscap|pest|pool|paint|clean|septic|tree|garage|handy|dock|marin|fence|concrete|pressure|gutter|floor|cabinet|deck|home/i;
const FOOD = /restaur|cafe|coffee|food|bakery|bar\b|pizza|grill|diner|catering/i;
const HEALTH = /dent|medic|clinic|chiro|vet|therap|doctor|optom|physio/i;
const INSURANCE = /insur/i;

const money = c => '$' + Math.round(c).toLocaleString('en-US');
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
const fit = n => Math.max(5, Math.min(95, Math.round(n / 5) * 5));

export const HOW = 'Each score is how useful this looks for your business, from your own numbers over the last 30 days and the kind of work you do. It is a guide, not a promise. When we can see little, the score stays modest and the reason says so.';

async function signals(env, c) {
  const cid = c.client_id, since = new Date(Date.now() - 30 * 864e5).toISOString();
  const one = async (sql, ...p) => { try { return (await env.DB.prepare(sql).bind(...p).first()) || {}; } catch (e) { return {}; } };
  const calls = await one("SELECT COUNT(*) AS n, SUM(CASE WHEN outcome IN ('hangup','failed') THEN 1 ELSE 0 END) AS missed, SUM(COALESCE(relay_seconds, seconds, 0)) AS secs FROM app_calls WHERE client_id = ?1 AND at > ?2 AND test = 0 AND outcome NOT IN ('live','spam')", cid, since);
  const reviews = await one("SELECT COUNT(*) AS n, SUM(CASE WHEN stars > 0 AND stars <= 2 THEN 1 ELSE 0 END) AS low FROM app_items WHERE client_id = ?1 AND kind NOT IN ('post','invoice','reviewreq') AND created > ?2", cid, since);
  const leads = await one('SELECT COUNT(*) AS n FROM app_leads WHERE client_id = ?1 AND at > ?2', cid, since);
  const unpaid = await one("SELECT COUNT(*) AS n, SUM(amount) AS s FROM app_invoices WHERE client_id = ?1 AND status = 'open'", cid);
  const quotes = await one("SELECT COUNT(*) AS n FROM biz_quotes WHERE client_id = ?1 AND status NOT IN ('accepted','paid','declined','void') AND created > ?2", cid, since);
  const fu = await one("SELECT COUNT(*) AS n FROM app_followups WHERE client_id = ?1 AND status = 'open'", cid);
  const line = await one('SELECT industry, facts, on_air FROM voice_lines WHERE client_id = ?1 ORDER BY number LIMIT 1', cid);
  const bill = await one('SELECT type FROM billing WHERE client_id = ?1', cid);
  let website = '';
  try { website = String((JSON.parse(line.facts || '{}') || {}).website || '').trim(); } catch (e) {}
  const kind = String(line.industry || bill.type || '');
  return {
    calls: +calls.n || 0, missed: +calls.missed || 0, minutes: Math.round((+calls.secs || 0) / 60),
    reviews: +reviews.n || 0, low: +reviews.low || 0, leads: +leads.n || 0,
    unpaidN: +unpaid.n || 0, unpaid: +unpaid.s || 0, quotes: (+quotes.n || 0) + (+fu.n || 0),
    hasLine: !!(line && +line.on_air), website, kind,
    trades: TRADES.test(kind), food: FOOD.test(kind), health: HEALTH.test(kind), insurance: INSURANCE.test(kind)
  };
}

// The rules, kept in one place so they can be read and tested. s = signals, c = client.
export function score(s, c) {
  const reg = !!+c.regulated, tier = c.tier || 'Starter', feats = String(c.feats || '');
  const out = [];
  const add = (o) => out.push(Object.assign(o, { fit: fit(o.fit) }));

  if (tier === 'Starter') {
    let f = reg ? 20 : 35; const why = [];
    if (reg) why.push('For regulated businesses, Growth adds competitor watch. Review requests and photo posts stay off, so there is less in it for you.');
    else {
      if (s.reviews <= 3) { f += 25; why.push('You got ' + plural(s.reviews, 'new review', 'new reviews') + ' in the last 30 days. Growth asks every customer after each job, by text or email.'); }
      else if (s.reviews <= 10) { f += 10; why.push('You got ' + s.reviews + ' new reviews in the last 30 days. Asking every customer after each job keeps that steady.'); }
      else why.push('You already got ' + s.reviews + ' new reviews in the last 30 days, so review requests add less for you.');
      if (s.calls >= 15) { f += 15; why.push('Max took ' + s.calls + ' calls in 30 days. That is steady work, and each finished job is a review and a post waiting to happen.'); }
      if (s.trades) { f += 10; why.push('Storm Desk is built for trades like yours: when a warning hits your county, a storm-day post is ready.'); }
    }
    add({ id: 'plan-growth', kind: 'plan', name: 'Growth plan', price: '$299 a month', what: 'Review requests after every job, posts from your photos, competitor watch and Storm Desk.', fit: f, why, ask: 'I’d like to hear about moving to the Growth plan.' });
  }
  if (tier !== 'Pro' && !reg) {
    let f = 25; const why = [];
    if (s.unpaid > 0) { f += 20; why.push(money(s.unpaid) + ' is waiting in ' + plural(s.unpaidN, 'unpaid invoice', 'unpaid invoices') + '. Pro reminds you on the day you pick, with the text already written.'); }
    if (s.missed >= 3) { f += 20; why.push(plural(s.missed, 'caller', 'callers') + ' hung up in the last 30 days. Pro texts them back from your number within seconds.'); }
    else if (s.missed > 0) { f += 8; why.push(plural(s.missed, 'caller', 'callers') + ' hung up in the last 30 days. Pro texts each one back within seconds.'); }
    if (s.quotes >= 2) { f += 15; why.push('You have ' + s.quotes + ' quotes or follow-ups open. Pro keeps each one from going quiet.'); }
    if (!why.length) why.push('We don’t see unpaid invoices, hang-ups or open quotes in your last 30 days, so Pro’s extras would get little use right now.');
    if (tier === 'Starter') { f += 5; why.push('Includes everything in Growth.'); }
    add({ id: 'plan-pro', kind: 'plan', name: 'Pro plan', price: '$499 a month', what: 'Follow-up reminders for quotes, invoices and appointments, and missed-call text-back from your own number.', fit: f, why, ask: 'I’d like to hear about moving to the Pro plan.' });
  }
  if (s.hasLine) {
    const used = s.minutes / 300, why = ['You used ' + s.minutes + ' of your 300 Max minutes in the last 30 days.'];
    let f = used >= 0.85 ? 90 : used >= 0.6 ? 60 : used >= 0.4 ? 35 : 10;
    why.push(used >= 0.85 ? 'You are close to the limit. Past it, minutes cost 25¢ each, so 300 more for $149 is the cheaper way.' : used >= 0.6 ? 'Worth watching. If a busy month comes, you would run past 300.' : 'You have plenty of room, so you don’t need more right now.');
    add({ id: 'addon-minutes', kind: 'addon', name: 'More Max minutes', price: '$149 a month for 300 more', what: 'Another 300 minutes a month of Max answering the calls you can’t.', fit: f, why, ask: 'I’d like to hear about more Max minutes.' });
  }
  {
    let f = 30; const why = [];
    if (s.calls < 10) { f += 20; why.push('Max took ' + plural(s.calls, 'call', 'calls') + ' in 30 days. If you have room for more work, ads put you in front of people searching right now.'); }
    else if (s.calls >= 40) { f -= 10; why.push('You are already busy: ' + s.calls + ' calls in 30 days. Ads matter most when you want more than you are getting.'); }
    else why.push('Max took ' + s.calls + ' calls in 30 days. Ads help if you want more of a certain kind of job or more towns.');
    why.push('You pay Google for the ads directly, so the ad money never passes through us.');
    add({ id: 'addon-ads', kind: 'addon', name: 'Google Ads management', price: '$299 a month, or 15% of ad spend if higher', what: 'We set up and run your Google Ads and report the results each month.', fit: Math.min(f, 70), why, ask: 'I’d like to hear about Google Ads management.' });
  }
  if (!s.website) add({ id: 'addon-website', kind: 'addon', name: 'A new website', price: '$799 once, then $29 a month', what: 'A fast site of up to five pages, built for phones, with a request form that reaches you right away.', fit: 80, why: ['We don’t have a website on file for you. If you have one, tell us and this score drops.', 'The site comes with a request form that lands in this app.'], ask: 'I’d like to hear about a new website.' });
  else add({ id: 'addon-website', kind: 'addon', name: 'A new website', price: '$799 once, then $29 a month', what: 'A fast site of up to five pages, built for phones, with a request form that reaches you right away.', fit: 15, why: ['You already have a website (' + s.website.replace(/^https?:\/\//, '').slice(0, 40) + '). Only worth it if it is old or hard to use on a phone.'], ask: 'I’d like to hear about a new website.' });
  {
    let f = s.website ? 35 : 10; const why = [];
    if (!s.website) why.push('Chat goes on a website, so it needs one first.');
    else {
      why.push('A chat box on your site sends questions to your phone.');
      if (s.leads >= 5) { f += 15; why.push(s.leads + ' people sent requests through your booking page in 30 days. Chat catches the ones who would rather ask first.'); }
    }
    add({ id: 'addon-chat', kind: 'addon', name: 'Website chat', price: '$49 a month', what: 'Visitors ask a question on your site and you answer from your phone.', fit: f, why, ask: 'I’d like to hear about website chat.' });
  }
  add({ id: 'addon-hiring', kind: 'addon', name: 'Help-wanted posts', price: '$99 a month', what: 'We write your job openings and post them on Google, Indeed and Facebook.', fit: 20, why: ['Nothing in your account tells us whether you are hiring. If you are, this saves writing and posting the ads.'], ask: 'I’d like to hear about help-wanted posts.' });
  {
    const f = s.food ? 65 : s.trades ? 55 : s.health ? 45 : s.insurance ? 35 : 40;
    const where = s.food ? 'Yelp and Facebook' : s.trades ? 'Angi, Nextdoor and Yelp' : s.insurance ? 'Facebook and the BBB' : 'Facebook, Yelp and the BBB';
    add({ id: 'addon-alerts', kind: 'addon', name: 'Review alerts beyond Google', price: '$49 a month', what: 'We watch Facebook, Yelp, the BBB, Angi and Nextdoor and draft a reply to every new review.', fit: f, why: ['Customers of ' + (s.kind ? 'businesses like yours' : 'most businesses') + ' also leave reviews on ' + where + '.', 'Right now we only answer your Google reviews.'], ask: 'I’d like to hear about review alerts beyond Google.' });
  }
  return out.filter(u => !(feats && feats.split(',').map(x => x.trim()).includes(u.id))).sort((a, b) => b.fit - a.fit);
}

export async function upgradesState(env, c) {
  if (c.staff) return null;
  const s = await signals(env, c);
  return { list: score(s, c), how: HOW };
}
