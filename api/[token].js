// api/track/[token].js — v2
// Serves a per-partner obfuscated tracker script.
// New in v2: visitor_id, UTMs, time_on_page, form analytics,
//            element_visible (IntersectionObserver), 5% scroll depth,
//            conversion goal evaluation client-side.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CACHE_SECONDS = 3600;

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

  // Fetch active conversion goals for this client so the tracker
  // can evaluate them client-side without extra round trips
  const { data: goals } = await supabase
    .from('conversion_goals')
    .select('id, type, url_pattern, css_selector, match_type')
    .eq('client_id', client.id)
    .eq('active', true);

  const script = buildScript({
    clientId:  client.id,
    domain:    client.domain,
    secretKey: client.secret_key,
    ingestUrl: `https://${req.headers.host}/api/ingest`,
    goals:     goals || [],
  });

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).send(script);
}

function buildScript({ clientId, domain, secretKey, ingestUrl, goals }) {
  const esc  = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
  const goalsJson = JSON.stringify(goals.map(g => ({
    id: g.id, type: g.type,
    url: g.url_pattern || null,
    sel: g.css_selector || null,
    match: g.match_type || 'exact',
  })));

  return `!function(){'use strict';

// ── Domain lock ───────────────────────────────────────────────────────────────
var _dom='${esc(cleanDomain)}',_h=location.hostname.toLowerCase().replace(/^www\./,'');
if(_h!==_dom&&!_h.endsWith('.'+_dom))return;

// ── Config ────────────────────────────────────────────────────────────────────
var _cid='${esc(clientId)}',_sec='${esc(secretKey)}',_ing='${esc(ingestUrl)}';
var _goals=${goalsJson};
var _FLUSH=10000,_QK='__crq_${clientId.replace(/[^a-z0-9]/g,'_')}__',_MAX=150;

// ── IDs ───────────────────────────────────────────────────────────────────────
function _uuid(){if(crypto.randomUUID)return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){
    var r=(Math.random()*16)|0;return(c==='x'?r:(r&0x3)|0x8).toString(16);});}

// session_id — tab-scoped
var _sid=(function(){try{var k='__crs__',s=sessionStorage.getItem(k);
  if(!s){s=_uuid();sessionStorage.setItem(k,s);}return s;}catch(e){return _uuid();}})();

// visitor_id — persistent across sessions (localStorage)
var _vid=(function(){try{var k='__crv__',v=localStorage.getItem(k);
  if(!v){v=_uuid();localStorage.setItem(k,v);}return v;}catch(e){return null;}})();

// ── Device + timezone ─────────────────────────────────────────────────────────
var _dt=(function(){var w=window.innerWidth;
  return w<768?'mobile':w<1024?'tablet':'desktop';})();
var _tz=(function(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone;}catch(e){return null;}})();

// ── UTM parsing ───────────────────────────────────────────────────────────────
var _utms=(function(){
  var p=new URLSearchParams(location.search);
  var u={utm_source:p.get('utm_source'),utm_medium:p.get('utm_medium'),
         utm_campaign:p.get('utm_campaign'),utm_term:p.get('utm_term'),
         utm_content:p.get('utm_content')};
  // Persist UTMs for the session so they survive navigation
  try{
    var stored=JSON.parse(sessionStorage.getItem('__cru__')||'{}');
    // First-touch: only store if not already set this session
    if(!stored.utm_source&&u.utm_source){sessionStorage.setItem('__cru__',JSON.stringify(u));return u;}
    return stored.utm_source?stored:u;
  }catch(e){return u;}
})();

// ── XPath ─────────────────────────────────────────────────────────────────────
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

// ── Queue ─────────────────────────────────────────────────────────────────────
function _lq(){try{return JSON.parse(localStorage.getItem(_QK)||'[]');}catch(e){return[];}}
function _sq(q){try{localStorage.setItem(_QK,JSON.stringify(q));}catch(e){}}
function _enq(ev){var q=_lq();q.push(ev);if(q.length>_MAX)q=q.slice(-_MAX);_sq(q);}

// ── Flush ─────────────────────────────────────────────────────────────────────
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

// ── Base event ────────────────────────────────────────────────────────────────
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

// ── Pageview ──────────────────────────────────────────────────────────────────
var _pvStart=Date.now();
function _trackPV(){_enq(Object.assign(_base('pageview'),{title:document.title}));}

// ── Time on page ──────────────────────────────────────────────────────────────
var _activeMs=0,_lastActive=Date.now(),_pageHidden=false;
function _flushTimeOnPage(){
  if(!_pageHidden)_activeMs+=Date.now()-_lastActive;
  if(_activeMs>500){
    _enq(Object.assign(_base('time_on_page'),{time_on_page_ms:Math.round(_activeMs)}));
  }
}
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='hidden'){
    _activeMs+=Date.now()-_lastActive;
    _pageHidden=true;
    _flushTimeOnPage();
    _flush(true);
  }else{
    _lastActive=Date.now();
    _pageHidden=false;
  }
});

// ── Click ─────────────────────────────────────────────────────────────────────
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
      ?m.className.trim().split(/\\s+/).filter(Boolean):[],
    text_content:(m.textContent||'').trim().slice(0,100)||null,
    href:m.href||null,
    scroll_y:Math.round(window.scrollY),
    viewport_x:Math.round(e.clientX),viewport_y:Math.round(e.clientY),
    el_rect:{top:Math.round(r.top),left:Math.round(r.left),
             width:Math.round(r.width),height:Math.round(r.height)}
  }));
  _checkGoals('click',m);
}

// ── Scroll depth (every 5%) ───────────────────────────────────────────────────
function _trackScroll(){
  var _fired={},_tick=false;
  window.addEventListener('scroll',function(){
    if(!_tick){requestAnimationFrame(function(){
      var pct=Math.round(((window.scrollY+window.innerHeight)
        /document.documentElement.scrollHeight)*100);
      for(var t=5;t<=100;t+=5){
        if(!_fired[t]&&pct>=t){
          _fired[t]=true;
          _enq(Object.assign(_base('scroll_depth'),{depth_pct:t}));
        }
      }
      _tick=false;
    });_tick=true;}
  },{passive:true});
}

// ── Form analytics ────────────────────────────────────────────────────────────
function _trackForms(){
  document.addEventListener('focusin',function(e){
    var el=e.target;
    if(!el||!el.tagName)return;
    var tag=el.tagName.toLowerCase();
    if(tag!=='input'&&tag!=='select'&&tag!=='textarea')return;
    el.__croFocusTime=Date.now();
  });

  document.addEventListener('focusout',function(e){
    var el=e.target;
    if(!el||!el.tagName)return;
    var tag=el.tagName.toLowerCase();
    if(tag!=='input'&&tag!=='select'&&tag!=='textarea')return;
    var form=el.closest('form');
    var timeMs=el.__croFocusTime?Date.now()-el.__croFocusTime:null;
    var idx=form?Array.prototype.indexOf.call(
      form.querySelectorAll('input,select,textarea'),el):-1;
    _enq(Object.assign(_base('form_field'),{
      form_id:(form&&(form.id||form.name))||null,
      field_name:el.name||el.id||null,
      field_type:el.type||tag,
      time_to_fill_ms:timeMs,
      field_index:idx>=0?idx:null,
      xpath:_xp(el),
    }));
  });

  document.addEventListener('submit',function(e){
    var form=e.target;
    if(!form||form.tagName.toLowerCase()!=='form')return;
    _enq(Object.assign(_base('form_submit'),{
      form_id:(form.id||form.name)||null,
      xpath:_xp(form),
    }));
    _checkGoals('form_submit',form);
  },{passive:true});
}

// ── Conversion goal checking ──────────────────────────────────────────────────
var _firedGoals={};
function _checkGoals(triggerType,el){
  if(!_goals||!_goals.length)return;
  _goals.forEach(function(g){
    if(_firedGoals[g.id])return; // fire each goal once per session
    var match=false;
    if(g.type==='click'&&triggerType==='click'&&g.sel){
      try{match=el.matches(g.sel);}catch(e){}
    }else if(g.type==='form_submit'&&triggerType==='form_submit'&&g.sel){
      try{match=el.matches(g.sel);}catch(e){}
    }else if(g.type==='page_load'&&g.url){
      match=_urlMatch(location.href,g.url,g.match);
    }
    if(match){
      _firedGoals[g.id]=true;
      _enq(Object.assign(_base('conversion'),{goal_id:g.id}));
    }
  });
}

function _urlMatch(url,pattern,matchType){
  try{
    var u=url.replace(/^https?:\/\/[^/]+/,''); // path only
    if(matchType==='exact')return u===pattern;
    if(matchType==='contains')return u.indexOf(pattern)>-1;
    if(matchType==='starts_with')return u.startsWith(pattern);
    if(matchType==='regex')return new RegExp(pattern).test(u);
  }catch(e){}
  return false;
}

// ── Element visibility (IntersectionObserver) ─────────────────────────────────
function _trackVisibility(){
  if(!_goals||!_goals.length)return;
  if(!window.IntersectionObserver)return;

  var visGoals=_goals.filter(function(g){return g.type==='element_visible'&&g.sel;});
  if(!visGoals.length)return;

  var observer=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(!entry.isIntersecting)return;
      var el=entry.target;
      visGoals.forEach(function(g){
        if(_firedGoals[g.id])return;
        try{if(el.matches(g.sel)){
          _firedGoals[g.id]=true;
          var r=el.getBoundingClientRect();
          _enq(Object.assign(_base('element_visible'),{
            xpath:_xp(el),
            el_id:el.id||null,
            el_classes:el.className&&typeof el.className==='string'
              ?el.className.trim().split(/\\s+/).filter(Boolean):[],
            el_rect:{top:Math.round(r.top),left:Math.round(r.left),
                     width:Math.round(r.width),height:Math.round(r.height)},
            goal_id:g.id,
          }));
          _enq(Object.assign(_base('conversion'),{goal_id:g.id}));
        }}catch(e){}
      });
    });
  },{threshold:0.5}); // element must be 50% visible

  // Observe all elements matching any visibility goal selector
  visGoals.forEach(function(g){
    try{
      document.querySelectorAll(g.sel).forEach(function(el){observer.observe(el);});
    }catch(e){}
  });
}

// Check page_load goals immediately
function _checkPageLoadGoals(){
  if(!_goals||!_goals.length)return;
  _goals.filter(function(g){return g.type==='page_load';}).forEach(function(g){
    if(_firedGoals[g.id])return;
    if(_urlMatch(location.href,g.url||'',g.match)){
      _firedGoals[g.id]=true;
      _enq(Object.assign(_base('conversion'),{goal_id:g.id}));
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',function(){
    _trackPV();_trackVisibility();_checkPageLoadGoals();
  });
}else{
  _trackPV();_trackVisibility();_checkPageLoadGoals();
}

document.addEventListener('click',_trackClick,{passive:true});
_trackScroll();
_trackForms();
setInterval(function(){_flush(false);},_FLUSH);
window.addEventListener('pagehide',function(){_flushTimeOnPage();_flush(true);},{passive:true});

}();`;
}
