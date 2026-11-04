// Rate-Shock Radar helpers, kept pure so they can be tested: reading a town the way people type it ("Eatonton Georgia",
// "eatonton, ga 31024"), scoring one town's recent Google reviews, and choosing which towns get this week's lookups so
// every insurance client's town, anywhere in the U.S., is covered first. Nothing from Google is stored by any of this.

const CODES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' ');
const NAMES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', 'washington dc': 'DC', 'washington d.c.': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN',
  texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'puerto rico': 'PR',
  // the old abbreviations people still type
  ala: 'AL', ariz: 'AZ', ark: 'AR', calif: 'CA', colo: 'CO', conn: 'CT', fla: 'FL', ill: 'IL', ind: 'IN', kan: 'KS', kans: 'KS', ky: 'KY', mass: 'MA', mich: 'MI', minn: 'MN', miss: 'MS',
  mont: 'MT', neb: 'NE', nebr: 'NE', nev: 'NV', okla: 'OK', ore: 'OR', penn: 'PA', penna: 'PA', tenn: 'TN', tex: 'TX', wash: 'WA', wis: 'WI', wisc: 'WI', wyo: 'WY'
};
const BY_LENGTH = Object.keys(NAMES).sort((a, b) => b.length - a.length);
const titled = s => s.replace(/\b([a-z])([a-z']*)/g, (m, a, b) => a.toUpperCase() + b);

// "Town, ST" when a state can be read, the town alone when it can't, '' when there is nothing usable.
export function normTown(raw) {
  let s = String(raw || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/[\s,]*\b\d{5}(-\d{4})?\s*$/, '').replace(/[\s,.;]+$/, '').replace(/,?\s*(usa|u\.s\.a\.?|u\.s\.?|united states)$/i, '').trim();
  if (!s || s.length > 80 || !/[a-z]/i.test(s)) return '';
  const low = s.toLowerCase();
  let town = s, st = '';
  for (const n of BY_LENGTH) {
    if (low === n) break;   // "Georgia" alone is a state, not a town
    if (low.endsWith(n) && /[\s,]/.test(low.charAt(low.length - n.length - 1))) { st = NAMES[n]; town = s.slice(0, s.length - n.length); break; }
  }
  if (!st) {
    const m = /^(.*?)[\s,]+([A-Za-z]{2})\.?$/.exec(s);
    if (m && CODES.includes(m[2].toUpperCase())) { st = m[2].toUpperCase(); town = m[1]; }
  }
  town = town.replace(/[\s,.]+$/, '').trim();
  if (!town) return '';
  if (town === town.toLowerCase() || town === town.toUpperCase()) town = titled(town.toLowerCase());
  return st ? town + ', ' + st : town;
}
export const townKey = raw => normTown(raw).toLowerCase();

// A review "about rates" is an unhappy one that talks about rates, premiums, prices or a bill going up. A 5-star
// "great rates!" is a compliment, not a complaint, so it is never counted.
export const RATE_RE = /\b(rates?|premiums?|prices?|pricing|bill|billed|went up|goes up|going up|increase[ds]?|raised|doubled|expensive|afford)\b|tarifas?|primas?|precios?|aument|subi[oó]|caro\b/i;
export const aboutRates = (text, stars) => RATE_RE.test(String(text || '')) && !(+stars >= 4);

// One town's lookup, scored. places: what Google returned (up to 60 agencies, up to 5 reviews each).
export function scoreTown(places, now) {
  const cutoff = now - 30 * 864e5;
  let total = 0, wsum = 0, rate = 0, low = 0, recent = 0;
  for (const p of places || []) {
    const n = +p.userRatingCount || 0; total += n; wsum += (+p.rating || 0) * n;
    for (const rv of (p.reviews || [])) {
      const t = Date.parse(rv.publishTime || '');
      if (!t || t < cutoff) continue;
      recent++;
      const stars = +rv.rating || 0;
      if (stars && stars <= 2) low++;
      const txt = (rv.originalText && rv.originalText.text) || (rv.text && rv.text.text) || '';
      if (aboutRates(txt, stars)) rate++;
    }
  }
  const n = (places || []).length;
  // A wave: unhappy reviews about rates (more needed where there are more agencies to read), or low ratings making up
  // a real share of the recent reviews, not just two bad days in a big city.
  const byRate = rate >= Math.max(2, Math.ceil(n / 25));
  const byLow = recent >= 6 && low >= 2 && low / recent >= 0.25;
  return { places: n, total, avg: total ? Math.round(wsum / total * 100) / 100 : 0, recent, rate, low, wave: byRate || byLow, why: byRate ? 'rate' : byLow ? 'low' : '' };
}

// Which towns get this week's lookups: clients' own towns first, then the standing prospect list, one lookup each,
// within the week's budget. When there are more towns than the budget, the starting point moves each week so every
// town is still covered in turn. Extra pages (more agencies read) only with what is left over, clients' towns first.
export function planTowns(clientTowns, listTowns, budget, weekNo) {
  const seen = new Set(), clients = [], list = [];
  for (const [arr, out] of [[clientTowns, clients], [listTowns, list]]) for (const raw of arr || []) {
    const t = normTown(raw), k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k); out.push(t);
  }
  budget = Math.max(1, Math.floor(+budget || 0));
  const rotate = (a, n) => { if (a.length <= n) return a.slice(); const s = (Math.max(0, +weekNo || 0) * n) % a.length; return a.slice(s).concat(a.slice(0, s)).slice(0, n); };
  const mine = rotate(clients, budget);
  const theirs = rotate(list, Math.max(0, budget - mine.length));
  const towns = mine.map(t => ({ town: t, client: true })).concat(theirs.map(t => ({ town: t, client: false })));
  return { towns, extra: budget - towns.length, skipped: clients.length + list.length - towns.length };
}
