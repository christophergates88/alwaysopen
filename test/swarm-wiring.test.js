// Nov 24, 2026 swarm, wiring between the fixes: a client whose state cannot be read from the town gets a line on a
// guessed clock, and the operator is told once; a town with a state raises nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const C = await import('../src/callbacks.js');
const PA = await import('../src/plainalerts.js');

test('zoneGuess says when the zone is only a guess', () => {
  assert.deepEqual(C.zoneGuess({ town: 'Phoenix AZ 85001', phone: '(706) 555-0100' }), { tz: 'America/Phoenix', guessed: false });
  assert.equal(C.zoneGuess({ town: 'Eatonton', phone: '(706) 555-0100' }).guessed, true);
  assert.equal(C.zoneGuess({ town: '', phone: '' }).tz, 'America/New_York');
});

test('the new alerts have plain titles', () => {
  for (const k of ['zone-unknown|c1', 'audit-failed|7']) {
    const x = PA.explainAlert(k, 'detail');
    const title = Array.isArray(x) ? x[0] : (x && (x.title || x.what || x[0]));
    assert.ok(title && !/Something in Always Open needs a look/.test(String(title)), k + ' has its own title: ' + JSON.stringify(x).slice(0, 160));
  }
});

// The buyer's welcome page and Stripe's webhook arrive together. The one that loses the billing row can make the client
// (finishIfMissing) in the gap before the winner does; the winner's plain INSERT then threw on the unique ref, which
// for a buyer was an error page as the first screen after paying. Forced here by making the client row first.
test('the winner of the billing row does not throw when the other request already made the client', async () => {
  const B = await import('../src/billing.js');
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  const pushes = [];
  const h = { notify: async (t) => { pushes.push(t); }, later: () => {} };
  const s = { id: 'cs_test_race1', mode: 'subscription', payment_status: 'paid', customer: 'cus_1', subscription: 'sub_1', customer_email: 'dana@example.com',
    metadata: { plan: 'Growth', business: 'Race Roofing', owner: 'Dana Race', phone: '(478) 555-0144', town: 'Eatonton, GA', type: 'Contractor or trade' } };
  // the slip-in: whenever the client row is about to be written, another writer has already written one with the same ref
  const prep = DB.prepare.bind(DB);
  let slipped = false;
  DB.prepare = (sql) => {
    const st = prep(sql);
    if (!slipped && /INSERT (OR IGNORE )?INTO app_clients/.test(sql)) {
      const bind = st.bind.bind(st);
      st.bind = (...a) => { const b = bind(...a); const run = b.run.bind(b);
        b.run = async () => { slipped = true; await prep("INSERT OR IGNORE INTO app_clients (client_id, code_hash, ref, business, owner_first, regulated, banned, phone, review_link, tier, active, updated, qr, feats) VALUES (?1, 'x', ?2, 'Race Roofing', 'Dana', 0, '', '', '', 'Growth', 1, '', '', 'calls')").bind(a[0], a[2]).run(); return run(); };
        return b; };
    }
    return st;
  };
  const row = await B.createFromSession(env, s, h);
  assert.ok(row && row.client_id, 'the buyer still gets their account row');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM app_clients WHERE business = ?1').bind('Race Roofing').first()).n, 1, 'one client');
  assert.equal(pushes.filter(t => /New signup/.test(t)).length, 0, 'the other request announced it; this one does not announce twice');
});
