// Web app card for competitor watch. This text is placed inside the app page's script (apppage.js),
// so it can use S, esc, post, toast, load, close, sheet. Keep it free of backticks and dollar-brace sequences.
// The numbers come from a check the owner starts and live only on this page while it is open (Google's terms).
export const RIVALS_JS = String.raw`
/* ---------- competitor watch ---------- */
var RVLIVE=null,RVBUSY=false;
function rivalCard(){
  var f=S.features||{},R=S.rivals;
  if(!f.competitors)return '<div class="feature locked"><h3>Competitor watch</h3><p>See how the top businesses like yours nearby are doing on Google, and when one of them slips. Comes with Growth.</p><div class="acts"><button class="btn line" type="button" data-a="ask-growth">Ask about Growth</button></div></div>';
  var L=(R&&R.status==='ok')?R:RVLIVE;
  var h='<div class="feature" id="rivals"><h3>Competitor watch</h3>';
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
