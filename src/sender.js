// One sender for the per-sender limits on the public forms. Nov 24, 2026: an IPv6 home line or $5 server owns a whole
// /64 (2^64 addresses) and can use a new one for every request, so a limit on the full address never stops it. The
// website form already folded a /64 into one sender; now every form does it through this one helper, so they agree.
// IPv4 comes back unchanged. Each caller still adds its own salt and does its own hashing.
export function senderKey(ip) {
  ip = String(ip || '').trim();
  if (!ip.includes(':')) return ip;
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (m) return m[1];
  const [h, t] = ip.split('%')[0].toLowerCase().split('::');
  const hg = h ? h.split(':') : [], tg = t !== undefined && t ? t.split(':') : [];
  return hg.concat(Array(Math.max(0, 8 - hg.length - tg.length)).fill('0'), tg).slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
