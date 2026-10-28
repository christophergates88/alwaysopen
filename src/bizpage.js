// Web app screens for jobs, estimates, card payments, the shared inbox, review insights, team, onboarding and settings.
// This text is placed inside the app page's script (apppage.js), so it can use S, esc, post, api, sheet, close, toast, render, copyText.
export const BIZ_JS = String.raw`
/* ---------- jobs, estimates, inbox, team (biz) ---------- */
(function(){var st=document.createElement('style');st.textContent='.chips{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 0}.chip{font:600 13px var(--body,inherit);padding:6px 10px;border-radius:999px;border:1.5px solid var(--line);background:transparent;color:inherit;cursor:pointer}.chip[aria-pressed=true]{border-color:var(--sign);box-shadow:var(--glow)}.ob li{display:flex;gap:10px;align-items:center;padding:6px 0;list-style:none}.ob ul{padding:0;margin:8px 0}.ob .obt{display:flex;flex-direction:column;gap:2px;min-width:0}.ob .obt small{font-size:13px;line-height:1.35;opacity:.75}.ob .tick{width:22px;height:22px;border-radius:50%;border:2px solid var(--line);display:inline-grid;place-items:center;font-size:13px;flex:none}.ob .obd .tick{background:var(--sign);border-color:var(--sign);color:#fff}.ob .obd span{text-decoration:line-through;opacity:.7}.qline{display:grid;grid-template-columns:1fr 64px 96px;gap:6px}.inb{white-space:pre-wrap}.tag{font:600 12px var(--mono,monospace);opacity:.75}.bar{height:8px;border-radius:4px;background:var(--sign);opacity:.8}';document.head.appendChild(st);})();
var STG=[['new','New'],['quoted','Quoted'],['booked','Booked'],['done','Done'],['paid','Paid']];
var CH={request:'Request',booking:'Booking',call:'Call',facebook:'Facebook',text:'Text',google:'Google review'};
function isTech(){return !!(S&&S.me&&S.me.role==='tech');}
function isOwner(){return !!(S&&S.me&&S.me.role==='owner');}
function m2(n){return n==null?'':'$'+(+n||0).toLocaleString('en-US',{maximumFractionDigits:2});}
function bizTop(){
  var o=S.onboarding;if(!o||!o.show)return '';
  return '<div class="card ob"><b>Your first hour</b><p class="note" style="margin:4px 0 0">'+o.left+(o.left===1?' step':' steps')+' left. Each one ticks itself when it’s done.</p><ul>'+o.steps.map(function(s){
    var go={hours:'bz-ob-hours',calendar:'bz-ob-cal',facebook:'bz-ob-fb',stripe:'bz-stripe',max:'bz-ob-max',share:'bz-ob-share',map:'bz-map'}[s.key]||(s.help?'bz-ob-help':'');
    return '<li class="'+(s.done?'obd':'')+'"><span class="tick" aria-hidden="true">'+(s.done?'✓':'')+'</span><div class="obt"><span>'+esc(s.label)+'</span>'+(s.hint&&!s.done?'<small>'+esc(s.hint)+'</small>':'')+'</div>'+(s.done?'':'<button class="btn line sm" type="button" data-a="'+go+'"'+(s.help?' data-id="'+esc(s.help)+'"':'')+' style="margin-left:auto">'+(s.help?'Open':'Do it')+'</button>')+'</li>';}).join('')+'</ul><div class="acts"><button class="btn ghost sm" type="button" data-a="bz-ob-hide">Hide this list</button></div></div>';
}
function bizBlocks(){
  var h='';
  h+='<h2>Inbox</h2><div class="list">'+'<button class="row" type="button" data-a="bz-inbox">'+ICON.check+'<div><b>All your messages in one place</b><span>Requests, bookings, calls, Facebook messages and Google reviews</span></div>'+ICON.chev+'</button></div>';
  h+=jobsBlock();
  if(!isTech())h+=quotesBlock()+payBlock();
  h+=insightsBlock();
  if(isOwner())h+=teamBlock()+setBlock();
  return h;
}
function jobsBlock(){
  var js=S.jobs||[],t=S.jobTotals;
  var h='<h2>Jobs</h2>';
  if(t&&t.count)h+='<p class="note" style="margin:-4px 2px 10px">'+m2(t.paidMonth)+' paid this month · '+m2(t.booked)+' booked and not paid yet</p>';
  var by={};STG.forEach(function(s){by[s[0]]=js.filter(function(j){return j.stage===s[0];});});
  h+='<div class="chips" role="group" aria-label="Jobs by stage">'+STG.map(function(s){return '<button class="chip" type="button" data-a="bz-stage-f" data-id="'+s[0]+'" aria-pressed="'+(JOBF===s[0])+'">'+s[1]+' '+by[s[0]].length+'</button>';}).join('')+'</div>';
  var list=by[JOBF]||[];
  h+='<div class="list" style="margin-top:8px">'+list.slice(0,25).map(function(j){
    return '<article class="card"><b>'+esc(j.name||'Customer')+'</b>'+(j.amount?'<span class="tag" style="float:right">'+m2(j.amount)+'</span>':'')+'<p class="note" style="margin:4px 0">'+esc(j.title||'')+(j.phone?' · '+esc(j.phone):'')+'</p><div class="chips">'+
      STG.map(function(s){if(isTech()&&s[0]==='paid')return '';return '<button class="chip" type="button" data-a="bz-stage" data-id="'+j.id+'" data-s="'+s[0]+'" aria-pressed="'+(j.stage===s[0])+'">'+s[1]+'</button>';}).join('')+'</div>'+
      (isTech()?'':'<div class="acts" style="margin-top:6px"><button class="btn ghost sm" type="button" data-a="bz-amt" data-id="'+j.id+'">Set amount</button>'+(j.quoteId?'':'<button class="btn line sm" type="button" data-a="bz-quote" data-id="'+j.id+'">Write estimate</button>')+'</div>')+'</article>';}).join('')+'</div>';
  if(!list.length)h+='<div class="empty slim"><b>Nothing here</b><span>New requests, bookings and calls show up as jobs on their own.</span></div>';
  return h+'<div class="acts" style="margin:4px 0 0"><button class="btn line" type="button" data-a="bz-job-add">Add a job</button></div>';
}
var JOBF='new';
function quotesBlock(){
  var qs=S.quotes||[];
  var h='<h2>Estimates</h2><div class="list">'+qs.slice(0,15).map(function(q){
    var st=q.status==='accepted'?'Accepted':(q.status==='invoiced'?'Invoiced':'Waiting on customer');
    return '<article class="card"><b>'+esc(q.name)+' · #'+esc(q.number)+'</b><p class="note" style="margin:4px 0">'+esc(q.totalText)+' · '+st+'</p><div class="acts"><button class="btn line sm" type="button" data-a="bz-q-copy" data-id="'+q.id+'">Copy estimate link</button>'+
      (q.invoiceId?'':'<button class="btn ok sm" type="button" data-a="bz-q-inv" data-id="'+q.id+'">Turn into invoice</button>')+'</div></article>';}).join('')+'</div>';
  if(!qs.length)h+='<div class="empty slim"><b>No estimates yet</b><span>Write one with line items and tax. Send the link; they can accept it online.</span></div>';
  return h+'<div class="acts" style="margin:4px 0 0"><button class="btn line" type="button" data-a="bz-quote">Write an estimate</button></div>';
}
function payBlock(){
  var p=S.stripe;if(!p||!isOwner())return '';
  if(!p.available&&!p.note)return '';
  if(!p.available)return '<div class="feature locked"><h3>Take card payments</h3><p>Customers pay your invoices by card and they mark themselves paid. Coming soon.</p></div>';
  if(p.ready)return '<div class="feature"><h3>Card payments are on</h3><p>Your invoices show a Pay by card button. When a customer pays, the invoice and job mark themselves paid. The money goes to your Stripe account.</p></div>';
  return '<div class="feature"><h3>Take card payments</h3><p>'+(p.connected?'Stripe is still checking your details. Finish the steps on Stripe if it asks.':'Connect Stripe and every invoice gets a Pay by card button. Paid invoices mark themselves paid.')+'</p><div class="acts"><button class="btn red sm" type="button" data-a="bz-stripe">'+(p.connected?'Finish Stripe setup':'Connect Stripe')+'</button></div></div>';
}
function insightsBlock(){
  var i=S.insights;if(!i)return '';
  var max=1;(i.praise||[]).concat(i.complaints||[]).forEach(function(x){if(x.count>max)max=x.count;});
  var row=function(x){return '<div style="margin:6px 0"><div style="display:flex;justify-content:space-between"><span>'+esc(x.theme)+'</span><span class="tag">'+x.count+'</span></div><div class="bar" style="width:'+Math.max(8,Math.round(x.count/max*100))+'%"></div></div>';};
  return '<h2>What reviews say</h2><div class="card"><p class="note" style="margin:0 0 6px">'+esc(i.summary||'')+' From '+i.reviews+' reviews this month.</p><b>Praise</b>'+(i.praise||[]).map(row).join('')+
    '<b style="display:block;margin-top:10px">Complaints</b>'+((i.complaints||[]).length?(i.complaints||[]).map(row).join(''):'<p class="note">None this month.</p>')+'</div>';
}
function teamBlock(){
  var tm=S.team||[];
  var h='<h2>Team</h2><div class="list">'+tm.map(function(m){return '<article class="card"><b>'+esc(m.name)+'</b><div class="chips"><button class="chip" type="button" data-a="bz-role" data-id="'+esc(m.id)+'" data-s="manager" aria-pressed="'+(m.role==='manager')+'">Manager</button><button class="chip" type="button" data-a="bz-role" data-id="'+esc(m.id)+'" data-s="tech" aria-pressed="'+(m.role==='tech')+'">Tech (no money)</button></div></article>';}).join('')+'</div>';
  if(!tm.length)h+='<div class="empty slim"><b>Just you so far</b><span>Ask us in Ask us for a link for each person on your team.</span></div>';
  return h+'<div class="acts" style="margin:4px 0 0"><button class="btn line" type="button" data-a="bz-act">See who did what</button></div>';
}
function setBlock(){
  var h='<h2>Settings</h2><div class="card"><label class="opt" style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="bz-weekly"'+(S.weekly?' checked':'')+'> <span>Monday morning summary of last week</span></label>';
  if(S.line)h+='<label class="opt" style="display:flex;gap:10px;align-items:center;margin-top:8px"><input type="checkbox" id="bz-es"'+(S.line.spanish?' checked':'')+'> <span>'+esc(S.line.name)+' answers Spanish-speaking callers in Spanish</span></label>';
  if(S.map)h+='<label class="opt" style="display:flex;gap:10px;align-items:center;margin-top:8px"><input type="checkbox" id="bz-map"'+(S.map.show?' checked':'')+'> <span>Show me on the Always Open map</span></label><p class="note" style="margin:4px 0 0">'+esc(mapNote())+' <button class="btn line sm" type="button" data-a="bz-map" style="margin-top:6px">Edit what it shows</button></p>';
  if(S.checkins){h+='<label class="opt" style="display:flex;gap:10px;align-items:center;margin-top:8px"><input type="checkbox" id="bz-ci"'+(S.checkins.on?' checked':'')+'> <span>Check-in calls: three days after a job, Max calls the customer once to ask if the work held up. Only customers who said a call is OK. A yes becomes the review ask; a no reaches you first.</span></label>';}
  if(S.handoff){var H=S.handoff;h+='<p class="note" style="margin:14px 0 4px"><b>Hand-offs between Always Open businesses</b></p>'+
    '<label class="opt" style="display:flex;gap:10px;align-items:center;margin-top:4px"><input type="checkbox" id="bz-ho-give"'+(H.give?' checked':'')+'> <span>When a caller needs work we don\u2019t do, Max may put them through to a nearby Always Open business that does</span></label>'+
    '<label class="opt" style="display:flex;gap:10px;align-items:center;margin-top:8px"><input type="checkbox" id="bz-ho-take"'+(H.take?' checked':'')+'> <span>Take callers that nearby Always Open businesses pass to us</span></label>'+
    '<p class="note" style="margin:4px 0 0">'+(H.give?(H.nearby?H.nearby+' nearby business'+(H.nearby===1?'':'es')+' can take hand-offs right now.':'No nearby business takes hand-offs yet. Max will not offer any.'):'Off.')+(H.given||H.taken?' This month: sent '+H.given+', took '+H.taken+'.':'')+' Nearest first, never by plan. Only businesses on Always Open.</p>';}
  return h+'</div>';
}
function mapNote(){var m=S.map;if(!m)return '';if(!m.show)return m.regulated?'Off. Regulated businesses are only listed if they turn it on.':'Off. You are not on the public map.';
  return 'Shows your name, type and town'+(m.phone?', '+m.phone:'')+(m.address?', '+m.address:'')+'. The list is sorted by distance only.';}
function mapSheet(){var m=S.map||{};
  sheet('<h2>Your map listing</h2><p class="fine">The <a href="/map" target="_blank" rel="noopener">Always Open map</a> lists the businesses we work for. It shows your name, type and town. A phone number and street address show only if you add them here. Changes show within about ten minutes.</p>'+
  '<label class="opt" style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="mp-show"'+(m.show?' checked':'')+'> <span>Show me on the map</span></label>'+
  '<label>Business phone for the map (optional)<input id="mp-phone" type="tel" inputmode="tel" value="'+esc(m.phone||'')+'" placeholder="(478) 555-0142"></label>'+
  '<label>Street address for the map (optional)<input id="mp-addr" value="'+esc(m.address||'')+'" placeholder="Leave blank to show only your town"></label>'+
  '<div class="acts"><button class="btn red" type="button" data-a="bz-map-save">Save</button><button class="btn line" type="button" data-close="1">Cancel</button></div>');}

function inboxSheet(){
  sheet('<h2>Inbox</h2><p class="fine">Loading…</p>');
  api('inbox').then(function(res){
    var l=(res.j&&res.j.inbox)||[];
    var h='<h2>Inbox</h2>'+(l.length?'':'<p class="fine">Nothing in the last 30 days.</p>')+'<div class="list">'+l.map(function(x){
      var th=x.thread?x.thread.map(function(m){return '<p class="note inb" style="margin:4px 0;'+(m.dir==='out'?'text-align:right':'')+'">'+esc(m.text)+(m.by?' — '+esc(m.by):'')+'</p>';}).join(''):'<p class="note inb" style="margin:4px 0">'+esc(x.text)+'</p>';
      return '<article class="card"><span class="tag">'+esc(CH[x.channel]||x.channel)+(x.open?' · new':'')+' · '+esc(when(x.at))+'</span><b style="display:block">'+esc(x.name||'Someone')+'</b>'+th+
        (x.phone?'<div class="acts"><a class="btn line sm" href="tel:'+esc(x.phone)+'">Call</a></div>':'')+
        (x.canReply?'<label>Reply<textarea id="r-'+esc(x.id)+'" rows="2" maxlength="1000"></textarea></label><div class="acts"><button class="btn ok sm" type="button" data-a="bz-reply" data-id="'+esc(x.id)+'">Send on Facebook</button></div>':'')+'</article>';}).join('')+'</div><div class="acts"><button class="btn ghost" type="button" data-close="1">Close</button></div>';
    sheet(h);
  }).catch(function(){toast('No connection. Try again.');close();});
}
function quoteSheet(jobId){
  var j=jobId?(S.jobs||[]).filter(function(x){return String(x.id)===String(jobId);})[0]:null;
  sheet('<h2>Write an estimate</h2><label>Customer’s name<input type="text" id="qn" maxlength="80" value="'+esc(j?j.name:'')+'"></label><label>Their email (optional)<input type="email" id="qe" maxlength="120"></label><label>Their cell (optional)<input type="tel" id="qp" maxlength="20" value="'+esc(j?j.phone:'')+'"></label>'+
    '<div id="ql"></div><div class="acts"><button class="btn ghost sm" type="button" id="qadd">Add a line</button></div><label>Sales tax %<input type="text" id="qt" inputmode="decimal" placeholder="0"></label><label>Notes (optional)<textarea id="qo" rows="2" maxlength="1500"></textarea></label><p class="note" id="qtot"></p>'+
    '<div class="acts"><button class="btn ok" type="button" id="go">Save estimate</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');
  var lines=$('#ql');function add(){var d=document.createElement('div');d.className='qline';d.innerHTML='<input type="text" placeholder="What" maxlength="160" aria-label="What"><input type="text" placeholder="Qty" value="1" inputmode="decimal" aria-label="Quantity"><input type="text" placeholder="Price" inputmode="decimal" aria-label="Price each">';lines.appendChild(d);}
  function items(){return Array.prototype.map.call(lines.children,function(d){var i=d.querySelectorAll('input');return {desc:i[0].value.trim(),qty:+i[1].value||1,price:i[2].value};}).filter(function(x){return x.desc;});}
  function tot(){if(!$('#qt')||!$('#qtot'))return;var s=0;items().forEach(function(x){s+=x.qty*(parseFloat(String(x.price).replace(/[$,]/g,''))||0);});var tx=s*(+$('#qt').value||0)/100;$('#qtot').textContent='Total '+m2(Math.round((s+tx)*100)/100);}
  add();add();$('#qadd').onclick=add;$('#scrim').oninput=tot;
  $('#go').onclick=function(){var b=this;b.disabled=true;post('quote',{action:'add',jobId:jobId?+jobId:0,name:$('#qn').value,email:$('#qe').value,phone:$('#qp').value,items:items(),taxRate:$('#qt').value,notes:$('#qo').value}).then(function(res){b.disabled=false;if(res.j.ok){close();S.quotes=[res.j.quote].concat(S.quotes||[]);copyText(res.j.quote.link,'Saved. Estimate link copied: send it to them.');load(true);}else toast(res.j.error||'Could not save.');}).catch(function(){b.disabled=false;toast('No connection. Try again.');});};
}
function quoteInvSheet(id){
  var card=S.stripe&&S.stripe.ready,q=(S.quotes||[]).filter(function(x){return String(x.id)===String(id);})[0]||{};
  sheet('<h2>Turn into an invoice</h2><label>Their email<input type="email" id="qie" maxlength="120" value="'+esc(q.email||'')+'"></label><label>Their cell<input type="tel" id="qip" maxlength="20" value="'+esc(q.phone||'')+'"></label><label>Due date<input type="date" id="qd" value="'+localDay(14)+'"></label>'+(card?'<p class="fine">Customers can pay by card. You can add your own pay link too.</p>':'')+'<label>Your pay link'+(card?' (optional)':'')+'<input type="url" id="ql2" placeholder="https://"></label><label class="opt" style="display:flex;gap:10px"><input type="checkbox" id="qc"><span>They agreed to get texts about it</span></label><div class="acts"><button class="btn ok" type="button" id="go">Make invoice</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');
  $('#go').onclick=function(){var b=this;b.disabled=true;post('quote',{action:'invoice',id:+id,email:$('#qie').value,phone:$('#qip').value,due:$('#qd').value,payLink:$('#ql2').value,consent:$('#qc').checked}).then(function(res){b.disabled=false;if(res.j.ok){close();toast('Invoice made. We’ll draft reminders if it runs late.');load(true);}else toast(res.j.error||'Could not save.');});};
}
function jobAddSheet(){
  sheet('<h2>Add a job</h2><label>Customer’s name<input type="text" id="jn" maxlength="80"></label><label>Phone (optional)<input type="tel" id="jp" maxlength="20"></label><label>What’s the job?<input type="text" id="jt" maxlength="200"></label>'+(isTech()?'':'<label>Amount (optional)<input type="text" id="ja" inputmode="decimal" placeholder="$"></label>')+'<div class="acts"><button class="btn ok" type="button" id="go">Add</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');
  $('#go').onclick=function(){var b=this;b.disabled=true;post('work',{action:'add',name:$('#jn').value,phone:$('#jp').value,title:$('#jt').value,amount:$('#ja')?$('#ja').value:''}).then(function(res){b.disabled=false;if(res.j.ok){close();JOBF='new';load(true);toast('Job added.');}else toast(res.j.error||'Could not add.');});};
}
function actSheet(){
  var a=S.activity||[];
  sheet('<h2>Who did what</h2>'+(a.length?'<div class="list">'+a.map(function(x){return '<p class="note" style="margin:6px 0"><b>'+esc(x.who)+'</b>'+(x.role&&x.role!=='owner'?' ('+esc(x.role)+')':'')+': '+esc(x.what)+' <span class="tag">'+esc(when(x.at))+'</span></p>';}).join('')+'</div>':'<p class="fine">Nothing yet. Approvals, replies, invoices, estimates and job changes show up here with who did them.</p>')+'<div class="acts"><button class="btn ghost" type="button" data-close="1">Close</button></div>');
}
function bizAct(a,id,t){
  if(a==='bz-inbox')inboxSheet();
  else if(a==='bz-stage-f'){JOBF=id;render();}
  else if(a==='bz-stage'){post('work',{action:'stage',id:+id,stage:t.dataset.s}).then(function(res){if(res.j.ok){(S.jobs||[]).forEach(function(j){if(String(j.id)===String(id))j.stage=t.dataset.s;});render();toast('Moved to '+t.dataset.s+'.');}else toast(res.j.error||'Could not save.');});}
  else if(a==='bz-amt'){var v=prompt('Job amount ($)');if(v!=null)post('work',{action:'amount',id:+id,amount:v}).then(function(){load(true);});}
  else if(a==='bz-job-add')jobAddSheet();
  else if(a==='bz-quote')quoteSheet(id);
  else if(a==='bz-q-copy'){var q=(S.quotes||[]).filter(function(x){return String(x.id)===String(id);})[0];if(q)copyText(q.link,'Estimate link copied.');}
  else if(a==='bz-q-inv')quoteInvSheet(id);
  else if(a==='bz-stripe'){t.disabled=true;post('stripe',{action:'connect'}).then(function(res){t.disabled=false;if(res.j.ok&&res.j.url)location.href=res.j.url;else{toast(res.j.error||'Could not start. Try again.');if(res.j.comingSoon)load(true);}});}
  else if(a==='bz-reply'){var ta=document.getElementById('r-'+id),tx=ta?ta.value.trim():'';if(!tx){toast('Type a reply first.');return;}t.disabled=true;post('inbox',{action:'reply',id:id,text:tx}).then(function(res){t.disabled=false;if(res.j.ok){toast('Sent.');inboxSheet();}else toast(res.j.error||'Could not send.');});}
  else if(a==='bz-role'){post('team',{id:id,role:t.dataset.s}).then(function(res){if(res.j.ok){(S.team||[]).forEach(function(m){if(m.id===id)m.role=t.dataset.s;});render();toast('Role saved.');}else toast('Could not save.');});}
  else if(a==='bz-act')actSheet();
  else if(a==='bz-ob-hide')post('prefs',{onboard:'dismiss'}).then(function(){S.onboarding.show=false;render();});
  else if(a==='bz-ob-share'){if(S.quoteLink){copyText(S.bookLink&&S.calendar&&S.calendar.connected?S.bookLink:S.quoteLink,'Link copied. Put it on your site, Google profile and texts.');post('prefs',{onboard:'shared'}).then(function(){load(true);});}}
  else if(a==='bz-ob-help'){if(id)location.href=BASE+id;}
  else if(a==='bz-map')mapSheet();
  else if(a==='bz-map-save'){var b=$('[data-a="bz-map-save"]');b.disabled=true;post('map',{show:$('#mp-show').checked,phone:$('#mp-phone').value,address:$('#mp-addr').value}).then(function(res){b.disabled=false;if(res.j.ok){S.map=res.j.map;close();toast('Map listing saved.');load(true);}else toast(res.j.error||'Could not save.');});}
  else if(a==='bz-ob-hours')hoursSheet();
  else if(a==='bz-ob-cal'){location.href='/google/connect?code='+encodeURIComponent(BASE.split('/').pop());}
  else if(a==='bz-ob-fb'){location.href='/meta/connect?code='+encodeURIComponent(BASE.split('/').pop());}
  else if(a==='bz-ob-max'){if(S.line)location.href='tel:'+S.line.number;}
}
document.addEventListener('change',function(e){var t=e.target;if(!t)return;
  if(t.id==='bz-weekly')post('prefs',{weekly:t.checked}).then(function(res){if(res.j.ok){S.weekly=t.checked;toast(t.checked?'Weekly summary on.':'Weekly summary off.');}});
  if(t.id==='bz-ci'){post('checkins',{on:t.checked}).then(function(res){if(res.j.ok){S.checkins.on=res.j.on;toast(res.j.message||'Saved.');}else{t.checked=!t.checked;toast(res.j.error||'Could not save.');}});}
  if(t.id==='bz-ho-give'||t.id==='bz-ho-take'){var body={};body[t.id==='bz-ho-give'?'give':'take']=t.checked;post('handoff',body).then(function(res){if(res.j.ok){S.handoff.give=res.j.give;S.handoff.take=res.j.take;toast('Saved.');load();}else{t.checked=!t.checked;toast(res.j.error||'Could not save.');}});}
  if(t.id==='bz-map')post('map',{show:t.checked}).then(function(res){if(res.j.ok){S.map=res.j.map;toast(t.checked?'You are on the map.':'You are off the map.');render();}else{t.checked=!t.checked;toast(res.j.error||'Could not save.');}});
  if(t.id==='bz-es')post('line',{spanish:t.checked}).then(function(res){if(res.j.ok){if(S.line)S.line.spanish=t.checked;toast(t.checked?'Spanish callers get Spanish.':'English only.');}else{t.checked=!t.checked;toast(res.j.error||'Could not save.');}});
});
`;
