(function($){
'use strict';
const C=window.OmexDemo||{};
let socket=null,sessionId=null,ttlInterval=null,ttlLeft=0;
const step=id=>{$('.omex-step').hide();$('#omex-step-'+id).show();};
$(function(){
  if(!$('#omex-demo-app').length)return;
  bindForm();bindEnd();bindRestart();
});
function bindForm(){
  $('#omex-form').on('submit',async e=>{
    e.preventDefault();
    const company=$('#omex-company').val().trim();
    const services=$('#omex-services').val().trim();
    const site_url=$('#omex-site').val().trim();
    if(!company){showErr('El nombre de tu empresa es requerido.');return;}
    clearErr();setLoading(true);
    if(site_url){step('scan');startBar();}
    try{
      const data=await wpPost('/create',{company,services,site_url});
      if(!data.ok){step('form');setLoading(false);showErr(data.error||'Error al crear el demo.');return;}
      sessionId=data.session_id;
      if(data.scan_facts)renderFacts(data.scan_facts);
      connectSocket(sessionId);
    }catch(err){
      step('form');setLoading(false);
      showErr('No se pudo conectar con el servidor. Intenta de nuevo.');
    }
  });
}
function connectSocket(sid){
  if(socket)socket.disconnect();
  socket=io(C.socketUrl,{transports:['websocket','polling']});
  socket.on('connect',()=>socket.emit('subscribe',{session_id:sid}));
  socket.on('qr',({qr})=>{$('#omex-qr-img').attr('src',qr);step('qr');setLoading(false);});
  socket.on('connected',({company})=>{$('#omex-cname').text(company);step('live');startTTL();});
  socket.on('message',({direction,text,ts})=>addMsg(direction,text,ts));
  socket.on('expired',()=>{stopTTL();step('end');});
  socket.on('disconnected',()=>{stopTTL();step('end');});
  socket.on('error',({message})=>{step('form');setLoading(false);showErr(message);});
}
function addMsg(dir,text,ts){
  const time=new Date(ts).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'});
  const cls=dir==='in'?'omex-msg-in':'omex-msg-out';
  const who=dir==='in'?'Cliente':'Bot';
  const html='<div class="omex-msg '+cls+'"><div class="omex-bubble"><span class="omex-who">'+who+'</span><p>'+esc(text)+'</p><span class="omex-time">'+time+'</span></div></div>';
  const $c=$('#omex-chat');$c.append(html);$c.scrollTop($c[0].scrollHeight);
}
function startTTL(){
  ttlLeft=C.ttlMin*60;updateTTL();
  ttlInterval=setInterval(()=>{ttlLeft--;updateTTL();if(ttlLeft<=0)stopTTL();},1000);
}
function updateTTL(){
  const m=String(Math.floor(ttlLeft/60)).padStart(2,'0');
  const s=String(ttlLeft%60).padStart(2,'0');
  $('#omex-ttl-val').text(m+':'+s);
}
function stopTTL(){clearInterval(ttlInterval);ttlInterval=null;}
function renderFacts(f){
  const map={description:'Descripcion',services:'Servicios',location:'Ubicacion',hours:'Horario',price_range:'Precios'};
  let html='<ul>';
  for(const[k,label]of Object.entries(map)){
    const v=f[k];
    if(!v||(Array.isArray(v)&&!v.length))continue;
    html+='<li><b>'+label+':</b> '+esc(Array.isArray(v)?v.join(', '):String(v))+'</li>';
  }
  html+='</ul>';
  $('#omex-facts-content').html(html);$('#omex-facts').show();
}
function bindEnd(){
  $(document).on('click','#omex-end',async()=>{
    if(sessionId)await wpDelete('/destroy/'+sessionId).catch(()=>{});
    stopTTL();step('end');
  });
}
function bindRestart(){
  $(document).on('click','#omex-restart',()=>{
    if(socket){socket.disconnect();socket=null;}
    sessionId=null;stopTTL();
    $('#omex-chat').empty();$('#omex-form')[0].reset();
    clearErr();setLoading(false);step('form');
  });
}
const wpPost=(p,d)=>$.ajax({url:C.restUrl+p,method:'POST',contentType:'application/json',data:JSON.stringify(d),headers:{'X-WP-Nonce':C.nonce}});
const wpDelete=p=>$.ajax({url:C.restUrl+p,method:'DELETE',headers:{'X-WP-Nonce':C.nonce}});
function setLoading(on){$('#omex-submit').prop('disabled',on);$('.omex-btn-label').toggle(!on);$('.omex-btn-loading').toggle(on);}
function showErr(msg){$('#omex-error').text(msg).show();}
function clearErr(){$('#omex-error').hide().text('');}
function startBar(){
  let w=0;
  const iv=setInterval(()=>{w=Math.min(w+Math.random()*7,88);$('.omex-bar-fill').css('width',w+'%');if(w>=88)clearInterval(iv);},350);
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
})(jQuery);
