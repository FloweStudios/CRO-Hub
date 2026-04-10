import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const token = (req.query.token || '').replace(/\.js$/, '');
  if (!token) {
    res.setHeader('Content-Type', 'application/javascript');
    return res.status(400).send('// missing token');
  }

  const { data: client, error } = await supabase
    .from('clients')
    .select('id, domain, secret_key')
    .eq('id', token)
    .single();

  if (error || !client) {
    res.setHeader('Content-Type', 'application/javascript');
    return res.status(200).send('/* crohub: unknown client */');
  }

  const { data: goals } = await supabase
    .from('conversion_goals')
    .select('id, type, url_pattern, css_selector, match_type')
    .eq('client_id', client.id)
    .eq('active', true);

  // Fetch registered form definitions so tracker knows which selectors to watch
  const { data: formDefs } = await supabase
    .from('form_definitions')
    .select('id, selector, name')
    .eq('client_id', client.id)
    .eq('active', true);

  const script = buildScript({
    clientId:  client.id,
    domain:    client.domain,
    secretKey: client.secret_key,
    ingestUrl: `https://${req.headers.host}/api/ingest`,
    goals:     goals    || [],
    formDefs:  formDefs || [],
  });

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).send(script);
}

function buildScript({ clientId, domain, secretKey, ingestUrl, goals, formDefs }) {
  const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
  const goalsJson   = JSON.stringify(goals.map(g => ({ id: g.id, type: g.type, url: g.url_pattern || null, sel: g.css_selector || null, match: g.match_type || 'exact' })));
  const formDefsJson = JSON.stringify(formDefs.map(f => ({ id: f.id, sel: f.selector, name: f.name })));

  return `!function(){'use strict';
var _dom='${esc(cleanDomain)}',_h=location.hostname.toLowerCase();
_h=_h.indexOf('www.')===0?_h.slice(4):_h;
if(_h!==_dom&&_h.slice(-(_dom.length+1))!=='.'+_dom)return;

var _cid='${esc(clientId)}',_sec='${esc(secretKey)}',_ing='${esc(ingestUrl)}';
var _goals=${goalsJson};
var _formDefs=${formDefsJson};
var _FLUSH=2000,_QK='__crq_${clientId.replace(/[^a-z0-9]/g,'_')}__',_MAX=200;

function _uuid(){
  if(crypto.randomUUID)return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){
    var r=(Math.random()*16)|0;return(c==='x'?r:(r&0x3)|0x8).toString(16);
  });
}

var _sid=(function(){
  try{var k='__crs__',s=sessionStorage.getItem(k);
    if(!s){s=_uuid();sessionStorage.setItem(k,s);}return s;
  }catch(e){return _uuid();}
})();

var _vid=(function(){
  try{var k='__crv__',v=localStorage.getItem(k);
    if(!v){v=_uuid();localStorage.setItem(k,v);}return v;
  }catch(e){return null;}
})();

var _dt=(function(){var w=window.innerWidth;
  return w<768?'mobile':w<1024?'tablet':'desktop';
})();

var _tz=(function(){
  try{return Intl.DateTimeFormat().resolvedOptions().timeZone;}catch(e){return null;}
})();

var _utms=(function(){
  var p=new URLSearchParams(location.search);
  var u={utm_source:p.get('utm_source'),utm_medium:p.get('utm_medium'),
    utm_campaign:p.get('utm_campaign'),utm_term:p.get('utm_term'),
    utm_content:p.get('utm_content')};
  try{
    var stored=JSON.parse(sessionStorage.getItem('__cru__')||'{}');
    if(!stored.utm_source&&u.utm_source){sessionStorage.setItem('__cru__',JSON.stringify(u));return u;}
    return stored.utm_source?stored:u;
  }catch(e){return u;}
})();

function _xp(el){
  if(!el||el.nodeType!==1)return'';
  if(el===document.body)return'/body';
  if(el.id&&document.querySelectorAll('#'+CSS.escape(el.id)).length===1)
    return'//*[@id="'+el.id+'"]';
  var pts=[],n=el;
  while(n&&n.nodeType===1&&n!==document.body){
    var t=n.tagName.toLowerCase();
    var s=n.parentNode?Array.prototype.filter.call(n.parentNode.childNodes,
      function(x){return x.nodeType===1&&x.tagName===n.tagName;}):[];
    pts.unshift(s.length>1?t+'['+(s.indexOf(n)+1)+']':t);
    if(n.parentNode&&n.parentNode.id&&
       document.querySelectorAll('#'+CSS.escape(n.parentNode.id)).length===1){
      pts.unshift('//*[@id="'+n.parentNode.id+'"]');return pts.join('/');}
    n=n.parentNode;}
  return'/body/'+pts.join('/');}

function _lq(){try{return JSON.parse(localStorage.getItem(_QK)||'[]');}catch(e){return[];}}
function _sq(q){try{localStorage.setItem(_QK,JSON.stringify(q));}catch(e){}}
function _enq(ev){var q=_lq();q.push(ev);if(q.length>_MAX)q=q.slice(-_MAX);_sq(q);}

function _flush(beacon){
  var q=_lq();if(!q.length)return;
  var body=JSON.stringify({client_id:_cid,events:q});
  var h={'Content-Type':'application/json','X-CRO-Secret':_sec};
  if(beacon&&navigator.sendBeacon){
    if(navigator.sendBeacon(_ing,new Blob([body],{type:'application/json'})))_sq([]);
  }else{
    fetch(_ing,{method:'POST',headers:h,body:body,keepalive:true})
      .then(function(r){if(r.ok)_sq([]);}).catch(function(){});
  }
}

function _base(type){
  var ev={event_id:_uuid(),type:type,client_id:_cid,session_id:_sid,
    visitor_id:_vid,url:location.href,referrer:document.referrer||null,
    device_type:_dt,screen_width:window.innerWidth,screen_height:window.innerHeight,
    timezone:_tz,ts:new Date().toISOString()};
  if(_utms.utm_source)ev.utm_source=_utms.utm_source;
  if(_utms.utm_medium)ev.utm_medium=_utms.utm_medium;
  if(_utms.utm_campaign)ev.utm_campaign=_utms.utm_campaign;
  if(_utms.utm_term)ev.utm_term=_utms.utm_term;
  if(_utms.utm_content)ev.utm_content=_utms.utm_content;
  return ev;
}

var _activeMs=0,_lastActive=Date.now(),_pageHidden=false;
function _flushTop(){
  if(!_pageHidden)_activeMs+=Date.now()-_lastActive;
  if(_activeMs>500)_enq(Object.assign(_base('time_on_page'),{time_on_page_ms:Math.round(_activeMs)}));
}
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='hidden'){
    _activeMs+=Date.now()-_lastActive;_pageHidden=true;_flushTop();_flush(true);
  }else{_lastActive=Date.now();_pageHidden=false;}
});

function _trackPV(){_enq(Object.assign(_base('pageview'),{title:document.title}));}

function _trackClick(e){
  var m=e.target;
  for(var i=0;i<5;i++){
    if(!m||m===document.body)break;
    var tg=m.tagName&&m.tagName.toLowerCase();
    if(tg==='a'||tg==='button'||m.getAttribute('role')==='button'||m.hasAttribute('onclick'))break;
    m=m.parentElement;
  }
  var r=m.getBoundingClientRect();
  _enq(Object.assign(_base('click'),{
    xpath:_xp(m),tag:m.tagName?m.tagName.toLowerCase():null,
    el_id:m.id||null,
    el_classes:m.className&&typeof m.className==='string'
      ?m.className.trim().split(/\s+/).filter(Boolean):[],
    text_content:(m.textContent||'').trim().slice(0,100)||null,
    href:m.href||null,
    scroll_y:Math.round(window.scrollY),
    viewport_x:Math.round(e.clientX),viewport_y:Math.round(e.clientY),
    el_rect:{top:Math.round(r.top),left:Math.round(r.left),
             width:Math.round(r.width),height:Math.round(r.height)}
  }));
  _checkGoals('click',m);
}

function _trackScroll(){
  var _fired={},_tick=false;
  window.addEventListener('scroll',function(){
    if(!_tick){requestAnimationFrame(function(){
      var pct=Math.round(((window.scrollY+window.innerHeight)/document.documentElement.scrollHeight)*100);
      for(var t=5;t<=100;t+=5){
        if(!_fired[t]&&pct>=t){_fired[t]=true;_enq(Object.assign(_base('scroll_depth'),{depth_pct:t}));}}
      _tick=false;});_tick=true;}
  },{passive:true});
}

// ── Form tracking ─────────────────────────────────────────────────────────────
// For each registered form definition:
// 1. On DOM ready: scan the container for all inputs → send form_scan event
// 2. Track focus (start time), blur (fill time per field)
// 3. Track total form time = first focus to last blur/submit
// 4. Track submit

function _getFormFields(container){
  var inputs=Array.prototype.slice.call(
    container.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea')
  );
  return inputs.map(function(el,i){
    // Get best label for this field
    var label='';
    if(el.id){
      var lbl=document.querySelector('label[for="'+el.id+'"]');
      if(lbl)label=lbl.textContent.trim();
    }
    if(!label&&el.placeholder)label=el.placeholder;
    if(!label&&el.name)label=el.name;
    return{
      name:el.name||el.id||('field_'+i),
      type:el.type||el.tagName.toLowerCase(),
      index:i,
      label:label.slice(0,80),
      required:el.required||false,
    };
  });
}

function _normFormId(sel){
  // Normalise selector to a plain ID string for event form_id field
  if(sel.charAt(0)==='#')sel=sel.slice(1);
if(sel.indexOf('form#')===0)sel=sel.slice(5);
if(sel.charAt(0)==='.')sel=sel.slice(1);
return sel.trim();
}

function _initFormTracking(){
  if(!_formDefs||!_formDefs.length)return;

  _formDefs.forEach(function(def){
    var container;
    try{container=document.querySelector(def.sel);}catch(e){return;}
    if(!container)return;

    var formId=_normFormId(def.sel);
    var fields=_getFormFields(container);
    if(!fields.length)return;

    // ── 1. Send form_scan — records field inventory for version detection ──
    _enq(Object.assign(_base('form_scan'),{
      form_id:formId,
      form_fields_snapshot:fields,
    }));

    // Per-field state
    var fieldState={};
    var formStartTime=null;
    var formLastActivityTime=null;

    fields.forEach(function(f){
      fieldState[f.name]={focusTime:null,filled:false};
    });

    // ── 2. Focus: record start time ───────────────────────────────────────
    container.addEventListener('focusin',function(e){
      var el=e.target;
      if(!el||!el.tagName)return;
      var tag=el.tagName.toLowerCase();
      if(tag!=='input'&&tag!=='select'&&tag!=='textarea')return;
      var name=el.name||el.id||'';
      if(!name)return;

      var now=Date.now();
      if(!formStartTime)formStartTime=now;
      if(fieldState[name])fieldState[name].focusTime=now;
    });

    // ── 3. Blur: record fill time ─────────────────────────────────────────
    container.addEventListener('focusout',function(e){
      var el=e.target;
      if(!el||!el.tagName)return;
      var tag=el.tagName.toLowerCase();
      if(tag!=='input'&&tag!=='select'&&tag!=='textarea')return;
      var name=el.name||el.id||'';
      if(!name)return;

      var now=Date.now();
      formLastActivityTime=now;

      var fs=fieldState[name];
      var timeMs=fs&&fs.focusTime?now-fs.focusTime:null;
      var filled=el.value&&el.value.toString().trim().length>0;
      if(fs)fs.filled=filled;

      var fieldDef=fields.filter(function(f){return f.name===name;})[0];
      _enq(Object.assign(_base('form_field'),{
        form_id:formId,
        field_name:name,
        field_type:el.type||tag,
        field_index:fieldDef?fieldDef.index:null,
        time_to_fill_ms:timeMs,
        xpath:_xp(el),
      }));
    });

    // ── 4. Submit: record total time + send form_submit ───────────────────
    // Watch for both form submit and button clicks inside the container
    function handleSubmit(){
      var totalMs=formStartTime?(Date.now()-formStartTime):null;
      _enq(Object.assign(_base('form_submit'),{
        form_id:formId,
        xpath:_xp(container),
        total_form_time_ms:totalMs,
      }));
      _checkGoals('form_submit',container);
    }

    // Native form submit
    var formEl=container.tagName.toLowerCase()==='form'
      ?container
      :container.querySelector('form');
    if(formEl){
      formEl.addEventListener('submit',function(e){handleSubmit();},{passive:true});
    }

    // Also watch submit buttons inside the container (for non-form containers)
    container.addEventListener('click',function(e){
      var el=e.target;
      for(var i=0;i<5;i++){
        if(!el||el===container)break;
        var tg=el.tagName&&el.tagName.toLowerCase();
        if((tg==='button'&&(el.type==='submit'||!el.type))||
           (tg==='input'&&el.type==='submit')||
           el.getAttribute('data-submit')){
          handleSubmit();break;
        }
        el=el.parentElement;
      }
    },{passive:true});
  });
}

var _firedGoals={};

function _urlMatch(url,pattern,matchType){
  try{
    var parts=url.split('/');
    var path=parts.length>3?('/'+parts.slice(3).join('/')):'/';
    if(matchType==='exact')return path===pattern||url===pattern;
    if(matchType==='contains')return url.indexOf(pattern)>-1;
    if(matchType==='starts_with')return path.indexOf(pattern)===0;
    if(matchType==='regex'){return new RegExp(pattern).test(url);}
  }catch(e){}
  return false;
}

function _checkGoals(triggerType,el){
  if(!_goals||!_goals.length)return;
  _goals.forEach(function(g){
    if(_firedGoals[g.id])return;
    var match=false;
    if(g.type==='click'&&triggerType==='click'&&g.sel){
      try{match=el.matches(g.sel);}catch(e){}
    }
    if(g.type==='click_url'&&triggerType==='click'){
      var href=el.href||el.getAttribute('href')||'';
      var node=el;
      for(var i=0;i<5;i++){
        if(!node)break;
        if(node.tagName&&node.tagName.toLowerCase()==='a'){href=node.href||node.getAttribute('href')||'';break;}
        node=node.parentElement;
      }
      if(href)match=_urlMatch(href,g.url||'',g.match||'contains');
    }
    if(g.type==='form_submit'&&triggerType==='form_submit'&&g.sel){
      try{match=el.matches(g.sel);}catch(e){}
    }
    if(match){_firedGoals[g.id]=true;_enq(Object.assign(_base('conversion'),{goal_id:g.id}));}
  });
}

function _trackVisibility(){
  if(!_goals||!window.IntersectionObserver)return;
  var vg=_goals.filter(function(g){return g.type==='element_visible'&&g.sel;});
  if(!vg.length)return;
  var obs=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(!entry.isIntersecting)return;
      var el=entry.target;
      vg.forEach(function(g){
        if(_firedGoals[g.id])return;
        try{if(el.matches(g.sel)){
          _firedGoals[g.id]=true;
          var r=el.getBoundingClientRect();
          _enq(Object.assign(_base('element_visible'),{
            xpath:_xp(el),el_id:el.id||null,goal_id:g.id,
            el_rect:{top:Math.round(r.top),left:Math.round(r.left),
                     width:Math.round(r.width),height:Math.round(r.height)}}));
          _enq(Object.assign(_base('conversion'),{goal_id:g.id}));
        }}catch(e){}
      });
    });
  },{threshold:0.5});
  vg.forEach(function(g){
    try{document.querySelectorAll(g.sel).forEach(function(el){obs.observe(el);});}catch(e){}
  });
}

function _checkPageLoadGoals(){
  if(!_goals)return;
  _goals.filter(function(g){return g.type==='page_load';}).forEach(function(g){
    if(_firedGoals[g.id])return;
    if(_urlMatch(location.href,g.url||'',g.match)){
      _firedGoals[g.id]=true;_enq(Object.assign(_base('conversion'),{goal_id:g.id}));}
  });
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',function(){
    _trackPV();_initFormTracking();_trackVisibility();_checkPageLoadGoals();
  });
}else{
  _trackPV();_initFormTracking();_trackVisibility();_checkPageLoadGoals();
}

document.addEventListener('click',_trackClick,{passive:true});
_trackScroll();
setInterval(function(){_flush(false);},_FLUSH);
window.addEventListener('pagehide',function(){_flushTop();_flush(true);},{passive:true});

}();`;
}
