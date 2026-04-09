export function generateSnippet({ clientId, domain, secretKey, ingestUrl }) {
  const cleanDomain = domain
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .toLowerCase();

  return `<!-- CRO Hub Tracker — ${clientId} -->
<script>
(function(){
  'use strict';
  var ALLOWED='${cleanDomain}';
  var host=location.hostname.toLowerCase().replace(/^www\./,'');
  if(host!==ALLOWED&&!host.endsWith('.'+ALLOWED))return;

  var CLIENT_ID='${clientId}';
  var SECRET='${secretKey}';
  var INGEST_URL='${ingestUrl}';
  var FLUSH_MS=10000;
  var STORE_KEY='__cro_q__';
  var MAX_Q=100;

  function uid(){
    if(crypto.randomUUID)return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){
      var r=(Math.random()*16)|0;return(c==='x'?r:(r&0x3)|0x8).toString(16);
    });
  }

  var SID=(function(){
    try{var k='__cro_sid__',s=sessionStorage.getItem(k);
      if(!s){s=uid();sessionStorage.setItem(k,s);}return s;
    }catch(e){return uid();}
  })();

  var DT=(function(){var w=window.innerWidth;
    return w<768?'mobile':w<1024?'tablet':'desktop';
  })();

  function xp(el){
    if(!el||el.nodeType!==1)return'';
    if(el===document.body)return'/body';
    if(el.id&&document.querySelectorAll('#'+CSS.escape(el.id)).length===1)
      return'//*[@id="'+el.id+'"]';
    var parts=[],node=el;
    while(node&&node.nodeType===1&&node!==document.body){
      var tag=node.tagName.toLowerCase();
      var sibs=node.parentNode?Array.prototype.filter.call(
        node.parentNode.childNodes,function(n){return n.nodeType===1&&n.tagName===node.tagName;}):[];
      parts.unshift(sibs.length>1?tag+'['+(sibs.indexOf(node)+1)+']':tag);
      if(node.parentNode&&node.parentNode.id&&
         document.querySelectorAll('#'+CSS.escape(node.parentNode.id)).length===1){
        parts.unshift('//*[@id="'+node.parentNode.id+'"]');
        return parts.join('/');
      }
      node=node.parentNode;
    }
    return'/body/'+parts.join('/');
  }

  function loadQ(){try{return JSON.parse(localStorage.getItem(STORE_KEY)||'[]');}catch(e){return[];}}
  function saveQ(q){try{localStorage.setItem(STORE_KEY,JSON.stringify(q));}catch(e){}}
  function enq(ev){var q=loadQ();q.push(ev);if(q.length>MAX_Q)q=q.slice(-MAX_Q);saveQ(q);}

  function flush(beacon){
    var q=loadQ();if(!q.length)return;
    var body=JSON.stringify({client_id:CLIENT_ID,events:q});
    var hdrs={'Content-Type':'application/json','X-CRO-Secret':SECRET};
    if(beacon&&navigator.sendBeacon){
      if(navigator.sendBeacon(INGEST_URL,new Blob([body],{type:'application/json'})))saveQ([]);
    }else{
      fetch(INGEST_URL,{method:'POST',headers:hdrs,body:body,keepalive:true})
        .then(function(r){if(r.ok)saveQ([]);}).catch(function(){});
    }
  }

  function base(type){return{
    event_id:uid(),type:type,client_id:CLIENT_ID,session_id:SID,
    url:location.href,referrer:document.referrer||null,
    device_type:DT,screen_width:window.innerWidth,
    screen_height:window.innerHeight,ts:new Date().toISOString()
  };}

  function trackPV(){enq(Object.assign(base('pageview'),{title:document.title}));}

  function trackClick(e){
    var m=e.target;
    for(var i=0;i<5;i++){
      if(!m||m===document.body)break;
      var tg=m.tagName&&m.tagName.toLowerCase();
      if(tg==='a'||tg==='button'||m.getAttribute('role')==='button'||m.hasAttribute('onclick'))break;
      m=m.parentElement;
    }
    var r=m.getBoundingClientRect();
    enq(Object.assign(base('click'),{
      xpath:xp(m),
      tag:m.tagName?m.tagName.toLowerCase():null,
      el_id:m.id||null,
      el_classes:m.className&&typeof m.className==='string'
        ?m.className.trim().split(/\\s+/).filter(Boolean):[],
      text_content:(m.textContent||'').trim().slice(0,100)||null,
      href:m.href||null,
      scroll_y:Math.round(window.scrollY),
      viewport_x:Math.round(e.clientX),viewport_y:Math.round(e.clientY),
      el_rect:{top:Math.round(r.top),left:Math.round(r.left),
               width:Math.round(r.width),height:Math.round(r.height)}
    }));
  }

  function trackScroll(){
    var fired={},tick=false;
    window.addEventListener('scroll',function(){
      if(!tick){requestAnimationFrame(function(){
        var p=Math.round(((window.scrollY+window.innerHeight)/document.documentElement.scrollHeight)*100);
        [25,50,75,100].forEach(function(t){
          if(!fired[t]&&p>=t){fired[t]=true;enq(Object.assign(base('scroll_depth'),{depth_pct:t}));}
        });
        tick=false;
      });tick=true;}
    },{passive:true});
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',trackPV);
  }else{trackPV();}

  document.addEventListener('click',trackClick,{passive:true});
  trackScroll();
  setInterval(function(){flush(false);},FLUSH_MS);
  document.addEventListener('visibilitychange',function(){
    if(document.visibilityState==='hidden')flush(true);
  });
  window.addEventListener('pagehide',function(){flush(true);},{passive:true});
})();
<\/script>
<!-- End CRO Hub Tracker -->`;
}
