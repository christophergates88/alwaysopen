// Help pages for "Your first hour": the printable review QR card, how to send missed calls to Max (by carrier), and the optional Google invite.
// The app opens them from the checklist; opening one ticks its step (app.js calls markOnboard).
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ten = e => /^\+1\d{10}$/.test(e || '') ? e.slice(2) : '';
const pretty = n => '(' + n.slice(0, 3) + ') ' + n.slice(3, 6) + '-' + n.slice(6);

function shell(title, inner, back, print) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>' + esc(title) + '</title>' +
    '<style>:root{--ink:#171B26;--slate:#586075;--line:#DCDAD3;--paper:#fff;--soft:#F5F4F0}@media(prefers-color-scheme:dark){:root{--ink:#EEF0F4;--slate:#9AA3B5;--line:#2B3243;--paper:#12151D;--soft:#1A1F2B}}' +
    '*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:640px;margin:0 auto;padding:24px 16px 60px}h1{font-size:28px;line-height:1.15;margin:0 0 6px}h2{font-size:19px;margin:0 0 6px}p{margin:8px 0}.sub{color:var(--slate)}' +
    '.card{border:1px solid var(--line);background:var(--soft);border-radius:14px;padding:14px 16px;margin:12px 0}code,.code{font:600 17px ui-monospace,Menlo,monospace;background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:2px 7px;word-break:break-all}.big{font:800 32px/1.1 system-ui;margin:10px 0}' +
    'ol{padding-left:22px;margin:8px 0}li{margin:8px 0}.btn{display:inline-block;padding:12px 18px;border:0;border-radius:12px;background:var(--ink);color:var(--paper);text-decoration:none;font:700 16px system-ui;cursor:pointer}.btn.line{background:transparent;color:var(--ink);border:1.5px solid var(--ink)}.fine{font-size:14px;color:var(--slate)}.acts{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}' +
    '.qrbox{background:#fff;border-radius:16px;padding:14px;width:min(340px,82vw);margin:16px auto}.qrbox svg{display:block;width:100%;height:auto}.cardp{text-align:center}@media print{.noprint{display:none!important}body{background:#fff;color:#000}.card{border:0;background:#fff}.sub,.fine{color:#333}}</style></head><body><main>' + inner +
    '<div class="acts noprint">' + (print ? '<button class="btn" type="button" id="pr">Print this page</button>' : '') + '<a class="btn line" href="' + esc(back) + '">Back to the app</a></div></main>' +
    (print ? '<script>document.getElementById("pr").addEventListener("click",function(){window.print();});</script>' : '') + '</body></html>';
}

// Codes checked against Verizon's own page and T-Mobile's published codes; AT&T doesn't publish its wireless ones, so that card says so and gives a fallback.
const CARRIERS = n => [
  { name: 'Verizon', steps: [
    'Open the Phone app, dial <code>*71' + n + '</code> and press call.',
    'Wait for the confirmation tone or message. Calls you don’t answer, and calls that come in while you’re busy, now go to Max.',
    'To turn it off, dial <code>*73</code>.'] },
  { name: 'T-Mobile', steps: [
    'Open the Phone app, dial <code>**61*' + n + '#</code> and press call. Calls you don’t answer now go to Max.',
    'To catch calls while you’re on another call, also dial <code>**67*' + n + '#</code>. For calls when you have no signal, dial <code>**62*' + n + '#</code>.',
    'To turn them off, dial <code>##61#</code>, <code>##67#</code> and <code>##62#</code>, or <code>##004#</code> to clear all three.',
    'If the phone says the number isn’t valid, put a 1 in front of it.'] },
  { name: 'AT&amp;T', steps: [
    'AT&amp;T doesn’t list these codes on its website, but the standard ones work on most AT&amp;T phones. Open the Phone app, dial <code>**61*' + n + '#</code> and press call.',
    'For busy and no signal, also dial <code>**67*' + n + '#</code> and <code>**62*' + n + '#</code>.',
    'To turn them off, dial <code>##004#</code>.',
    'If a code doesn’t take, call 611 from your AT&amp;T phone and ask them to forward unanswered calls to ' + pretty(n) + '.'] },
  { name: 'Landline', steps: [
    'Pick up and dial <code>*92</code>, enter <code>' + n + '</code> and press <code>#</code>. Calls you don’t answer now go to Max.',
    'For calls when your line is busy, dial <code>*90</code>, enter the number and press <code>#</code>.',
    'To turn them off, dial <code>*93#</code> and <code>*91#</code>.',
    'Office phone systems and internet phones vary. Tell us what you have in Ask us and we’ll send the exact steps.'] }
];

