import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_TYPES = new Set([
  'pageview', 'click', 'scroll_depth', 'time_on_page',
  'form_field', 'form_submit', 'element_visible', 'conversion',
]);
const VALID_DEVICES = new Set(['mobile', 'tablet', 'desktop']);
const MAX_BATCH = 100;

export default async function handler(req, res) {
  // ── CORS ────────────────────────────────────────────────────────────────────
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CRO-Secret');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).send('Invalid JSON'); }
  }

  const client_id = body?.client_id;
  const events    = body?.events;

  if (!client_id || !Array.isArray(events) || events.length === 0)
    return res.status(400).send('Missing client_id or events');

  if (events.length > MAX_BATCH)
    return res.status(400).send('Batch too large');

  // ── Auth ────────────────────────────────────────────────────────────────────
  const incomingSecret = req.headers['x-cro-secret'] || '';

  const { data: clientRow, error: clientErr } = await supabase
    .from('clients')
    .select('id, secret_key')
    .eq('id', client_id)
    .single();

  if (clientErr || !clientRow || clientRow.secret_key !== incomingSecret) {
    return res.status(202).send('accepted');
  }

  // ── Geo lookup ──────────────────────────────────────────────────────────────
  let geo = null;
  const hasPageview = events.some(ev => ev.type === 'pageview');

  if (hasPageview) {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.headers['x-real-ip']
      || '';

    if (ip && ip !== '127.0.0.1' && ip !== '::1') {
      try {
        const geoRes = await fetch(
          `http://ip-api.com/json/${ip}?fields=country,city,status`,
          { signal: AbortSignal.timeout(2000) }
        );
        const geoJson = await geoRes.json();
        if (geoJson.status === 'success') {
          geo = { country: geoJson.country, city: geoJson.city };
        }
      } catch {
        // geo is best-effort, never block ingestion
      }
    }
  }

  // ── Categorise events ───────────────────────────────────────────────────────
  const validEvents  = [];
  const sessionsSeen = new Map(); // session_id → session object
  const conversions  = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];

    if (!ev.event_id || !ev.type || !VALID_TYPES.has(ev.type)) continue;
    if (!ev.session_id || !ev.url || !ev.ts) continue;
    if (ev.device_type && !VALID_DEVICES.has(ev.device_type)) continue;

    // ── Build session row (upserted once per session_id) ──────────────────
    if (!sessionsSeen.has(ev.session_id)) {
      sessionsSeen.set(ev.session_id, {
        session_id:    String(ev.session_id).slice(0, 36),
        client_id,
        visitor_id:    ev.visitor_id   ? String(ev.visitor_id).slice(0, 64)   : null,
        landing_url:   ev.type === 'pageview' ? String(ev.url).slice(0, 2048) : null,
        referrer_url:  ev.referrer     ? String(ev.referrer).slice(0, 2048)   : null,
        utm_source:    ev.utm_source   ? String(ev.utm_source).slice(0, 128)  : null,
        utm_medium:    ev.utm_medium   ? String(ev.utm_medium).slice(0, 128)  : null,
        utm_campaign:  ev.utm_campaign ? String(ev.utm_campaign).slice(0, 128): null,
        utm_term:      ev.utm_term     ? String(ev.utm_term).slice(0, 128)    : null,
        utm_content:   ev.utm_content  ? String(ev.utm_content).slice(0, 128) : null,
        device_type:   ev.device_type  || null,
        screen_width:  intOrNull(ev.screen_width),
        screen_height: intOrNull(ev.screen_height),
        country:       geo?.country    || null,
        city:          geo?.city       || null,
        timezone:      ev.timezone     ? String(ev.timezone).slice(0, 64)    : null,
        last_seen:     ev.ts,
      });
    }

    // ── Conversion events go to their own table ───────────────────────────
    if (ev.type === 'conversion') {
      conversions.push({
        client_id,
        goal_id:      ev.goal_id    || null,
        session_id:   String(ev.session_id).slice(0, 36),
        visitor_id:   ev.visitor_id ? String(ev.visitor_id).slice(0, 64) : null,
        url:          String(ev.url).slice(0, 2048),
        ts:           ev.ts,
        device_type:  ev.device_type  || null,
        utm_source:   ev.utm_source   || null,
        utm_medium:   ev.utm_medium   || null,
        utm_campaign: ev.utm_campaign || null,
      });
      continue; // don't add to events table
    }

    // ── Build event row ───────────────────────────────────────────────────
    const row = {
      event_id:      String(ev.event_id).slice(0, 36),
      client_id,
      session_id:    String(ev.session_id).slice(0, 36),
      type:          ev.type,
      ts:            ev.ts,
      url:           String(ev.url).slice(0, 2048),
      referrer:      ev.referrer     ? String(ev.referrer).slice(0, 2048)   : null,
      title:         ev.title        ? String(ev.title).slice(0, 512)       : null,
      device_type:   ev.device_type  || null,
      screen_width:  intOrNull(ev.screen_width),
      screen_height: intOrNull(ev.screen_height),
      visitor_id:    ev.visitor_id   ? String(ev.visitor_id).slice(0, 64)   : null,
      utm_source:    ev.utm_source   ? String(ev.utm_source).slice(0, 128)  : null,
      utm_medium:    ev.utm_medium   ? String(ev.utm_medium).slice(0, 128)  : null,
      utm_campaign:  ev.utm_campaign ? String(ev.utm_campaign).slice(0, 128): null,
      utm_term:      ev.utm_term     ? String(ev.utm_term).slice(0, 128)    : null,
      utm_content:   ev.utm_content  ? String(ev.utm_content).slice(0, 128) : null,
      country:       geo?.country    || null,
      city:          geo?.city       || null,
      timezone:      ev.timezone     ? String(ev.timezone).slice(0, 64)    : null,
    };

    if (ev.type === 'click' || ev.type === 'element_visible') {
      row.xpath          = ev.xpath        ? String(ev.xpath).slice(0, 1024)       : null;
      row.tag            = ev.tag          ? String(ev.tag).slice(0, 32)           : null;
      row.el_id          = ev.el_id        ? String(ev.el_id).slice(0, 256)        : null;
      row.el_classes     = Array.isArray(ev.el_classes) ? ev.el_classes.slice(0, 20).map(String) : null;
      row.text_content   = ev.text_content ? String(ev.text_content).slice(0, 100) : null;
      row.href           = ev.href         ? String(ev.href).slice(0, 2048)        : null;
      row.scroll_y       = intOrNull(ev.scroll_y);
      row.viewport_x     = intOrNull(ev.viewport_x);
      row.viewport_y     = intOrNull(ev.viewport_y);
      row.el_rect_top    = ev.el_rect ? intOrNull(ev.el_rect.top)    : null;
      row.el_rect_left   = ev.el_rect ? intOrNull(ev.el_rect.left)   : null;
      row.el_rect_width  = ev.el_rect ? intOrNull(ev.el_rect.width)  : null;
      row.el_rect_height = ev.el_rect ? intOrNull(ev.el_rect.height) : null;
    }

    if (ev.type === 'scroll_depth') {
      const depth = intOrNull(ev.depth_pct);
      if (depth === null || depth < 0 || depth > 100 || depth % 5 !== 0) continue;
      row.depth_pct = depth;
    }

    if (ev.type === 'time_on_page') {
      row.time_on_page_ms = intOrNull(ev.time_on_page_ms);
    }

    if (ev.type === 'form_field' || ev.type === 'form_submit') {
      row.form_id         = ev.form_id    ? String(ev.form_id).slice(0, 256)    : null;
      row.field_name      = ev.field_name ? String(ev.field_name).slice(0, 256) : null;
      row.field_type      = ev.field_type ? String(ev.field_type).slice(0, 64)  : null;
      row.time_to_fill_ms = intOrNull(ev.time_to_fill_ms);
      row.field_index     = intOrNull(ev.field_index);
      row.xpath           = ev.xpath      ? String(ev.xpath).slice(0, 1024)     : null;
    }

    validEvents.push(row);
  }

  // ── Write everything in parallel ────────────────────────────────────────────
  const writes = [];

  if (validEvents.length > 0) {
    writes.push(
      supabase.from('events')
        .insert(validEvents)
        .then(({ error }) => {
          if (error) console.error('[ingest] events error:', error.message);
        })
    );
  }

  if (sessionsSeen.size > 0) {
    writes.push(
      supabase.from('sessions')
        .upsert(Array.from(sessionsSeen.values()), {
          onConflict: 'session_id',
          ignoreDuplicates: false,
        })
        .then(({ error }) => {
          if (error) console.error('[ingest] sessions error:', error.message);
        })
    );
  }

  if (conversions.length > 0) {
    writes.push(
      supabase.from('conversion_events')
        .insert(conversions)
        .then(({ error }) => {
          if (error) console.error('[ingest] conversions error:', error.message);
        })
    );

    const convertedIds = [...new Set(conversions.map(c => c.session_id))];
    writes.push(
      supabase.from('sessions')
        .update({ converted: true })
        .in('session_id', convertedIds)
        .then(({ error }) => {
          if (error) console.error('[ingest] session convert error:', error.message);
        })
    );
  }

  await Promise.all(writes);

  return res.status(202).send('accepted');
}

function intOrNull(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
