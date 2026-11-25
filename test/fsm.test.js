// Jobber and Housecall Pro (Nov 25, 2026): the visits Max books go straight in. Jobber connects by its own sign-in, bound
// to the browser that started it; Housecall Pro by the owner's API key. A push that fails is tried again, then reaches
// Christopher; a sign-in that stops working asks the owner to reconnect. Nothing in their account is ever changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createHash } from 'node:crypto';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const V = await import('../src/voice.js');
const F = await import('../src/fsm.js');
const CB = await import('../src/callbacks.js');
const { default: worker } = await import('../src/index.js');
const LINE = '+14785551001', CODE = 'z'.repeat(32);
const sidOf = n => 'CA' + String(n).padStart(32, '0');

// Jobber and Housecall Pro, faked: what they were asked, and what they answer
function services() {
  const t = { jobber: [], hcp: [], jobberClients: [], hcpCustomers: [], fail: {} , n: 0 };
  t.handle = async (url, init) => {
    const u = new URL(String(url)), method = (init && init.method) || 'GET', body = init && init.body ? String(init.body) : '';
    const json = (o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: { 'content-type': 'application/json' } });
    if (u.hostname === 'api.getjobber.com') {
      if (u.pathname === '/api/oauth/token') {
        const f = new URLSearchParams(body); t.jobber.push({ token: Object.fromEntries(f) });
        if (t.fail.refresh && f.get('grant_type') === 'refresh_token') return json({ error: 'invalid_grant' }, 400);
        return json({ access_token: 'acc-' + (++t.n), refresh_token: 'ref-' + t.n, expires_in: 3600 });
      }
      const q = JSON.parse(body).query, auth = (init.headers || {}).authorization;
      t.jobber.push({ q, auth, version: (init.headers || {})['X-JOBBER-GRAPHQL-VERSION'] });
      if (t.fail.jobber401) return json({ message: 'unauthorized' }, 401);
      if (t.fail.jobber500) { t.fail.jobber500--; return json({ message: 'down' }, 500); }
      if (/account \{ id name \}/.test(q)) return json({ data: { account: { id: 'A1', name: 'Sinclair Plumbing LLC' } } });
      if (/clients\(first: 10, searchTerm/.test(q)) return json({ data: { clients: { nodes: t.jobberClients } } });
      if (/clientCreate/.test(q)) return json({ data: { clientCreate: { client: { id: 'CL9' }, userErrors: [] } } });
      if (/requestCreate/.test(q)) {
        if (/assessment/.test(q) && t.fail.assessment) return json({ data: { requestCreate: { request: null, userErrors: [{ message: 'Assessment needs a property' }] } } });
        return json({ data: { requestCreate: { request: { id: 'RQ1' }, userErrors: [] } } });
      }
      if (/appDisconnect/.test(q)) return json({ data: { appDisconnect: { app: { name: 'Always Open' }, userErrors: [] } } });
      return json({ errors: [{ message: 'unknown' }] });
    }
    if (u.hostname === 'api.housecallpro.com') {
      const auth = (init.headers || {}).authorization;
      t.hcp.push({ method, path: u.pathname + u.search, auth, body: body ? JSON.parse(body) : null });
      if (auth !== 'Token ' + 'k'.repeat(32)) return json({ message: 'Unauthorized' }, 401);
      if (u.pathname === '/company') return json({ id: 'co1', name: 'Quillen Plumbing' });
      if (u.pathname === '/customers' && method === 'GET') return json({ customers: t.hcpCustomers });
      if (u.pathname === '/customers' && method === 'POST') return json({ id: 'cus_new', addresses: [] }, 201);
      if (u.pathname === '/jobs') return json({ id: 'job_1' }, 201);
      if (/^\/jobs\/job_1\/notes$/.test(u.pathname)) return json({ id: 'note_1' }, 201);
      if (u.pathname === '/leads') return json({ id: 'lead_1' }, 201);
      return json({ message: 'not found' }, 404);
    }
    return null;
  };
  return t;
}

