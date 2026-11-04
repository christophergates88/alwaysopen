// The one look for every Always Open email: a glowing 24-hour sign at the top, then only what the reader needs.
// Built so a person gets it in five seconds: the sign says the state, "Do this" says the one action, a few big numbers,
// one button. Everything else is optional and short. Every email goes out as HTML plus a plain-text copy.
//
//   const { html, text } = neonEmail({ tone: 'bad', sign: '2 THINGS', title: 'Need you today', doThis: ['Call Sam back'],
//     stats: [{ n: '41', label: 'calls' }], lines: [{ k: 'Max', v: 'took 9 bookings' }], button: { text: 'Open the app', url } });
//   const raw = rawEmail({ fromName: 'Always Open', from, to, subject }, text, html);
//
// tone: 'ok' (green neon, steady), 'bad' (red neon, needs you), 'info' (red brand neon, nothing wrong).
// Glow uses text-shadow and box-shadow where the mail app supports it (Apple Mail, iOS); elsewhere the bright tube colors,
// borders and dark panel still read as a lit sign.

const C = { paper: '#0F131B', card: '#171C27', panel: '#1F2533', line: '#262E40', ink: '#ECEEF3', slate: '#A3ACBF', red: '#FF6A5E', redDeep: '#E5372B', green: '#5CC9A4' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const NEON = "'Tilt Neon','Avenir Next',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const safeUrl = u => /^https:\/\//i.test(String(u || '')) ? String(u) : '';
const glowText = c => 'text-shadow:0 0 2px #fff,0 0 8px ' + c + ',0 0 18px ' + c + ',0 0 36px ' + c + ';';
const glowBox = c => 'box-shadow:0 0 8px ' + c + ',0 0 22px ' + c + '66,inset 0 0 14px ' + c + '44;';

export function neonEmail(o) {
  o = o || {};
  const tube = o.tone === 'ok' ? C.green : C.red;
  const sign = String(o.sign || (o.tone === 'ok' ? 'ALL GOOD' : 'OPEN 24 HOURS')).slice(0, 28);
  const doThis = (o.doThis || []).filter(Boolean).slice(0, 5);
  const stats = (o.stats || []).filter(s => s && s.n != null && s.n !== '').slice(0, 4);
  const lines = (o.lines || []).filter(Boolean).slice(0, 12);
  const btn = o.button && safeUrl(o.button.url) ? o.button : null;
  const note = o.note ? String(o.note) : '';

  const h = [];
  h.push('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">');
  h.push('<link href="https://fonts.googleapis.com/css2?family=Tilt+Neon&display=swap" rel="stylesheet"><title>' + esc(o.title || sign) + '</title></head>');
  h.push('<body style="margin:0;padding:0;background:' + C.paper + ';" bgcolor="' + C.paper + '">');
  if (o.preheader) h.push('<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + esc(o.preheader) + '</div>');
  h.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + C.paper + '" style="background:' + C.paper + ';"><tr><td align="center" style="padding:24px 12px;">');
  h.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:' + FONT + ';color:' + C.ink + ';">');

  // brand row
  h.push('<tr><td style="padding:0 4px 14px;font:700 15px ' + FONT + ';color:' + C.ink + ';"><span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:' + C.redDeep + ';vertical-align:-2px;margin-right:8px;box-shadow:0 0 8px ' + C.red + ';"></span>Always Open' + (o.who ? '<span style="color:' + C.slate + ';font-weight:400;"> &middot; ' + esc(o.who) + '</span>' : '') + '</td></tr>');

  // the sign
  h.push('<tr><td align="center" bgcolor="#0A0D13" style="background:#0A0D13;border:2px solid ' + tube + ';border-radius:18px;padding:26px 16px 22px;' + glowBox(tube) + '">');
  h.push('<div style="font:400 44px/1.05 ' + NEON + ';color:#FFFFFF;letter-spacing:1px;' + glowText(tube) + '">' + esc(sign) + '</div>');
  if (o.title) h.push('<div style="margin-top:10px;font:600 17px/1.35 ' + FONT + ';color:' + C.ink + ';">' + esc(o.title) + '</div>');
  h.push('</td></tr>');

  // do this
  if (doThis.length) {
    h.push('<tr><td style="padding:22px 2px 8px;font:400 22px ' + NEON + ';color:#FFFFFF;' + glowText(C.red) + '">Do this</td></tr>');
    doThis.forEach((d, i) => {
      h.push('<tr><td style="padding:0 0 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + C.card + '" style="background:' + C.card + ';border:1.5px solid ' + C.red + ';border-radius:14px;' + glowBox(C.red) + '"><tr>');
      h.push('<td width="34" valign="top" style="padding:14px 0 14px 14px;font:700 17px ' + FONT + ';color:' + C.red + ';">' + (i + 1) + '</td>');
      h.push('<td style="padding:14px 14px 14px 6px;font:600 16px/1.4 ' + FONT + ';color:' + C.ink + ';">' + esc(d) + '</td></tr></table></td></tr>');
    });
  }

  // big numbers
  if (stats.length) {
    const w = Math.floor(100 / stats.length);
    h.push('<tr><td style="padding:14px 0 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>');
    stats.forEach((s, i) => {
      const col = s.tone === 'bad' ? C.red : C.green;
      h.push('<td width="' + w + '%" valign="top" style="padding:' + (i ? '0 0 0 8px' : '0') + ';"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + C.card + '" style="background:' + C.card + ';border:1.5px solid ' + col + ';border-radius:14px;' + glowBox(col) + '"><tr><td align="center" style="padding:14px 6px;">');
      h.push('<div style="font:400 30px/1 ' + NEON + ';color:#FFFFFF;' + glowText(col) + '">' + esc(s.n) + '</div>');
      h.push('<div style="margin-top:6px;font:600 12px/1.3 ' + FONT + ';color:' + C.slate + ';">' + esc(s.label) + '</div></td></tr></table></td>');
    });
    h.push('</tr></table></td></tr>');
  }

  // short lines (label: value), never paragraphs
  if (lines.length) {
    h.push('<tr><td style="padding:14px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + C.card + '" style="background:' + C.card + ';border:1px solid ' + C.line + ';border-radius:14px;">');
    if (o.linesTitle) h.push('<tr><td colspan="2" style="padding:14px 16px 4px;font:400 19px ' + NEON + ';color:#FFFFFF;' + glowText(C.green) + '">' + esc(o.linesTitle) + '</td></tr>');
    lines.forEach((l, i) => {
      const k = typeof l === 'string' ? '' : l.k, v = typeof l === 'string' ? l : l.v;
      const mark = l && l.bad ? '<span style="color:' + C.red + ';">&#9679;</span> ' : (l && l.ok ? '<span style="color:' + C.green + ';">&#10003;</span> ' : '');
      const top = i ? 'border-top:1px solid ' + C.line + ';' : '';
      h.push('<tr>' + (k ? '<td valign="top" style="' + top + 'padding:11px 8px 11px 16px;font:600 14px/1.4 ' + FONT + ';color:' + C.slate + ';white-space:nowrap;">' + esc(k) + '</td>' : '') +
        '<td valign="top"' + (k ? '' : ' colspan="2"') + ' style="' + top + 'padding:11px 16px 11px ' + (k ? '4' : '16') + 'px;font:500 15px/1.4 ' + FONT + ';color:' + C.ink + ';">' + mark + esc(v) + '</td></tr>');
    });
    h.push('</table></td></tr>');
  }

  if (note) h.push('<tr><td style="padding:14px 4px 0;font:400 14px/1.5 ' + FONT + ';color:' + C.slate + ';">' + esc(note) + '</td></tr>');

  if (btn) {
    h.push('<tr><td align="center" style="padding:22px 0 4px;"><a href="' + esc(btn.url) + '" style="display:inline-block;background:' + C.red + ';color:#1A0605;font:700 16px ' + FONT + ';text-decoration:none;padding:14px 26px;border-radius:12px;' + 'box-shadow:0 0 14px ' + C.red + ',0 0 30px ' + C.red + '66;">' + esc(btn.text || 'Open') + '</a></td></tr>');
  }

  h.push('<tr><td align="center" style="padding:26px 8px 0;font:400 12px/1.5 ' + FONT + ';color:#6b7488;">' + esc(o.footer || 'Always Open · alwaysopenoffice.com') + '</td></tr>');
  h.push('</table></td></tr></table></body></html>');

  // plain text copy: same order, same words
  const t = [];
  t.push('[ ' + sign + ' ]' + (o.title ? '  ' + o.title : ''));
  if (doThis.length) { t.push('', 'DO THIS'); doThis.forEach((d, i) => t.push((i + 1) + '. ' + d)); }
  if (stats.length) { t.push(''); t.push(stats.map(s => s.n + ' ' + s.label).join('   |   ')); }
  if (lines.length) { t.push(''); if (o.linesTitle) t.push(String(o.linesTitle).toUpperCase()); lines.forEach(l => t.push(typeof l === 'string' ? '- ' + l : '- ' + (l.k ? l.k + ': ' : '') + l.v)); }
  if (note) t.push('', note);
  if (btn) t.push('', (btn.text || 'Open') + ': ' + btn.url);
  if (o.extraText) t.push('', String(o.extraText));
  t.push('', o.footer || 'Always Open · alwaysopenoffice.com');
  return { html: h.join(''), text: t.join('\n') };
}

// A full raw message (for env.EMAIL / EmailMessage) with a plain-text part and the neon HTML part.
export function rawEmail(m, text, html) {
  const domain = String(m.from || '').split('@')[1] || 'localhost';
  const b = 'ao-' + crypto.randomUUID();
  const enc = s => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(s))) + '?=';
  const one = s => String(s || '').replace(/[\r\n]+/g, ' ').trim();
  const head = [
    'From: "' + one(m.fromName || 'Always Open').replace(/"/g, '').replace(/[^\x20-\x7e]/g, '') + '" <' + m.from + '>',
    'To: <' + m.to + '>', 'Subject: ' + enc(one(m.subject).slice(0, 140)),
    'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>', 'Date: ' + new Date().toUTCString(), 'MIME-Version: 1.0'
  ];
  if (m.replyTo) head.push('Reply-To: <' + m.replyTo + '>');
  if (!html) return head.concat(['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit']).join('\r\n') + '\r\n\r\n' + text;
  const b64 = s => { const u = unescape(encodeURIComponent(s)); let out = btoa(u); return out.replace(/(.{76})/g, '$1\r\n'); };
  return head.concat(['Content-Type: multipart/alternative; boundary="' + b + '"']).join('\r\n') + '\r\n\r\n' +
    '--' + b + '\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + b64(text) + '\r\n' +
    '--' + b + '\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + b64(html) + '\r\n' +
    '--' + b + '--\r\n';
}

// Turn an old plain-text alert (subject + body) into a neon email, for senders not yet rewritten by hand.
// Lines become short rows; a line starting with "Do:" or "Fix:" becomes a Do-this step.
export function neonFromText(subject, text, opts) {
  opts = opts || {};
  const rows = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const doThis = [], lines = [];
  let url = '';
  rows.forEach(r => {
    const m = r.match(/^(do|fix|to fix|next step)\s*:\s*(.+)$/i);
    if (m) { doThis.push(m[2]); return; }
    const u = r.match(/(https:\/\/\S+)/);
    if (u && !url) url = u[1];
    if (/^https:\/\/\S+$/.test(r)) return;
    const kv = r.match(/^([A-Za-z][\w &'/-]{1,24}):\s+(.{1,200})$/);
    lines.push(kv ? { k: kv[1], v: kv[2] } : r.slice(0, 220));
  });
  return neonEmail({
    tone: opts.tone || 'bad', sign: opts.sign, title: String(subject || '').slice(0, 120), who: opts.who,
    doThis: doThis.length ? doThis : opts.doThis, lines: lines.slice(0, 12), stats: opts.stats,
    button: url ? { text: opts.buttonText || 'Open it', url } : opts.button,
    extraText: lines.length > 12 ? rows.slice(12).join('\n') : ''
  });
}