// Returns the page as a string, or null for an unknown page.
export async function helpPage(env, c, which, back) {
  if (which === 'qr') {
    const q = String(c.qr || '').match(/^(\d{2,3})\|([Mhvz0-9 .-]+)$/);
    const svg = q ? '<div class="qrbox"><svg viewBox="0 0 ' + (+q[1] + 8) + ' ' + (+q[1] + 8) + '" role="img" aria-label="QR code for our Google review page" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + esc(q[2]) + '" fill="#000"/></svg></div>' : '';
    return shell('Your review QR card', '<div class="cardp"><h1>' + esc(c.business || 'Our business') + '</h1>' +
      (q ? '<p class="big">Scan to leave us a Google review</p>' + svg + '<p class="sub">It opens our Google review page.</p>' : '<p class="sub">Your review code isn’t ready yet. It shows up here as soon as your Google review link is set up.</p>') +
      '</div><p class="noprint fine">Print this page and put it on the counter, in the truck or with the invoice. Ask every customer, not only the happy ones, and never offer anything in return for a review.</p>', back, !!q);
  }
  if (which === 'forwarding') {
    let line = null;
    try { line = await env.DB.prepare('SELECT number FROM voice_lines WHERE client_id = ?1 ORDER BY number LIMIT 1').bind(c.client_id).first(); } catch (e) { line = null; }
    const n = line ? ten(line.number) : '';
    if (!n) return shell('Send your missed calls to Max', '<h1>Send your missed calls to Max</h1><p class="sub">Max’s number for you is being set up right now. Open this page again in a few minutes and his number and the steps for your phone are here.</p>', back);
    return shell('Send your missed calls to Max', '<h1>Send your missed calls to Max</h1><p class="sub">Max’s number for you is <b>' + esc(pretty(n)) + '</b>. These steps send him the calls you don’t answer. Your phone still rings first.</p>' +
      CARRIERS(n).map(x => '<div class="card"><h2>' + x.name + '</h2><ol>' + x.steps.map(s => '<li>' + s + '</li>').join('') + '</ol></div>').join('') +
      '<div class="card"><h2>Android</h2><p>Most Android phones can do this in the Phone app: menu, Settings, Call forwarding, then set “When unanswered” to <b>' + esc(pretty(n)) + '</b>. The menu names change a little by phone.</p></div>' +
      '<p>Then call your number from another phone and let it ring. Max picks up.</p><p class="fine">Codes can differ by plan. If it doesn’t work, tell us your carrier in Ask us and we’ll sort it out with you.</p>', back);
  }
  if (which === 'google') {
    return shell('Invite us to your Google profile', '<h1>Invite us to your Google profile</h1><p class="sub">This one is optional. Your app, your request link and your hours work without it. Once you invite us, we can answer your reviews and keep your profile current. You stay the owner, and you can remove us any time.</p>' +
      '<div class="card"><ol><li>Open <a href="https://business.google.com" target="_blank" rel="noopener">business.google.com</a> and sign in.</li><li>Choose your business, then <b>Business Profile settings</b>, then <b>Managers</b>, then <b>Add</b>.</li><li>Enter this address and choose <b>Manager</b>:<br><span class="code">hello@alwaysopenoffice.com</span></li><li>Send the invite. We accept it on our side.</li></ol></div>' +
      '<p class="fine">Don’t see Managers? You may be signed in with a different Google account than the one that owns the profile. Message us in Ask us and we’ll walk through it.</p>', back);
  }
  return null;
}