async function mk(extra) {
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB, Object.assign({ JOBBER_CLIENT_ID: 'jid', JOBBER_CLIENT_SECRET: 'jsecret' }, extra || {}));
  H.installFetch(world, env);
  const svc = services(), base = globalThis.fetch;
  globalThis.fetch = async (u, i) => (await svc.handle(u, i)) || base(u, i);
  env.CALLROOM = H.makeNamespace(V.CallRoom, env);
  await CB.ensureLineTz(env);
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, review_link, tier) VALUES ('c1', ?1, 'Quillen Plumbing', 1, '', 'Pro')").bind(createHash('sha256').update(CODE).digest('hex')).run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, updated, tz) VALUES (?1, 'c1', 'Quillen Plumbing', 1, 'plumbing', 'Eatonton, GA', '2026-10-01', 'America/New_York')").bind(LINE).run();
  const site = H.makeClient(worker, env);
  const hook = (kind, params) => {
    const href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + env.VOICE_KEY;
    return site.call('/voice/' + kind + '/' + env.VOICE_KEY, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  };
  const room = async (sid, from) => {
    await hook('in', { CallSid: sid, To: LINE, From: from });
    env.CALLROOM.get(sid);
    const x = env.CALLROOM._rooms.get(sid);
    await x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'setup', callSid: sid, from }));
    return x;
  };
  const say = (x, words) => x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'prompt', voicePrompt: words, last: true }));
  return { world, DB, env, site, hook, room, say, svc };
}
// a booked call on the client's line, written up
async function bookedCall(w, n) {
  const sid = sidOf(n);
  const x = await w.room(sid, '+14785550142');
  w.world.aiScript = ['Sure, which works?'];
  await w.say(x, 'My water heater is leaking, can someone come out?');
  w.world.aiScript = ['Got you down. [BOOK 1 | Dana Reyes | water heater leak]'];
  await w.say(x, 'The first one. Dana Reyes.');
  w.world.aiNote = { name: 'Dana Reyes', callback: '+14785550142', reason: 'Water heater leaking', details: 'Gas water heater in the garage, 12 Oak St, Eatonton', when: '', urgent: false, callback_wanted: false, booked: 'yes', spam: false, summary: 'Dana Reyes has a gas water heater leaking in the garage.' };
  await w.hook('after', { CallSid: sid, SessionDuration: '60', SessionStatus: 'ended' }); await w.site.settle();
  return sid;
}

