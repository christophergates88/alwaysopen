// Web app card for competitor watch. This text is placed inside the app page's script (apppage.js),
// so it can use S, esc, post, toast, load, close, sheet. Keep it free of backticks and dollar-brace sequences.
// The numbers come from a check the owner starts and live only on this page while it is open (Google's terms).
export const RIVALS_JS = String.raw`
/* ---------- competitor watch ---------- */
var RVLIVE=null,RVBUSY=false;
(function(){if(document.getElementById('neon-css'))return;var l=document.createElement('link');l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family=Tilt+Neon&display=swap';document.head.appendChild(l);var st=document.createElement('style');st.id='neon-css';st.textContent='#rivals.feature{border:1.5px solid rgba(92,201,164,.6);box-shadow:0 0 8px rgba(92,201,164,.35),inset 0 0 10px rgba(92,201,164,.12)}#rivals.feature.behind{border-color:var(--sign);box-shadow:var(--glow);animation:neonFlicker 3.6s linear infinite}#rivals h3,.neonh{font:400 1.35rem \'Tilt Neon\',var(--display);font-stretch:normal;color:#fff;text-shadow:0 0 2px #fff,0 0 8px var(--ok),0 0 18px var(--ok)}#rivals.behind h3{text-shadow:0 0 2px #fff,0 0 8px var(--sign),0 0 18px var(--sign)}.rvsign{display:grid;justify-items:center;text-align:center;gap:4px;padding:16px 10px;border-radius:14px;border:2px solid var(--ok);background:rgba(0,0,0,.28);box-shadow:0 0 6px var(--ok),0 0 20px rgba(92,201,164,.45),inset 0 0 12px rgba(92,201,164,.25)}.rvsign.red{border-color:var(--sign);box-shadow:var(--glow)}.rvsign b{font:400 2.6rem/1 \'Tilt Neon\',var(--display);color:#fff;text-shadow:0 0 2px #fff,0 0 8px var(--ok),0 0 18px var(--ok),0 0 34px var(--ok)}.rvsign.red b{text-shadow:0 0 2px #fff,0 0 8px var(--sign),0 0 18px var(--sign),0 0 34px var(--sign)}.rvsign span{color:var(--slate);font-size:14px}.rvnums{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.rvnums div{display:grid;justify-items:center;gap:2px;padding:10px 4px;border-radius:12px;border:1.5px solid rgba(92,201,164,.55);background:var(--card);box-shadow:0 0 8px rgba(92,201,164,.25)}.rvnums div.red{border-color:rgba(255,106,94,.7);box-shadow:0 0 8px rgba(255,106,94,.35)}.rvnums b{font:400 1.7rem/1 \'Tilt Neon\',var(--display);color:#fff;text-shadow:0 0 6px var(--ok),0 0 14px var(--ok)}.rvnums div.red b{text-shadow:0 0 6px var(--sign),0 0 14px var(--sign)}.rvnums span{font-size:12px;color:var(--slate);text-align:center}.chip.storm{background:transparent!important;color:#fff!important;border:1.5px solid var(--sign);box-shadow:var(--glow);font-family:\'Tilt Neon\',var(--body);text-shadow:0 0 6px var(--sign);animation:neonFlicker 3.6s linear infinite}@keyframes neonFlicker{0%,89%{opacity:1}90%{opacity:.35}91%{opacity:1}92%{opacity:.25}93%,100%{opacity:1}}@media (prefers-reduced-motion:reduce){#rivals.feature.behind,.chip.storm{animation:none}}';document.head.appendChild(st);})();
function rivalCard(){
  var f=S.features||{},R=S.rivals;
  if(!f.competitors)return '<div class="feature locked"><h3>Competitor watch</h3><p>See how the top businesses like yours nearby are doing on Google, and when one of them slips. Comes with Growth.</p><div class="acts"><button class="btn line" type="button" data-a="ask-growth">Ask about Growth</button></div></div>';
  var L=(R&&R.status==='ok')?R:RVLIVE;
  var rk=(L&&L.status==='ok')?rvRank(L.rows||[]):null;
  var h='<div class="feature'+(rk&&rk.pos>1?' behind':'')+'" id="rivals"><h3>Competitor watch</h3>';
  if(!R||R.status==='first'){
    h+='<p>We look up the top businesses like yours nearby: their Google rating and how many reviews they have.</p><p class="fine">This switches on soon.</p>';
  }else if(R.status==='profile'||(L&&L.status==='profile')){
    h+='<p>We could not match your business to a Google profile yet.</p>';
    if(R.owner)h+='<div class="acts" style="gap:8px;flex-wrap:wrap"><input id="rvq" type="text" maxlength="100" placeholder="Business name and town" style="flex:1;min-width:180px"><button class="btn line sm" type="button" data-a="rv-profile">Find my profile</button></div>';
  }else if(!L||L.status!=='ok'){
    h+='<p>Tap Check now to look up the current Google rating and review count for you and the '+(R.watching?R.watching+' ':'')+'businesses you watch. We show the numbers here and don’t keep them.</p>';
    if(L&&L.message)h+='<p class="fine">'+esc(L.message)+'</p>';
    h+='<div class="acts"><button class="btn line" type="button" data-a="rv-live"'+(RVBUSY?' disabled':'')+'>'+(RVBUSY?'Checking…':'Check now')+'</button></div>';
  }else{
    h+=rvSign(L.rows||[]);
    if(L.note)h+='<p>'+esc(L.note)+'</p>';
    h+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px"><tr style="text-align:left"><th style="padding:6px 4px 6px 0;font-weight:600">Business</th><th style="padding:6px 4px;font-weight:600">Rating</th><th style="padding:6px 0 6px 4px;font-weight:600">Reviews</th></tr>';
    (L.rows||[]).forEach(function(r){
      h+='<tr style="border-top:1px solid var(--line,rgba(128,128,128,.25))"><td style="padding:7px 4px 7px 0">'+(r.own?'<b>You</b>':esc(r.name))+(R.owner&&!r.own&&r.id&&!L.sample?' <button class="btn ghost sm" type="button" data-a="rv-remove" data-id="'+esc(r.id)+'" aria-label="Stop watching '+esc(r.name)+'">Remove</button>':'')+'</td>'
        +'<td style="padding:7px 4px;font-variant-numeric:tabular-nums">'+(r.rating?r.rating.toFixed(1):'—')+'</td>'
        +'<td style="padding:7px 0 7px 4px;font-variant-numeric:tabular-nums">'+(+r.reviews).toLocaleString('en-US')+'</td></tr>';
    });
    h+='</table></div><p class="gm">Google Maps</p>';
    if(L.share){var sh=L.share;h+='<div class="share" style="margin-top:12px;padding:12px;border:1px solid var(--line,rgba(128,128,128,.25));border-radius:12px"><b>Estimated potential share: about '+esc(sh.range)+'</b><p class="fine" style="margin:4px 0 0">Of the '+(sh.compared+1)+' businesses on this list, by the model below.</p>'+(sh.factors&&sh.factors.length?'<p style="margin:8px 0 0;font-size:14px">What holds it back:</p><ul style="margin:4px 0 0 18px;padding:0;font-size:14px">'+sh.factors.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul>':'')+'<details style="margin-top:8px"><summary class="fine">How this is estimated</summary><p class="fine">'+esc(sh.assumptions)+'</p></details></div>';}
    h+='<p class="fine" style="margin-top:8px">Looked up just now. We don’t keep these numbers, so there is no week-to-week history.</p>';
    if(!L.sample)h+='<div class="acts" style="margin-top:6px"><button class="btn ghost sm" type="button" data-a="rv-live"'+(RVBUSY?' disabled':'')+'>'+(RVBUSY?'Checking…':'Check again')+'</button></div>';
    if(R.canAdd)h+='<div class="acts" style="gap:8px;flex-wrap:wrap;margin-top:8px"><input id="rvq" type="text" maxlength="100" placeholder="Add a business to watch (name and town)" style="flex:1;min-width:180px"><button class="btn line sm" type="button" data-a="rv-add">Add</button></div>';
  }
  return h+'</div>';
}
function rvRank(rows){
  var list=rows.slice().sort(function(a,b){return (b.rating||0)-(a.rating||0)||(+b.reviews||0)-(+a.reviews||0);});
  var me=null,pos=0;for(var i=0;i<list.length;i++){if(list[i].own){me=list[i];pos=i+1;break;}}
  if(!me)return null;
  var top=list[0],most=0;rows.forEach(function(r){if(+r.reviews>most)most=+r.reviews;});
  return {me:me,pos:pos,of:list.length,top:top,most:most};
}
function rvSign(rows){
  var k=rvRank(rows);if(!k)return '';
  var red=k.pos>1,gapR=k.top.rating&&k.me.rating?(k.top.rating-k.me.rating):0;
  var h='<div class="rvsign'+(red?' red':'')+'"><b>'+(k.pos===1?'YOU’RE #1':'YOU’RE #'+k.pos)+'</b><span>'+(k.pos===1?'Top rating of the '+k.of+' businesses you watch.':'Of '+k.of+' by Google rating. '+esc(k.top.name)+' is #1.')+'</span></div>';
  h+='<div class="rvnums"><div'+(red?' class="red"':'')+'><b>'+(k.me.rating?k.me.rating.toFixed(1):'—')+'</b><span>your rating</span></div>'
    +'<div><b>'+(k.top.rating?k.top.rating.toFixed(1):'—')+'</b><span>top rating</span></div>'
    +'<div'+((+k.me.reviews)<k.most?' class="red"':'')+'><b>'+(+k.me.reviews).toLocaleString('en-US')+'</b><span>your reviews'+((+k.me.reviews)<k.most?' (top: '+k.most.toLocaleString('en-US')+')':'')+'</span></div></div>';
  if(red)h+='<div class="hits" style="font-size:14.5px"><b>Do this:</b> '+(gapR>0.05?'ask every customer this week for a review. ':'')+'Send the review request after each finished job, from the app.</div>';
  return h;
}
function rvAct(a,id,t){
  var q=document.getElementById('rvq'),v=q?q.value.trim():'';
  if(a==='rv-live'){if(RVBUSY)return;RVBUSY=true;render();post('rivals',{action:'live'}).then(function(res){RVBUSY=false;RVLIVE=res.j.rivals||null;if(!res.j.ok&&res.j.error)toast(res.j.error);render();}).catch(function(){RVBUSY=false;toast('No connection.');render();});}
  else if(a==='rv-remove'){t.disabled=true;post('rivals',{action:'remove',id:id}).then(function(res){if(res.j.ok){toast('Removed.');if(RVLIVE&&RVLIVE.rows)RVLIVE.rows=RVLIVE.rows.filter(function(r){return r.id!==id;});load(true);}else{t.disabled=false;toast(res.j.error||'Could not remove.');}});}
  else if(a==='rv-add'||a==='rv-profile'){
    if(v.length<3){toast('Type the business name and town.');return;}
    t.disabled=true;
    post('rivals',{action:a==='rv-add'?'add':'profile',q:v}).then(function(res){t.disabled=false;if(res.j.ok){toast((a==='rv-add'?'Added ':'Found ')+(res.j.name||'it')+'. Tap Check now to see the numbers.');RVLIVE=null;load(true);}else toast(res.j.error||'Could not do that.');});
  }
}
`;
