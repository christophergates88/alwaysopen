// Hear Max: the player under the dare. Shown only when a sample exists (/hear-max.json); otherwise nothing renders.
// No library: one <audio>, made on the first tap so phones in Low Power Mode load nothing until asked.
(function () {
  var slots = document.querySelectorAll('[data-hearmax]');
  if (!slots.length || !window.fetch) return;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var lang = (document.documentElement.getAttribute('data-lang') || '') === 'es' ? 'es' : 'en';
  var TT = { en: { play: 'Hear Max take a call', pause: 'Pause', left: ' seconds left', read: 'Read it instead', caller: 'Caller', note: 'A sample call to our demo line. Max never records your customers.', mid: 'We join this call partway through, right at the hard part.' },
             es: { play: 'Escuche a Max contestar una llamada', pause: 'Pausa', left: ' segundos', read: 'Leerla', caller: 'Quien llama', note: 'Una llamada de muestra a nuestra línea de prueba. Max nunca graba a sus clientes.', mid: 'Entramos a la llamada a la mitad, justo en la parte difícil.' } };
  var T = TT[lang];
  var css = '.hm{margin:18px 0 0;display:grid;gap:8px;max-width:520px;color:inherit}' +
    '.hm-b{display:flex;align-items:center;gap:12px;min-height:52px;width:100%;padding:8px 16px 8px 8px;border:2px solid #FF6A5E;border-radius:999px;background:transparent;color:inherit;font-weight:700;font-size:16px;line-height:1.2;font-family:inherit;cursor:pointer;text-align:left;box-shadow:0 0 18px rgba(255,90,77,.25)}' +
    '.hm-b:focus-visible{outline:3px solid #FF6A5E;outline-offset:3px}.hm-i{flex:none;width:36px;height:36px;border-radius:50%;background:#D92D20;display:grid;place-items:center}.hm-i svg{width:16px;height:16px;fill:#fff}' +
    '.hm-t{flex:1;display:grid;gap:2px}.hm-t small{font-weight:500;font-size:13px;opacity:.8}.hm-p{height:3px;border-radius:2px;background:rgba(127,127,127,.3);overflow:hidden}.hm-p i{display:block;height:100%;width:0;background:#FF6A5E;transition:width .25s linear}' +
    '.hm-c{font-size:14px;opacity:.85;margin:0}.hm details{all:unset;display:block;font-size:14px;color:inherit}.hm details[open]{padding-bottom:4px}.hm summary{all:unset;cursor:pointer;min-height:44px;display:flex;align-items:center;gap:6px;font-weight:600;color:inherit}.hm summary::before{content:"\\25B8";font-size:12px}.hm details[open] summary::before{content:"\\25BE"}.hm summary:focus-visible{outline:2px solid #FF6A5E;outline-offset:2px}.hm dl{margin:0 0 6px;display:grid;gap:6px}.hm dt{font-weight:700;font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.75}.hm dd{margin:0 0 4px}' +
    '.hm-n{font-size:12.5px;opacity:.75;margin:0}@media (prefers-reduced-motion:reduce){.hm-p i{transition:none}}';
  var PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>', PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>';
  var styled = false, current = null;
  function get(l) { return fetch('/hear-max.json' + (l === 'es' ? '?lang=es' : '')).then(function (r) { return r.ok ? r.json() : null; }); }
  // The Spanish sample when there is one; otherwise the English call with Spanish labels.
  function load(l) {
    lang = l; T = TT[l];
    get(l).then(function (d) { return d && d.ok ? d : (l === 'es' ? get('en') : null); }).then(function (d) {
      if (!d || !d.ok || !d.src) return;
      if (!styled) { var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); styled = true; }
      if (current) { current.pause(); current = null; }
      for (var i = 0; i < slots.length; i++) build(slots[i], d);
    }).catch(function () {});
  }
  load(lang);
  window.addEventListener('ao:lang', function (e) { var l = e && e.detail === 'es' ? 'es' : 'en'; if (l !== lang) load(l); });
  function build(slot, d) {
    var lines = (d.lines || []).map(function (l) { return '<dt>' + esc(l.who === 'Caller' ? T.caller : l.who) + '</dt><dd>' + esc(l.t) + '</dd>'; }).join('');
    slot.className = 'hm';
    slot.innerHTML = '<button type="button" class="hm-b" aria-pressed="false"><span class="hm-i">' + PLAY + '</span><span class="hm-t"><span class="hm-l">' + esc(T.play) + '</span><small>' + d.seconds + T.left + '</small></span></button>' +
      '<div class="hm-p" aria-hidden="true"><i></i></div><p class="hm-c">' + esc(d.caption) + (d.from ? ' ' + esc(T.mid) : '') + '</p>' +
      (lines ? '<details><summary>' + esc(T.read) + '</summary><dl>' + lines + '</dl></details>' : '') + '<p class="hm-n">' + esc(T.note) + '</p>';
    slot.hidden = false;
    var btn = slot.querySelector('.hm-b'), icon = slot.querySelector('.hm-i'), lab = slot.querySelector('.hm-l'), left = slot.querySelector('small'), bar = slot.querySelector('.hm-p i'), audio = null;
    function show(playing) { btn.setAttribute('aria-pressed', playing ? 'true' : 'false'); icon.innerHTML = playing ? PAUSE : PLAY; lab.textContent = playing ? T.pause : T.play; }
    btn.addEventListener('click', function () {
      if (!audio) {
        audio = new Audio(); audio.preload = 'none'; audio.src = d.src + (d.from ? '#t=' + d.from : '');
        var from = +d.from || 0, to = +d.to || 0, started = false;
        audio.addEventListener('loadedmetadata', function () { if (from && !started) { try { audio.currentTime = from; } catch (e) {} } started = true; });
        audio.addEventListener('timeupdate', function () { if (to && audio.currentTime >= to) { audio.pause(); try { audio.currentTime = from; } catch (e) {} bar.style.width = '0'; left.textContent = d.seconds + T.left; } });
        audio.addEventListener('timeupdate', function () { var end = to || audio.duration || d.seconds, dur = Math.max(1, end - from), at = Math.max(0, audio.currentTime - from); bar.style.width = Math.min(100, 100 * at / dur) + '%'; left.textContent = Math.max(0, Math.ceil(dur - at)) + T.left; });
        audio.addEventListener('ended', function () { show(false); bar.style.width = '0'; left.textContent = d.seconds + T.left; try { audio.currentTime = from; } catch (e) {} });
        audio.addEventListener('pause', function () { show(false); });
        audio.addEventListener('play', function () { if (current && current !== audio) current.pause(); current = audio; show(true); });
      }
      if (audio.paused) { var p = audio.play(); if (p && p.catch) p.catch(function () { show(false); }); } else audio.pause();
    });
  }
})();
