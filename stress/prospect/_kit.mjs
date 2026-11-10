// Shared set-up for the "prospect" stress tests: a stranger on the public website.
// Every test builds a fresh world (fresh database, fresh fakes) with site(), so no test leans on another.
// Nothing here changes how the harness behaves: it only adds the two things test/sitefixes.test.js also adds
// (the postal address and the mail binding the audit emails go out through).
import { register } from 'node:module';
import { setTimeout as sleepTimer } from 'node:timers/promises';
register('../../test/rehearsal/hooks.mjs', import.meta.url);          // must come before importing src
export const H = await import('../../test/rehearsal/harness.js');
export const { default: worker } = await import('../../src/index.js');
export const { CallRoom } = await import('../../src/voice.js');
export const L = await import('../../src/leadmail.js');

export const ADDRESS = '103 W Sumter St, Eatonton, GA 31024';
// What Google Places answers for a plumber in Eatonton (the same listing test/sitefixes.test.js uses).
export const PLACE = { id: 'ChIJsinclair', displayName: { text: 'Sinclair Plumbing' }, formattedAddress: '12 Oak St, Eatonton, GA 31024, USA', rating: 4.3, userRatingCount: 31, primaryTypeDisplayName: { text: 'Plumber' }, businessStatus: 'OPERATIONAL', regularOpeningHours: { weekdayDescriptions: ['Mon 8-5'] }, photos: [] };

// A fresh site. s.out: every email sent to a lead (the SEND_MAIL binding). s.world.mail: every email to the operator.
export function site(extra) {
  const world = new H.World(), DB = H.makeDB(), out = [];
  const env = H.makeEnv(world, DB, Object.assign({ BUSINESS_ADDRESS: ADDRESS, SEND_MAIL: { send: async m => { out.push(m); } } }, extra || {}));
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(CallRoom, env);
  world.places = { places: [PLACE] };
  const client = H.makeClient(worker, env);
  const all = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results;
  const one = async (sql, ...a) => DB.prepare(sql).bind(...a).first();
  return { world, DB, env, out, client, all, one };
}
// The website form, filled in by a person who took a minute over it.
export const form = o => Object.assign({ name: 'Dana Whitfield', email: 'dana@example.com', phone: '', business: 'Sinclair Plumbing', town: 'Eatonton, GA', type: 'Contractor or trade', plan: 'Growth', t: String(Date.now() - 60000) }, o);
export const ask = (s, o, ip) => s.client.call('/lead', { form: form(o), headers: { accept: 'application/json' }, ip: ip || '198.51.100.20' });

// The operator's email, decoded (the harness keeps the raw message).
export function opMail(raw) {
  const m = /boundary="([^"]+)"/.exec(raw);
  const head = raw.split('\r\n\r\n')[0];
  if (!m) return { head, text: raw.split('\r\n\r\n').slice(1).join('\r\n\r\n'), html: '' };
  const parts = raw.split('--' + m[1]).slice(1, -1);
  const dec = p => Buffer.from(p.split('\r\n\r\n').slice(1).join('').replace(/\s+/g, ''), 'base64').toString('utf8');
  return { head, text: dec(parts[0]), html: dec(parts[1]) };
}
// Real waiting (the harness un-refs the worker's own timers; this one keeps the test alive).
export const sleep = ms => sleepTimer(ms);
// Pretend it is another moment. Returns the function that puts the real clock back.
export function clock(at) { const real = Date.now; Date.now = () => at; return () => { Date.now = real; }; }
