// Web app screens for past customers: the import, the customer list, and the "ready to hear from you" messages.
// This text is placed inside the app page's script (apppage.js), so it can use S, esc, post, api, sheet, close, toast, render, load, copyText, money, isTech.
export const PAST_JS = String.raw`
/* ---------- past customers ---------- */
var PCSV='',PMAP=null,PSEARCH='';
function pastBlock(){
  var p=S.past;if(!p||S.client.regulated||isTech())return '';
  var rv=p.revive||{},n=rv.count||0;
  var h='<h2>Past customers</h2><div class="card">';
  if(n)h+='<b>'+n+(n===1?' past customer looks':' past customers look')+' ready to hear from you</b><p class="note" style="margin:4px 0 10px">'+(rv.value?'About '+money(rv.value)+' of work, based on your own past jobs. ':'')+'Each message waits for your OK.</p><div class="acts"><button class="btn ok" type="button" data-a="pc-review">Review '+(n===1?'the message':'the '+n+' messages')+'</button></div>';
  else if(p.customers)h+='<b>No one is due right now</b><p class="note" style="margin:4px 0 10px">Every Monday we look for past customers who haven’t heard from you in a while, or whose equipment is getting older.</p>';
  else h+='<b>Find money in your old jobs</b><p class="note" style="margin:4px 0 10px">Upload a list of your past customers. Every Monday we show you who looks ready to hear from you again, with a message written for each. You approve every one.</p>';
  h+='<div class="acts" style="margin-top:8px"><button class="btn line sm" type="button" data-a="pc-import">Import a customer list</button>'+(p.customers?'<button class="btn ghost sm" type="button" data-a="pc-list">Customers ('+p.customers+')</button>':'')+'<button class="btn ghost sm" type="button" data-a="pc-refresh">Look again</button></div></div>';
  return h;
}
function pcReload(then){
  return api('state').then(function(res){if(res.j&&res.j.ok){S=res.j;render();}if(then)then();});
}
function pcWhen(i){return i.status==='sent'?'Sent':(i.status==='queued'?((i.result.indexOf('waiting')>-1||i.result.indexOf('after hours')>-1)?'Held until morning':'Queued'):(i.status==='copied'?'You’re sending it yourself':'Skipped'));}
function reviveSheet(){
  var rv=(S.past&&S.past.revive)||{items:[]},all=rv.items||[];
  var pend=all.filter(function(i){return i.status==='pending';}),done=all.filter(function(i){return i.status!=='pending';});
  var h='<h2>Past customers ready</h2><p class="fine">Edit any message, then approve. Nothing goes out until you do, and only to customers marked OK to contact.</p>';
  h+=pend.length?'<div class="list">'+pend.map(function(i){
    var how=i.hasEmail?'Sends by email.':(i.hasPhone?(rv.textingOn?'Sends as a text.':'Texts start once carriers approve your number. You can copy it to send yourself.'):'');
    return '<article class="card" id="pc-'+i.id+'"><b>'+esc(i.name)+'</b>'+(i.value?'<span class="tag" style="float:right">about '+money(i.value)+'</span>':'')+'<p class="note" style="margin:4px 0">'+esc(i.reason)+' · '+esc(i.basis)+'</p>'+
      '<label>Message<textarea id="pc-t-'+i.id+'" rows="4" maxlength="700">'+esc(i.text)+'</textarea></label>'+
      '<p class="fine" style="margin:4px 0">'+(i.optout?'They asked us to stop.':(i.agreed?how:'Not marked OK to contact yet.'))+'</p>'+
      '<div class="acts">'+(i.optout?'':(i.agreed?'<button class="btn ok sm" type="button" data-a="pc-approve" data-id="'+i.id+'">Approve and send</button>':'<button class="btn line sm" type="button" data-a="pc-agree" data-id="'+i.id+'">They said it’s OK</button>'))+
      '<button class="btn ghost sm" type="button" data-a="pc-copy" data-id="'+i.id+'">Copy</button><button class="btn ghost sm" type="button" data-a="pc-skip" data-id="'+i.id+'">Skip</button></div></article>';
  }).join('')+'</div>':'<div class="empty slim"><b>All caught up</b><span>We look again every Monday.</span></div>';
  if(done.length)h+='<h2>Recent</h2><div class="list">'+done.slice(0,8).map(function(i){return '<p class="note" style="margin:4px 0"><b>'+esc(i.name)+'</b>: '+esc(pcWhen(i))+'</p>';}).join('')+'</div>';
  sheet(h+'<div class="acts"><button class="btn ghost" type="button" data-close="1">Close</button></div>');
}
var PF=[['name','Name'],['phone','Phone'],['email','Email'],['work','What was done'],['date','Date'],['amount','Amount']];
function importSheet(res){
  var h='<h2>Import your customers</h2>';
  if(!res){
    h+='<p class="fine">Export your customer or job list from your invoicing software or spreadsheet as a CSV file, then choose it here. We look for name, phone, email, what was done, the date and the amount. Nothing is sent to anyone.</p><label>CSV file<input type="file" id="pc-file" accept=".csv,.tsv,.txt,text/csv,text/plain"></label><div class="acts"><button class="btn ghost" type="button" data-close="1">Cancel</button></div>';
    return sheet(h);
  }
  h+='<p class="note" style="margin:0"><b>'+res.valid+'</b> of '+res.total+' rows can be used, for <b>'+res.customers+'</b> customers.'+(res.skipped?' '+res.skipped+' skipped.':'')+'</p>';
  if(res.problems&&res.problems.length)h+='<p class="fine">Skipped: '+res.problems.map(function(p){return 'row '+p.row+' ('+esc(p.why)+')';}).join(', ')+(res.skipped>res.problems.length?' …':'')+'</p>';
  h+='<div class="list">'+(res.sample||[]).map(function(s){return '<p class="note" style="margin:2px 0"><b>'+esc(s.name||'(no name)')+'</b> · '+esc(s.phone||s.email)+(s.work?' · '+esc(s.work):'')+(s.date?' · '+esc(s.date):'')+(s.amount?' · '+money(s.amount):'')+'</p>';}).join('')+'</div>';
  h+='<details style="margin:8px 0"><summary>Check the columns</summary>'+PF.map(function(f){
    return '<label>'+f[1]+'<select data-pcmap="'+f[0]+'"><option value="-1">(none)</option>'+res.columns.map(function(c,i){return '<option value="'+i+'"'+(res.map[f[0]]===i?' selected':'')+'>'+esc(c)+'</option>';}).join('')+'</select></label>';}).join('')+'</details>';
  h+='<label class="opt" style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" id="pc-agreed"> <span>These customers have said it’s OK for us to contact them. Leave this unchecked if you’re not sure; you can mark people one at a time later.</span></label>';
  h+='<div class="acts"><button class="btn ok" type="button" data-a="pc-save"'+(res.valid?'':' disabled')+'>Import '+res.valid+' rows</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>';
  sheet(h);
}
function pcPreview(){
  post('import',{action:'preview',csv:PCSV,map:PMAP||undefined}).then(function(r){
    if(!r.j.ok){toast(r.j.error||'Could not read that file.');importSheet(null);return;}
    PMAP=r.j.map;importSheet(r.j);
  }).catch(function(){toast('No connection. Try again.');});
}
function listSheet(){
  sheet('<h2>Past customers</h2><p class="fine">Loading…</p>');
  post('import',{action:'list',q:PSEARCH}).then(function(r){
    var j=r.j;if(!j.ok){toast(j.error||'Could not load.');close();return;}
    var h='<h2>Past customers</h2><p class="note" style="margin:0">'+j.total+' customers · '+j.agreed+' marked OK to contact</p><label>Search<input type="search" id="pc-q" value="'+esc(PSEARCH)+'" maxlength="40" placeholder="Name, phone or email"></label>';
    h+='<div class="list">'+j.customers.map(function(c){
      return '<article class="card"><b>'+esc(c.name||'(no name)')+'</b><p class="note" style="margin:2px 0">'+esc(c.phone||'')+(c.phone&&c.email?' · ':'')+esc(c.email||'')+'</p><div class="acts">'+
        (c.optout?'<span class="tag">Asked us to stop</span>':'<button class="btn '+(c.agreed?'ok':'line')+' sm" type="button" data-a="pc-ok" data-id="'+c.id+'" data-s="'+(c.agreed?'0':'1')+'">'+(c.agreed?'OK to contact ✓':'Mark OK to contact')+'</button>')+
        '<button class="btn ghost sm" type="button" data-a="pc-forget" data-id="'+c.id+'">Remove</button></div></article>';}).join('')+'</div>';
    if(j.total>j.customers.length)h+='<p class="fine">Showing the first '+j.customers.length+'. Search to find someone.</p>';
    h+='<div class="acts" style="margin-top:8px"><button class="btn line sm" type="button" data-a="pc-allok">Mark everyone OK to contact</button><button class="btn ghost sm" type="button" data-a="pc-wipe">Remove all imported customers</button><button class="btn ghost sm" type="button" data-close="1">Close</button></div>';
    sheet(h);
    var q=document.getElementById('pc-q');if(q){q.focus();q.setSelectionRange(q.value.length,q.value.length);}
  }).catch(function(){toast('No connection. Try again.');close();});
}
function pastAct(a,id,t){
  if(a==='pc-review')reviveSheet();
  else if(a==='pc-import'){PCSV='';PMAP=null;importSheet(null);}
  else if(a==='pc-list'){PSEARCH='';listSheet();}
  else if(a==='pc-refresh'){t.disabled=true;post('revive',{action:'refresh'}).then(function(r){t.disabled=false;if(r.j.ok){pcReload(function(){toast(r.j.count?r.j.count+' ready to review.':'No one new this time.');});}else toast(r.j.error||'Could not look. Try again.');});}
  else if(a==='pc-save'){
    t.disabled=true;
    post('import',{action:'save',csv:PCSV,map:PMAP||undefined,agreed:!!(document.getElementById('pc-agreed')||{}).checked}).then(function(r){
      t.disabled=false;
      if(r.j.ok){close();PCSV='';PMAP=null;toast('Imported '+r.j.customers+' customers.');post('revive',{action:'refresh'}).then(function(){pcReload();});}
      else toast(r.j.error||'Could not import. Try again.');
    }).catch(function(){t.disabled=false;toast('No connection. Try again.');});
  }
  else if(a==='pc-agree'){post('revive',{action:'agree',id:+id}).then(function(r){if(r.j.ok)pcReload(reviveSheet);else toast(r.j.error||'Could not save.');});}
  else if(a==='pc-approve'){
    var ta=document.getElementById('pc-t-'+id);t.disabled=true;
    post('revive',{action:'approve',id:+id,text:ta?ta.value:''}).then(function(r){
      t.disabled=false;
      if(r.j.ok){toast(r.j.status==='sent'?'Sent.':'Saved. It goes out in the morning.');pcReload(reviveSheet);}
      else toast(r.j.error||'Could not send. Try again.');
    });
  }
  else if(a==='pc-copy'){var tb=document.getElementById('pc-t-'+id);if(tb){copyText(tb.value,'Copied. It’s marked as yours to send.');post('revive',{action:'copied',id:+id}).then(function(){pcReload(function(){var c=document.getElementById('pc-'+id);if(c)c.remove();});});}}
  else if(a==='pc-skip'){post('revive',{action:'skip',id:+id}).then(function(){pcReload(reviveSheet);});}
  else if(a==='pc-ok'){post('import',{action:'agree',id:+id,agreed:t.dataset.s==='1'}).then(function(){pcReload(listSheet);});}
  else if(a==='pc-allok'){if(confirm('Only do this if every customer on your list has said it’s OK to contact them. Continue?'))post('import',{action:'agree',all:true,agreed:true}).then(function(){pcReload(listSheet);});}
  else if(a==='pc-forget'){if(confirm('Remove this customer and their imported jobs?'))post('import',{action:'forget',id:+id}).then(function(){pcReload(listSheet);});}
  else if(a==='pc-wipe'){if(confirm('Remove every imported customer and job? Customers who asked us to stop stay on the list so they are never contacted.'))post('import',{action:'wipe',confirm:true}).then(function(){pcReload(function(){close();toast('Removed.');});});}
}
document.addEventListener('change',function(e){var t=e.target;if(!t)return;
  if(t.id==='pc-file'&&t.files&&t.files[0]){
    var f=t.files[0];if(f.size>1400000){toast('That file is too big. Keep it under about 1 MB.');return;}
    var rd=new FileReader();rd.onload=function(){PCSV=String(rd.result||'');PMAP=null;pcPreview();};rd.onerror=function(){toast('Could not read that file.');};rd.readAsText(f);
  }
  if(t.dataset&&t.dataset.pcmap){PMAP=PMAP||{};var d={};Array.prototype.forEach.call(document.querySelectorAll('select[data-pcmap]'),function(s){d[s.dataset.pcmap]=+s.value;});PMAP=d;pcPreview();}
});
document.addEventListener('input',function(e){var t=e.target;if(t&&t.id==='pc-q'){clearTimeout(pcSearchT);pcSearchT=setTimeout(function(){PSEARCH=t.value;listSheet();},350);}});
var pcSearchT=0;
`;
