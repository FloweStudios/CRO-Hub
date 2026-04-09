// api/track/[token].js
// Serves a minified, obfuscated tracker script per partner.
// The [token] is the partner's client_id — not the secret key.
// The secret key is embedded inside the served JS, never in the URL.
//
// Usage:  <script src="https://your-project.vercel.app/track/PARTNER-ID.js" defer></script>

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// How long browsers + CDN edges cache the script (1 hour)
// The script is partner-specific but rarely changes, so caching is safe.
const CACHE_SECONDS = 3600;

export default async function handler(req, res) {
  // Strip .js extension if present — /track/acme-corp-1abc.js → acme-corp-1abc
  const token = (req.query.token || '').replace(/\.js$/, '');

  if (!token) {
    return res.status(400).send('// missing token');
  }

  // Look up partner by client_id
  const { data: client, error } = await supabase
    .from('clients')
    .select('id, domain, secret_key')
    .eq('id', token)
    .single();

  if (error || !client) {
    // Return a silent no-op rather than a 404 — avoids console errors on client sites
    res.setHeader('Content-Type', 'application/javascript');
    return res.status(200).send('/* crohub: unknown client */');
  }

  const script = buildScript({
    clientId:  client.id,
    domain:    client.domain,
    secretKey: client.secret_key,
    ingestUrl: `https://${req.headers.host}/api/ingest`,
  });

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`);
  // Allow any domain to load this script
  res.setHeader('Access-Control-Allow-Origin', '*');

  return res.status(200).send(script);
}

// ─── Script builder ───────────────────────────────────────────────────────────
// Produces a single minified IIFE with all config values inlined.
// Variable names are shortened to make casual inspection harder.
// This is light obfuscation — determined reverse-engineers can still read it,
// but the secret key is write-only (can only POST events, never read data),
// so exposure is low risk by design.

function buildScript({ clientId, domain, secretKey, ingestUrl }) {
  // Escape values for safe embedding inside a JS string
  const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const cleanDomain = domain
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .toLowerCase();

  // Shortened variable names for obfuscation
  return `!function(){'use strict';
var _a='${esc(cleanDomain)}',_b=location.hostname.toLowerCase().replace(/^www\./,'');
if(_b!==_a&&!_b.endsWith('.'+_a))return;
var _c='${esc(clientId)}',_d='${esc(secretKey)}',_e='${esc(ingestUrl)}';
var _f=10000,_g='__crq_${clientId.replace(/[^a-z0-9]/g,'_')}__',_h=100;
function _i(){if(crypto.randomUUID)return crypto.randomUUID();
return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=(Math.random()*16)|0;return(c==='x'?r:(r&0x3)|0x8).toString(16);});}
var _j=(function(){try{var k='__crs__',s=sessionStorage.getItem(k);if(!s){s=_i();sessionStorage.setItem(k,s);}return s;}catch(e){return _i();}})();
var _k=(function(){var w=window.innerWidth;return w<768?'mobile':w<1024?'tablet':'desktop';})();
function _l(el){if(!el||el.nodeType!==1)return'';if(el===document.body)return'/body';
if(el.id&&document.querySelectorAll('#'+CSS.escape(el.id)).length===1)return'//*[@id="'+el.id+'"]';
var p=[],n=el;
while(n&&n.nodeType===1&&n!==document.body){var t=n.tagName.toLowerCase();
var s=n.parentNode?Array.prototype.filter.call(n.parentNode.childNodes,function(x){return x.nodeType===1&&x.tagName===n.tagName;
}):[];p.unshift(s.length>1?t+'['+(s.indexOf(n)+1)+']':t);
if(n.parentNode&&n.parentNode.id&&document.querySelectorAll('#'+CSS.escape(n.parentNode.id)).length===1){p.unshift('//*[@id="'+n.parentNode.id+'"]');return p.join('/');}
n=n.parentNode;}return'/body/'+p.join('/');}
function _m(){try{return JSON.parse(localStorage.getItem(_g)||'[]');}catch(e){return[];}}
function _n(q){try{localStorage.setItem(_g,JSON.stringify(q));}catch(e){}}
function _o(ev){var q=_m();q.push(ev);if(q.length>_h)q=q.slice(-_h);_n(q);}
function _p(bc){var q=_m();if(!q.length)return;
var b=JSON.stringify({client_id:_c,events:q});
var h={'Content-Type':'application/json','X-CRO-Secret':_d};
if(bc&&navigator.sendBeacon){if(navigator.sendBeacon(_e,new Blob([b],{type:'application/json'})))_n([]);}
else{fetch(_e,{method:'POST',headers:h,body:b,keepalive:true}).then(function(r){if(r.ok)_n([]);}).catch(function(){});}}
function _q(t){return{event_id:_i(),type:t,client_id:_c,session_id:_j,url:location.href,referrer:document.referrer||null,device_type:_k,screen_width:window.innerWidth,screen_height:window.innerHeight,ts:new Date().toISOString()};}
function _r(){_o(Object.assign(_q('pageview'),{title:document.title}));}
function _s(e){var m=e.target;
for(var i=0;i<5;i++){if(!m||m===document.body)break;var tg=m.tagName&&m.tagName.toLowerCase();
if(tg==='a'||tg==='button'||m.getAttribute('role')==='button'||m.hasAttribute('onclick'))break;m=m.parentElement;}
var r=m.getBoundingClientRect();
_o(Object.assign(_q('click'),{xpath:_l(m),tag:m.tagName?m.tagName.toLowerCase():null,el_id:m.id||null,
el_classes:m.className&&typeof m.className==='string'?m.className.trim().split(/\\s+/).filter(Boolean):[],
text_content:(m.textContent||'').trim().slice(0,100)||null,href:m.href||null,
scroll_y:Math.round(window.scrollY),viewport_x:Math.round(e.clientX),viewport_y:Math.round(e.clientY),
el_rect:{top:Math.round(r.top),left:Math.round(r.left),width:Math.round(r.width),height:Math.round(r.height)}}));}
function _t(){var f={},tk=false;
window.addEventListener('scroll',function(){if(!tk){requestAnimationFrame(function(){
var p=Math.round(((window.scrollY+window.innerHeight)/document.documentElement.scrollHeight)*100);
[25,50,75,100].forEach(function(v){if(!f[v]&&p>=v){f[v]=true;_o(Object.assign(_q('scroll_depth'),{depth_pct:v}));}});
tk=false;});tk=true;}},{passive:true});}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',_r);}else{_r();}
document.addEventListener('click',_s,{passive:true});
_t();
setInterval(function(){_p(false);},_f);
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')_p(true);});
window.addEventListener('pagehide',function(){_p(true);},{passive:true});
}();`;
}
