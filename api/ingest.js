import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_TYPES   = new Set(['pageview', 'click', 'scroll_depth']);
const VALID_DEVICES = new Set(['mobile', 'tablet', 'desktop']);
const VALID_DEPTHS  = new Set([25, 50, 75, 100]);
const MAX_BATCH     = 100;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-CRO-Secret',
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).send('Method not allowed');

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).send('Invalid JSON'); }
  }

  const { client_id, events } = body || {};

  if (!client_id || !Array.isArray(events) || events.length === 0)
    return res.status(400).send('Missing client_id or events');

  if (events.length > MAX_BATCH)
    return res.status(400).send('Batch too large');

  const secret = req.headers['x-cro-secret'];

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('id, secret_key')
    .eq('id', client_id)
    .single();

  if (clientErr || !client || client.secret_key !== secret)
    return res.status(202).send('accepted');

  const valid = [];

  for (const e of events) {
    if (!e.event_id || !e.type || !VALID_TYPES.has(e.type)) continue;
    if (!e.session_id || !e.url || !e.ts) continue;
    if (e.device_type && !VALID_DEVICES.has(e.device_type)) continue;
    if (e.type === 'scroll_depth' && !VALID_DEPTHS.has(e.depth_pct)) continue;

    valid.push({
      event_id:      String(e.event_id).slice(0, 36),
      client_id,
      session_id:    String(e.session_id).slice(0, 36),
      type:          e.type,
      ts:            e.ts,
      url:           String(e.url || '').slice(0, 2048),
      referrer:      e.referrer      ? String(e.referrer).slice(0, 2048)  : null,
      title:         e.title         ? String(e.title).slice(0, 512)      : null,
      device_type:   e.device_type   || null,
      screen_width:  intOrNull(e.screen_width),
      screen_height: intOrNull(e.screen_height),
      xpath:         e.xpath         ? String(e.xpath).slice(0, 1024)     : null,
      tag:           e.tag           ? String(e.tag).slice(0, 32)         : null,
      el_id:         e.el_id         ? String(e.el_id).slice(0, 256)      : null,
      el_classes:    Array.isArray(e.el_classes) ? e.el_classes.slice(0, 20).map(String) : null,
      text_content:  e.text_content  ? String(e.text_content).slice(0, 100) : null,
      href:          e.href          ? String(e.href).slice(0, 2048)      : null,
      scroll_y:      intOrNull(e.scroll_y),
      viewport_x:    intOrNull(e.viewport_x),
      viewport_y:    intOrNull(e.viewport_y),
      el_rect_top:    e.el_rect ? intOrNull(e.el_rect.top)    : null,
      el_rect_left:   e.el_rect ? intOrNull(e.el_rect.left)   : null,
      el_rect_width:  e.el_rect ? intOrNull(e.el_rect.width)  : null,
      el_rect_height: e.el_rect ? intOrNull(e.el_rect.height) : null,
      depth_pct:     intOrNull(e.depth_pct),
    });
  }

  if (valid.length > 0) {
    const { error } = await supabase.from('events').insert(valid);
    if (error) console.error('[ingest] error:', error.message);
  }

  return res.status(202).send('accepted');
}

function intOrNull(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
