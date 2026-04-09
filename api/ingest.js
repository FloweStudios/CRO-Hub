// api/ingest.js
// v2 — handles sessions, geolocation, new event types, conversion firing

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_TYPES = new Set([
  'pageview',
  'click',
  'scroll_depth',
  'time_on_page',
  'form_field',
  'form_submit',
  'element_visible',
  'conversion',
]);

const VALID_DEVICES = new Set(['mobile', 'tablet', 'desktop']);
const MAX_BATCH = 100;

const origin = req.headers.origin || '*';

const CORS = {
  'Access-Control-Allow-Origin':      origin,
  'Access-Control-Allow-Methods':     'POST, OPTIONS',
  'Access-Control-Allow-Headers':     'Content-Type, X-CRO-Secret',
  'Access-Control-Allow-Credentials': 'true',
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

  // ── Validate client + secret ───────────────────────────────────────────────
  const secret = req.headers['x-cro-secret'];

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('id, secret_key, timezone')
    .eq('id', client_id)
    .single();

  if (clientErr || !client || client.secret_key !== secret)
    return res.status(202).send('accepted');

  // ── Geo lookup (once per batch, on first pageview) ─────────────────────────
  let geoData = null;
  const hasPageview = events.some(e => e.type === 'pageview');

  if (hasPageview) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || req.socket?.remoteAddress;

    if (ip && ip !== '127.0.0.1' && ip !== '::1') {
      try {
        const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,status`, {
          signal: AbortSignal.timeout(2000), // never block ingestion for more than 2s
        });
        const geo = await geoRes.json();
        if (geo.status === 'success') {
          geoData = { country: geo.country, city: geo.city };
        }
      } catch {
        // geo is best-effort — never fail ingestion because of it
      }
    }
  }

  // ── Sanitise and categorise events ────────────────────────────────────────
  const validEvents   = [];
  const pageviews     = [];
  const conversions   = [];

  for (const e of events) {
    if (!e.event_id || !e.type || !VALID_TYPES.has(e.type)) continue;
    if (!e.session_id || !e.url || !e.ts) continue;
    if (e.device_type && !VALID_DEVICES.has(e.device_type)) continue;

    const base = {
      event_id:       String(e.event_id).slice(0, 36),
      client_id,
      session_id:     String(e.session_id).slice(0, 36),
      type:           e.type,
      ts:             e.ts,
      url:            String(e.url || '').slice(0, 2048),
      referrer:       e.referrer     ? String(e.referrer).slice(0, 2048) : null,
      title:          e.title        ? String(e.title).slice(0, 512)     : null,
      device_type:    e.device_type  || null,
      screen_width:   intOrNull(e.screen_width),
      screen_height:  intOrNull(e.screen_height),
      visitor_id:     e.visitor_id   ? String(e.visitor_id).slice(0, 64) : null,
      utm_source:     e.utm_source   ? String(e.utm_source).slice(0, 128)  : null,
      utm_medium:     e.utm_medium   ? String(e.utm_medium).slice(0, 128)  : null,
      utm_campaign:   e.utm_campaign ? String(e.utm_campaign).slice(0, 128): null,
      utm_term:       e.utm_term     ? String(e.utm_term).slice(0, 128)    : null,
      utm_content:    e.utm_content  ? String(e.utm_content).slice(0, 128) : null,
      country:        geoData?.country || null,
      city:           geoData?.city    || null,
      timezone:       e.timezone     ? String(e.timezone).slice(0, 64)    : null,
    };

    // Type-specific fields
    if (e.type === 'click' || e.type === 'element_visible') {
      Object.assign(base, {
        xpath:          e.xpath         ? String(e.xpath).slice(0, 1024)       : null,
        tag:            e.tag           ? String(e.tag).slice(0, 32)           : null,
        el_id:          e.el_id         ? String(e.el_id).slice(0, 256)        : null,
        el_classes:     Array.isArray(e.el_classes) ? e.el_classes.slice(0, 20).map(String) : null,
        text_content:   e.text_content  ? String(e.text_content).slice(0, 100) : null,
        href:           e.href          ? String(e.href).slice(0, 2048)        : null,
        scroll_y:       intOrNull(e.scroll_y),
        viewport_x:     intOrNull(e.viewport_x),
        viewport_y:     intOrNull(e.viewport_y),
        el_rect_top:    e.el_rect ? intOrNull(e.el_rect.top)    : null,
        el_rect_left:   e.el_rect ? intOrNull(e.el_rect.left)   : null,
        el_rect_width:  e.el_rect ? intOrNull(e.el_rect.width)  : null,
        el_rect_height: e.el_rect ? intOrNull(e.el_rect.height) : null,
      });
    }

    if (e.type === 'scroll_depth') {
      const depth = intOrNull(e.depth_pct);
      if (depth === null || depth < 0 || depth > 100 || depth % 5 !== 0) continue;
      base.depth_pct = depth;
    }

    if (e.type === 'time_on_page') {
      base.time_on_page_ms = intOrNull(e.time_on_page_ms);
    }

    if (e.type === 'form_field' || e.type === 'form_submit') {
      Object.assign(base, {
        form_id:         e.form_id     ? String(e.form_id).slice(0, 256)     : null,
        field_name:      e.field_name  ? String(e.field_name).slice(0, 256)  : null,
        field_type:      e.field_type  ? String(e.field_type).slice(0, 64)   : null,
        time_to_fill_ms: intOrNull(e.time_to_fill_ms),
        field_index:     intOrNull(e.field_index),
        xpath:           e.xpath       ? String(e.xpath).slice(0, 1024)      : null,
      });
    }

    if (e.type === 'conversion') {
      conversions.push({
        client_id,
        goal_id:     e.goal_id || null,
        session_id:  String(e.session_id).slice(0, 36),
        visitor_id:  e.visitor_id ? String(e.visitor_id).slice(0, 64) : null,
        url:         String(e.url || '').slice(0, 2048),
        ts:          e.ts,
        device_type: e.device_type || null,
        utm_source:  e.utm_source  || null,
        utm_medium:  e.utm_medium  || null,
        utm_campaign:e.utm_campaign|| null,
      });
      // Don't add conversion to events table — it has its own table
      continue;
    }

    validEvents.push(base);

    if (e.type === 'pageview') {
      pageviews.push(e);
    }
  }

  // ── Write events ───────────────────────────────────────────────────────────
  const writes = [];

  if (validEvents.length > 0) {
    writes.push(
      supabase.from('events').insert(validEvents).then(({ error }) => {
        if (error) console.error('[ingest] events error:', error.message);
      })
    );
  }

  // ── Upsert sessions ────────────────────────────────────────────────────────
  // One upsert per unique session_id in this batch
  const sessionMap = new Map();

  for (const e of [...pageviews, ...events.filter(e => e.type !== 'pageview' && e.session_id)]) {
    if (!sessionMap.has(e.session_id)) {
      sessionMap.set(e.session_id, {
        session_id:   String(e.session_id).slice(0, 36),
        client_id,
        visitor_id:   e.visitor_id   ? String(e.visitor_id).slice(0, 64) : null,
        landing_url:  e.type === 'pageview' ? String(e.url || '').slice(0, 2048) : null,
        referrer_url: e.referrer     ? String(e.referrer).slice(0, 2048) : null,
        utm_source:   e.utm_source   || null,
        utm_medium:   e.utm_medium   || null,
        utm_campaign: e.utm_campaign || null,
        utm_term:     e.utm_term     || null,
        utm_content:  e.utm_content  || null,
        device_type:  e.device_type  || null,
        screen_width: intOrNull(e.screen_width),
        screen_height:intOrNull(e.screen_height),
        country:      geoData?.country || null,
        city:         geoData?.city    || null,
        timezone:     e.timezone     || null,
        last_seen:    e.ts           || new Date().toISOString(),
      });
    }
  }

  if (sessionMap.size > 0) {
    const sessionRows = Array.from(sessionMap.values());
    writes.push(
      supabase.from('sessions').upsert(sessionRows, {
        onConflict: 'session_id',
        ignoreDuplicates: false,
      }).then(({ error }) => {
        if (error) console.error('[ingest] sessions error:', error.message);
      })
    );
  }

  // ── Write conversion events ────────────────────────────────────────────────
  if (conversions.length > 0) {
    writes.push(
      supabase.from('conversion_events').insert(conversions).then(({ error }) => {
        if (error) console.error('[ingest] conversions error:', error.message);
      })
    );

    // Mark sessions as converted
    const convertedSessionIds = [...new Set(conversions.map(c => c.session_id))];
    writes.push(
      supabase.from('sessions')
        .update({ converted: true })
        .in('session_id', convertedSessionIds)
        .then(({ error }) => {
          if (error) console.error('[ingest] session converted update error:', error.message);
        })
    );
  }

  // Fire all writes in parallel — client already has 202
  await Promise.all(writes);

  return res.status(202).send('accepted');
}

function intOrNull(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