test('Jobber: connect only from the browser that started it, then a booked visit goes in as a request with the time on the calendar', async () => {
  const w = await mk();
  // the app's page: both choices
  const pg = await w.site.call('/app/' + CODE + '/booking-software');
  assert.equal(pg.status, 200);
  assert.match(pg.text, /Connect Jobber/); assert.match(pg.text, /Connect Housecall Pro/);
  // off to Jobber, with the state, PKCE and the cookie
  const go = await w.site.call('/app/' + CODE + '/booking-software?go=jobber');
  assert.equal(go.status, 302);
  const loc = new URL(go.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://api.getjobber.com/api/oauth/authorize');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://alwaysopenoffice.com/fsm/jobber/callback');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  const state = loc.searchParams.get('state'), cookie = go.headers.get('set-cookie').split(';')[0];
  assert.match(state, /^c1\.\d+\.[0-9a-f]{32}\.[0-9a-f]{32}$/);
  // finished in another browser: stopped, nothing connected, the code never used
  const away = await w.site.call('/fsm/jobber/callback?state=' + encodeURIComponent(state) + '&code=abc');
  assert.equal(away.status, 403);
  assert.equal(await w.DB.prepare('SELECT 1 FROM fsm_links').first(), null);
  assert.ok(!w.svc.jobber.some(x => x.token), 'the code was not spent');
  // the same browser: connected, tokens sealed
  const back = await w.site.call('/fsm/jobber/callback?state=' + encodeURIComponent(state) + '&code=abc', { headers: { cookie } });
  assert.equal(back.status, 200); assert.match(back.text, /Jobber connected/); assert.match(back.text, /Sinclair Plumbing LLC/);
  const tok = w.svc.jobber.find(x => x.token);
  assert.equal(tok.token.grant_type, 'authorization_code'); assert.ok(tok.token.code_verifier.length >= 43, 'PKCE verifier sent');
  const link = await w.DB.prepare('SELECT * FROM fsm_links WHERE client_id = ?1').bind('c1').first();
  assert.equal(link.kind, 'jobber'); assert.equal(link.status, 'on'); assert.equal(link.account, 'Sinclair Plumbing LLC');
  assert.match(link.secret, /^v1\./); assert.match(link.access, /^v1\./); assert.doesNotMatch(link.secret + link.access, /ref-|acc-/, 'never in plain text');
  // used twice: refused plainly
  assert.match((await w.site.call('/fsm/jobber/callback?state=' + encodeURIComponent(state) + '&code=abc', { headers: { cookie } })).text, /already used/);

  const sid = await bookedCall(w, 1);
  const q = w.svc.jobber.filter(x => x.q).map(x => x.q);
  assert.ok(q.some(x => /clients\(first: 10, searchTerm: "4785550142"\)/.test(x)), 'looked for the caller by phone');
  const made = q.find(x => /clientCreate/.test(x));
  assert.match(made, /firstName: "Dana", lastName: "Reyes", phones: \[\{ number: "4785550142", primary: true, description: MAIN \}\]/);
  const rq = q.find(x => /requestCreate/.test(x));
  assert.match(rq, /clientId: "CL9", title: "Water heater leaking \(\w+, \w+ \d+ at \d+(:\d\d)? (AM|PM), to confirm\)"/);
  assert.match(rq, /assessment: \{ instructions: "Penciled in by Max for [^"]*please confirm the time with them\.\\nUrgent\.\\nCaller: Dana Reyes, \(478\) 555-0142\.\\nDetails: Gas water heater in the garage, 12 Oak St, Eatonton/);
  assert.match(rq, /schedule: \{ startAt: "\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z", endAt: "/);
  assert.ok(w.svc.jobber.filter(x => x.q).every(x => x.version === '2025-04-16' && x.auth === 'Bearer acc-1'));
  const call = await w.DB.prepare('SELECT summary FROM app_calls WHERE id = ?1').bind(sid).first();
  assert.match(call.summary, /Sent to Jobber as a request\.$/);
  assert.equal((await w.DB.prepare('SELECT status, result FROM fsm_sync WHERE call_id = ?1').bind(sid).first()).status, 'sent');
  // a known caller is not added twice
  w.svc.jobberClients = [{ id: 'CL1', phones: [{ number: '(478) 555-0142' }] }];
  const before = w.svc.jobber.length;
  await bookedCall(w, 2);
  const q2 = w.svc.jobber.slice(before).filter(x => x.q).map(x => x.q);
  assert.ok(!q2.some(x => /clientCreate/.test(x)));
  assert.ok(q2.some(x => /requestCreate\(input: \{ clientId: "CL1"/.test(x)));
});

test('Jobber: an expired sign-in is renewed; a calendar rule it refuses still gets the request in; a dead sign-in asks the owner to reconnect', async () => {
  const w = await mk();
  const go = await w.site.call('/app/' + CODE + '/booking-software?go=jobber');
  const state = new URL(go.headers.get('location')).searchParams.get('state'), cookie = go.headers.get('set-cookie').split(';')[0];
  await w.site.call('/fsm/jobber/callback?state=' + encodeURIComponent(state) + '&code=abc', { headers: { cookie } });
  await w.DB.prepare('UPDATE fsm_links SET expires = 1').run();
  w.svc.fail.assessment = true;
  const sid = await bookedCall(w, 3);
  assert.ok(w.svc.jobber.some(x => x.token && x.token.grant_type === 'refresh_token' && x.token.refresh_token === 'ref-1'), 'renewed with the refresh token');
  const reqs = w.svc.jobber.filter(x => /requestCreate/.test(x.q || ''));
  assert.equal(reqs.length, 2); assert.doesNotMatch(reqs[1].q, /assessment/);
  assert.match((await w.DB.prepare('SELECT result FROM fsm_sync WHERE call_id = ?1').bind(sid).first()).result, /no visit on the calendar: Assessment needs a property/);
  assert.ok(+(await w.DB.prepare('SELECT expires FROM fsm_links').first()).expires > Date.now(), 'the new token is kept');
  // the sign-in dies: one try, the owner is asked to reconnect, Christopher hears, the call's note says so
  w.svc.fail.assessment = false; w.svc.fail.jobber401 = true;
  const pushes = w.world.pushes.length;
  const sid2 = await bookedCall(w, 4);
  assert.equal((await w.DB.prepare('SELECT status FROM fsm_links').first()).status, 'error');
  assert.match((await w.DB.prepare('SELECT summary FROM app_calls WHERE id = ?1').bind(sid2).first()).summary, /Could not reach Jobber: reconnect it in the app\.$/);
  assert.ok(w.world.pushes.slice(pushes).some(p => /fsm-push|Jobber push failed/.test(p.title + ' ' + (p.body || ''))), JSON.stringify(w.world.pushes.slice(pushes)));
  assert.match((await w.site.call('/app/' + CODE + '/booking-software')).text, /stopped accepting Max’s visits/);
});

test('Housecall Pro: the key is checked and sealed; a known customer with an address gets a job on the schedule, a new one a lead', async () => {
  const w = await mk({ JOBBER_CLIENT_ID: '', JOBBER_CLIENT_SECRET: '' });
  const pg = await w.site.call('/app/' + CODE + '/booking-software');
  assert.match(pg.text, /Being switched on\./, 'no Jobber app yet: said plainly');
  const bad = await w.site.call('/app/' + CODE + '/booking-software', { form: { action: 'hcp', key: 'w'.repeat(32) } });
  assert.match(bad.text, /didn’t accept that key/);
  const good = await w.site.call('/app/' + CODE + '/booking-software', { form: { action: 'hcp', key: 'Token ' + 'k'.repeat(32) } });
  assert.match(good.text, /Housecall Pro connected: Quillen Plumbing/);
  const link = await w.DB.prepare('SELECT * FROM fsm_links').first();
  assert.equal(link.kind, 'hcp'); assert.match(link.secret, /^v1\./); assert.doesNotMatch(link.secret, /kkkk/);
  // a customer Housecall Pro knows, with an address: a job at the booked time, and Max's note on it
  w.svc.hcpCustomers = [{ id: 'cus_1', mobile_number: '4785550142', addresses: [{ id: 'adr_1' }] }];
  const sid = await bookedCall(w, 5);
  const job = w.svc.hcp.find(x => x.path === '/jobs');
  assert.equal(job.body.customer_id, 'cus_1'); assert.equal(job.body.address_id, 'adr_1');
  assert.match(job.body.schedule.scheduled_start, /^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/);
  assert.match(w.svc.hcp.find(x => x.path === '/jobs/job_1/notes').body.content, /^Water heater leaking\nPenciled in by Max/);
  assert.match((await w.DB.prepare('SELECT summary FROM app_calls WHERE id = ?1').bind(sid).first()).summary, /Sent to Housecall Pro\.$/);
  // a new caller: added as a customer (no address yet), and a lead with the time in the customer's notes
  w.svc.hcpCustomers = [];
  const n = w.svc.hcp.length;
  const sid2 = await bookedCall(w, 6);
  const made = w.svc.hcp.slice(n).find(x => x.path === '/customers' && x.method === 'POST');
  assert.equal(made.body.first_name, 'Dana'); assert.equal(made.body.last_name, 'Reyes'); assert.equal(made.body.mobile_number, '4785550142');
  assert.equal(made.body.notifications_enabled, false, 'Housecall Pro sends the customer nothing on its own');
  assert.match(made.body.notes, /Penciled in by Max for/);
  assert.deepEqual(w.svc.hcp.slice(n).find(x => x.path === '/leads').body, { customer_id: 'cus_new' });
  assert.match((await w.DB.prepare('SELECT summary FROM app_calls WHERE id = ?1').bind(sid2).first()).summary, /Sent to Housecall Pro as a lead\.$/);
  assert.ok(!w.svc.hcp.some(x => x.method === 'PUT' || x.method === 'DELETE' || x.method === 'PATCH'), 'nothing of theirs is changed');
});

test('only booked visits unless the owner asks for every lead; a failed push is tried again, then reaches Christopher', async () => {
  const w = await mk();
  await F.hcpConnect(w.env, 'c1', 'k'.repeat(32), { fetch: globalThis.fetch });
  const call = { id: sidOf(70), client_id: 'c1', caller: '+14785550199', caller_name: '' };
  const note = { name: 'Sam', callback: '+14785550199', reason: 'Quote for a new water heater', details: '', urgent: false };
  assert.equal(await F.fsmPush(w.env, call, { note, summary: 'Sam wants a quote.', booked: null }), 'not sent');
  await w.DB.prepare('UPDATE fsm_links SET leads = 1').run();
  assert.equal(await F.fsmPush(w.env, call, { note, summary: 'Sam wants a quote.', booked: null }), 'sent');
  assert.ok(w.svc.hcp.some(x => x.path === '/leads'));
  // down for a while: tried again by the 10-minute job, then given up on after 3 tries, and Christopher hears
  await w.DB.prepare("DELETE FROM fsm_links").run();
  const go = await w.site.call('/app/' + CODE + '/booking-software?go=jobber');
  const state = new URL(go.headers.get('location')).searchParams.get('state'), cookie = go.headers.get('set-cookie').split(';')[0];
  await w.site.call('/fsm/jobber/callback?state=' + encodeURIComponent(state) + '&code=abc', { headers: { cookie } });
  await w.DB.prepare('UPDATE fsm_links SET leads = 1').run();
  w.svc.fail.jobber500 = 99;
  const alerts = [];
  const c2 = { id: sidOf(71), client_id: 'c1', caller: '+14785550198', caller_name: '' };
  assert.equal(await F.fsmPush(w.env, c2, { note: Object.assign({}, note, { callback: '+14785550198' }), summary: 'x', booked: null }, { alert: async (t, who, x) => alerts.push(x) }), 'retry');
  await F.fsmCron(w.env, { alert: async (t, who, x) => alerts.push(x) });
  assert.equal((await w.DB.prepare('SELECT status, tries FROM fsm_sync WHERE call_id = ?1').bind(c2.id).first()).status, 'retry');
  await F.fsmCron(w.env, { alert: async (t, who, x) => alerts.push(x) });
  const r = await w.DB.prepare('SELECT status, tries, error FROM fsm_sync WHERE call_id = ?1').bind(c2.id).first();
  assert.deepEqual([r.status, r.tries], ['failed', 3]);
  assert.equal(alerts.length, 1); assert.match(alerts[0], /^Jobber push failed for this client after 3 tries: Jobber: down/);
  // back up: a new call goes through on its first try
  w.svc.fail.jobber500 = 0;
  assert.equal(await F.fsmPush(w.env, { id: sidOf(72), client_id: 'c1', caller: '+14785550197' }, { note: Object.assign({}, note, { callback: '+14785550197' }), booked: null }), 'sent');
  // disconnecting tells Jobber and keeps nothing
  const off = await w.site.call('/app/' + CODE + '/booking-software', { form: { action: 'off' } });
  assert.match(off.text, /Disconnected/);
  assert.equal(await w.DB.prepare('SELECT 1 FROM fsm_links').first(), null);
  assert.ok(w.svc.jobber.some(x => /appDisconnect/.test(x.q || '')));
});

test('Max on our line says what is true: Housecall Pro now, Jobber once its app is set up', () => {
  assert.match(V.jobberAnswer({ fsm: 'hcp' }), /^Jobber's being added next/);
  assert.match(V.jobberAnswer({ fsm: 'jobber,hcp' }), /^Yes\. The visits I book go straight into Jobber/);
  assert.match(V.jobberAnswer({}), /Jobber doesn't connect/, 'before the first sync: the old, true answer');
});
