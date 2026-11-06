// Web app card for competitor watch. This text is placed inside the app page's script (apppage.js),
// so it can use S, esc, post, toast, load, close, sheet. Keep it free of backticks and dollar-brace sequences.
// The numbers come from a check the owner starts and live only on this page while it is open (Google's terms).
export const RIVALS_JS = String.raw`
/* ---------- competitor watch ---------- */
var RVLIVE=null,RVBUSY=false;
(function(){if(document.getElementById('neon-css'))return;var l=document.createElement('link');l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family=Tilt+Neon&display=swap';document.head.appendChild(l);var st=document.createElement('style');st.id='neon-css';st.textContent='#rivals.feature{border:1.5px solid rgba(92,201,164,.6);box-shadow:0 0 8px rgba(92,201,164,.35),inset 0 0 10px rgba(92,201,164,.12)}#rivals.feature.behind{border-color:var(--sign);box-shadow:var(--glow);animation:neonFlicker 3.6s linear infinite}#rivals h3,.neonh{font:400 1.35rem \'Tilt Neon\',var(--display);font-stretch:normal;color:#fff;text-shadow:0 0 2px #fff,0 0 8px var(--ok),0 0 18px var(--ok)}#rivals.behind h3{text-shadow:0 0 2px #fff,0 0 8px var(--sign),0 0 18px var(--sign)}.rvsign{display:grid;justify-items:center;text-align:center;gap:4px;padding:16px 10px;border-radius:14px;border:2px solid var(--ok);background:rgba(0,0,0,.28);box-shadow:0 0 6px var(--ok),0 0 20px rgba(92,201,164,.45),inset 0 0 12px rgba(92,201,164,.25)}.rvsign.red{border-color:var(--sign);box-shadow:var(--glow)}.rvsign b{font:400 2.6rem/1 \'Tilt Neon\',var(--display);color:#fff;text-shadow:0 0 2px #fff,0 0 8px var(--ok),0 0 18px var(--ok),0 0 34px var(--ok)}.rvsign.red b{text-shadow:0 0 2px #fff,0 0 8px var(--sign),0 0 18px var(--sign),0 0 34px var(--sign)}.rvsign span{color:var(--slate);font-size:14px}.rvnums{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.rvnums div{display:grid;justify-items:center;gap:2px;padding:10px 4px;border-radius:12px;border:1.5px solid rgba(92,201,164,.55);background:var(--card);box-shadow:0 0 8px rgba(92,201,164,.25)}.rvnums div.red{border-color:rgba(255,106,94,.7);box-shadow:0 0 8px rgba(255,106,94,.35)}.rvnums b{font:400 1.7rem/1 \'Tilt Neon\',var(--display);color:#fff;text-shadow:0 0 6px var(--ok),0 0 14px var(--ok)}.rvnums div.red b{text-shadow:0 0 6px var(--sign),0 0 14px var(--sign)}.rvnums span{font-size:12px;color:var(--slate);text-align:center}.chip.storm{background:transparent!important;color:#fff!important;border:1.5px solid var(--sign);box-shadow:var(--glow);font-family:\'Tilt Neon\',var(--body);text-shadow:0 0 6px var(--sign);animation:neonFlicker 3.6s linear infinite}@keyframes neonFlicker{0%,89%{opacity:1}90%{opacity:.35}91%{opacity:1}92%{opacity:.25}93%,100%{opacity:1}}@media (prefers-reduced-motion:reduce){#rivals.feature.behind,.chip.storm{animation:none}}';document.head.appendChild(st);})();
function rivalCard(){
  var f=S.features||{},R=S.rivals;
  if(!f.competitors)return '<div class="feature locked"><h3>Competitor watch</h3><p>See where you stand against the top businesses like yours nearby on Google, and what it takes to be #1. Comes with Growth.</p><div class="acts"><button class="btn line" type="button" data-a="ask-growth">Ask about Growth</button></div></div>';
  var L=(R&&R.status==='ok')?R:RVLIVE;
  var rk=(L&&L.status==='ok')?rvRank(L.rows||[]):null;
  var open='<div data-card="rivals" class="feature'+(rk&&rk.pos>1?' behind':'')+'" id="rivals">';
  var h=open+'<h3>Competitor watch</h3>';
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
    // The website's picture, top to bottom: when it was checked, the sign, the two ratings, what it takes to be #1, the
    // numbered list (you in the sign color), where the numbers come from, and Check now.
    h=open+'<div class="rvhd">Competitor watch \u00b7 '+esc(rvWhen(L.checkedAt))+'</div>'+rvBoard(L,R);
    h+='<p class="fine">Numbers from Google Maps, looked up when you tap Check now, and not kept.</p>';
    h+='<div class="acts"><button class="btn line" type="button" data-a="rv-live"'+(RVBUSY?' disabled':'')+'>'+(RVBUSY?'Checking\u2026':'Check now')+'</button></div>';
    if(L.share){var sh=L.share;h+='<details><summary class="fine">Estimated share: about '+esc(sh.range)+'</summary><p class="fine">Of the '+(sh.compared+1)+' businesses on this list.'+(sh.factors&&sh.factors.length?' What holds it back: '+sh.factors.map(esc).join('; ')+'.':'')+'</p><p class="fine">'+esc(sh.assumptions)+'</p></details>';}
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
function rvNoun(){var t=String((S.map&&S.map.trade)||'').trim();if(!t)return 'businesses like yours';return /[^aeiou]y$/.test(t)?t.slice(0,-1)+'ies':t+'s';}
function rvNear(){var t=String((S.map&&S.map.town)||'').split(',')[0].trim();return t?' near '+t:'';}
function rvWhen(at){var t=Date.parse(at||'');if(!t)return 'checked just now';var m=Math.round((Date.now()-t)/60000);return m<2?'checked just now':(m<60?'checked '+m+' min ago':'checked at '+new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}));}
function rvBoard(L,R){
  var rows=L.rows||[],k=rvRank(rows);if(!k)return '';
  var f1=function(x){return x?(+x).toFixed(1):'\u2014';},nn=function(x){return (+x||0).toLocaleString('en-US');};
  var list=rows.slice().sort(function(a,b){return (b.rating||0)-(a.rating||0)||(+b.reviews||0)-(+a.reviews||0);});
  var first=k.pos===1,other=first?list[1]:k.top;
  var h='<div class="rvsign2'+(first?' top':'')+'"><span class="y">YOU\u2019RE</span><b>#'+k.pos+'</b><span>of '+k.of+' '+esc(rvNoun())+esc(rvNear())+', on rating</span></div>';
  h+='<div class="rvtwo"><div'+(first?' class="lead"':'')+'><b>'+f1(k.me.rating)+'\u2605</b><span>you \u00b7 '+nn(k.me.reviews)+' reviews</span></div>'+(other?'<div class="lead"><b>'+f1(other.rating)+'\u2605</b><span>'+(first?'next \u00b7 ':'the leader \u00b7 ')+nn(other.reviews)+' reviews</span></div>':'')+'</div>';
  var F=L.toFirst,ask=(S.features||{}).jobs?' Every finished job already gets the ask.':' Ask every customer once the job is done.';
  var pace=F&&F.weeks?'At your pace, about '+F.weeks+(F.weeks===1?' week.':' weeks.'):(L.paceKnown?'At your pace, more than two years.':'We\u2019ll know your pace after a few weeks.');
  if(first)h+='<div class="rvone"><b>To stay #1</b>Keep the reviews coming.'+ask+'</div>';
  else h+='<div class="rvone"><b>To be #1</b>'+(F&&F.k?F.k+' more 5-star '+(F.k===1?'review':'reviews')+'. '+pace:'Out of reach on rating for now. Keep the reviews coming.')+ask+'</div>';
  h+='<ol class="rvlist">'+list.map(function(r,i){return '<li'+(r.own?' class="me"':'')+'><b>'+(i+1)+'. '+(r.own?'You':esc(r.name))+'</b><span>'+f1(r.rating)+'\u2605 \u00b7 '+nn(r.reviews)+'</span>'+(R.owner&&!r.own&&r.id&&!L.sample?'<button class="btn ghost sm" type="button" data-a="rv-remove" data-id="'+esc(r.id)+'" aria-label="Stop watching '+esc(r.name)+'">Stop watching</button>':'')+'</li>';}).join('')+'</ol>';
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
