import { supabase } from './supabase';

// ── Date helpers ──────────────────────────────────────────────────────────────

export function dateRange(days) {
  const now = new Date();
  const since = new Date(now - days * 86400000);
  return { since: since.toISOString(), until: now.toISOString() };
}

export function prevDateRange(days) {
  const now = new Date();
  const until = new Date(now - days * 86400000);
  const since = new Date(now - days * 2 * 86400000);
  return { since: since.toISOString(), until: until.toISOString() };
}

// ── Overview ──────────────────────────────────────────────────────────────────

export async function getOverview(clientId, days = 30) {
  const { since } = dateRange(days);
  const { since: prevSince, until: prevUntil } = prevDateRange(days);

  const [currSessions, prevSessions, currConv, prevConv, currEvents] = await Promise.all([
    supabase.from('sessions').select('session_id, converted, visitor_id').eq('client_id', clientId).gte('created_at', since),
    supabase.from('sessions').select('session_id, converted').eq('client_id', clientId).gte('created_at', prevSince).lt('created_at', prevUntil),
    supabase.from('conversion_events').select('id, goal_id').eq('client_id', clientId).gte('created_at', since),
    supabase.from('conversion_events').select('id').eq('client_id', clientId).gte('created_at', prevSince).lt('created_at', prevUntil),
    supabase.from('events').select('type, session_id').eq('client_id', clientId).in('type', ['pageview', 'click']).gte('created_at', since),
  ]);

  const sessions      = currSessions.data || [];
  const prevSess      = prevSessions.data || [];
  const conversions   = currConv.data     || [];
  const prevConvs     = prevConv.data     || [];
  const events        = currEvents.data   || [];

  const sessionCount    = sessions.length;
  const prevSessionCount= prevSess.length;
  const convCount       = conversions.length;
  const prevConvCount   = prevConvs.length;
  const pageviews       = events.filter(e => e.type === 'pageview').length;
  const clicks          = events.filter(e => e.type === 'click').length;
  const convRate        = sessionCount > 0 ? (convCount / sessionCount * 100) : 0;
  const prevConvRate    = prevSessionCount > 0 ? (prevConvCount / prevSessionCount * 100) : 0;
  const newVisitors     = sessions.filter(s => {
    // A visitor is "new" if this is their only session
    return sessions.filter(s2 => s2.visitor_id === s.visitor_id).length === 1;
  }).length;
  const returningVisitors = sessionCount - newVisitors;

  function delta(curr, prev) {
    if (!prev) return null;
    return ((curr - prev) / prev * 100).toFixed(1);
  }

  return {
    sessions:         sessionCount,
    sessionsDelta:    delta(sessionCount, prevSessionCount),
    conversions:      convCount,
    conversionsDelta: delta(convCount, prevConvCount),
    convRate:         convRate.toFixed(2),
    convRateDelta:    delta(convRate, prevConvRate),
    pageviews,
    clicks,
    newVisitors,
    returningVisitors,
    conversionsByGoal: conversions.reduce((acc, c) => {
      const key = c.goal_id || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };
}

// ── Daily series (for sparkline/chart) ────────────────────────────────────────

export async function getDailySeries(clientId, days = 30) {
  const { since } = dateRange(days);

  const [sessRes, convRes] = await Promise.all([
    supabase.from('sessions').select('created_at').eq('client_id', clientId).gte('created_at', since),
    supabase.from('conversion_events').select('created_at').eq('client_id', clientId).gte('created_at', since),
  ]);

  const sessions    = sessRes.data    || [];
  const conversions = convRes.data    || [];

  // Build a map of day → counts
  const map = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    map[key] = { date: key, sessions: 0, conversions: 0 };
  }

  sessions.forEach(s => {
    const key = s.created_at.slice(0, 10);
    if (map[key]) map[key].sessions++;
  });

  conversions.forEach(c => {
    const key = c.created_at.slice(0, 10);
    if (map[key]) map[key].conversions++;
  });

  return Object.values(map);
}

// ── Top pages ─────────────────────────────────────────────────────────────────

export async function getTopPages(clientId, days = 30, device = null) {
  const { since } = dateRange(days);

  let query = supabase
    .from('events')
    .select('url, type, session_id, time_on_page_ms')
    .eq('client_id', clientId)
    .in('type', ['pageview', 'time_on_page'])
    .gte('created_at', since);

  if (device) query = query.eq('device_type', device);

  const { data: events } = await query;
  const { data: convEvents } = await supabase
    .from('conversion_events')
    .select('url')
    .eq('client_id', clientId)
    .gte('created_at', since);

  if (!events) return [];

  // Group by URL
  const pages = {};
  events.forEach(ev => {
    const url = ev.url.replace(/\?.*/, ''); // strip query string
    if (!pages[url]) pages[url] = { url, pageviews: 0, sessions: new Set(), totalTime: 0, timeCount: 0, conversions: 0 };
    if (ev.type === 'pageview') {
      pages[url].pageviews++;
      pages[url].sessions.add(ev.session_id);
    }
    if (ev.type === 'time_on_page' && ev.time_on_page_ms) {
      pages[url].totalTime += ev.time_on_page_ms;
      pages[url].timeCount++;
    }
  });

  (convEvents || []).forEach(ce => {
    const url = ce.url.replace(/\?.*/, '');
    if (pages[url]) pages[url].conversions++;
  });

  return Object.values(pages)
    .map(p => ({
      url:      p.url,
      pageviews: p.pageviews,
      sessions: p.sessions.size,
      avgTime:  p.timeCount > 0 ? Math.round(p.totalTime / p.timeCount / 1000) : null,
      conversions: p.conversions,
      convRate: p.sessions.size > 0 ? (p.conversions / p.sessions.size * 100).toFixed(1) : '0.0',
    }))
    .sort((a, b) => b.pageviews - a.pageviews)
    .slice(0, 20);
}

// ── Sources ───────────────────────────────────────────────────────────────────

export async function getSources(clientId, days = 30) {
  const { since } = dateRange(days);

  const { data: sessions } = await supabase
    .from('sessions')
    .select('session_id, utm_source, utm_medium, referrer_url, converted')
    .eq('client_id', clientId)
    .gte('created_at', since);

  if (!sessions) return [];

  const sourceMap = {};

  sessions.forEach(s => {
    let source = 'Direct';
    let medium = 'none';

    if (s.utm_source) {
      source = s.utm_source;
      medium = s.utm_medium || 'none';
    } else if (s.referrer_url) {
      try {
        const host = new URL(s.referrer_url).hostname.replace('www.', '');
        if (/google|bing|yahoo|duckduckgo/.test(host)) { source = 'Organic Search'; medium = 'organic'; }
        else if (/facebook|instagram|twitter|linkedin|tiktok|pinterest/.test(host)) { source = 'Organic Social'; medium = 'social'; }
        else { source = host; medium = 'referral'; }
      } catch { source = 'Referral'; medium = 'referral'; }
    }

    const key = `${source}|${medium}`;
    if (!sourceMap[key]) sourceMap[key] = { source, medium, sessions: 0, conversions: 0 };
    sourceMap[key].sessions++;
    if (s.converted) sourceMap[key].conversions++;
  });

  return Object.values(sourceMap)
    .map(s => ({
      ...s,
      convRate: s.sessions > 0 ? (s.conversions / s.sessions * 100).toFixed(1) : '0.0',
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

// ── Conversion paths ──────────────────────────────────────────────────────────

export async function getConversionPaths(clientId, days = 30) {
  const { since } = dateRange(days);

  // Get converting sessions
  const { data: convSessions } = await supabase
    .from('conversion_events')
    .select('session_id')
    .eq('client_id', clientId)
    .gte('created_at', since);

  if (!convSessions || convSessions.length === 0) return [];

  const sessionIds = [...new Set(convSessions.map(c => c.session_id))].slice(0, 200);

  // Get pageviews for those sessions
  const { data: pageviews } = await supabase
    .from('events')
    .select('session_id, url, ts')
    .eq('client_id', clientId)
    .eq('type', 'pageview')
    .in('session_id', sessionIds)
    .order('ts', { ascending: true });

  if (!pageviews) return [];

  // Group by session and build paths
  const sessionPaths = {};
  pageviews.forEach(pv => {
    const path = pv.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*/, '') || '/';
    if (!sessionPaths[pv.session_id]) sessionPaths[pv.session_id] = [];
    sessionPaths[pv.session_id].push(path);
  });

  // Count path occurrences (limit to first 4 pages)
  const pathCounts = {};
  Object.values(sessionPaths).forEach(pages => {
    const key = pages.slice(0, 4).join(' → ');
    pathCounts[key] = (pathCounts[key] || 0) + 1;
  });

  return Object.entries(pathCounts)
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

// ── Form analytics ────────────────────────────────────────────────────────────

export async function getFormAnalytics(clientId, days = 30) {
  const { since } = dateRange(days);

  const { data: events } = await supabase
    .from('events')
    .select('type, form_id, field_name, field_type, field_index, time_to_fill_ms, url, session_id')
    .eq('client_id', clientId)
    .in('type', ['form_field', 'form_submit'])
    .gte('created_at', since);

  if (!events || events.length === 0) return [];

  // Group by form_id + url
  const forms = {};
  events.forEach(ev => {
    const formKey = `${ev.url.replace(/\?.*/, '')}|${ev.form_id || 'unknown'}`;
    if (!forms[formKey]) {
      forms[formKey] = {
        url:     ev.url.replace(/\?.*/, ''),
        formId:  ev.form_id || 'unknown',
        fields:  {},
        submits: new Set(),
        starts:  new Set(),
      };
    }
    const form = forms[formKey];
    if (ev.type === 'form_submit') {
      form.submits.add(ev.session_id);
    }
    if (ev.type === 'form_field' && ev.field_name) {
      form.starts.add(ev.session_id);
      const fk = ev.field_name;
      if (!form.fields[fk]) form.fields[fk] = { name: fk, type: ev.field_type, index: ev.field_index, times: [], interactions: 0 };
      form.fields[fk].interactions++;
      if (ev.time_to_fill_ms) form.fields[fk].times.push(ev.time_to_fill_ms);
    }
  });

  return Object.values(forms).map(form => ({
    url:          form.url,
    formId:       form.formId,
    starts:       form.starts.size,
    submits:      form.submits.size,
    completionRate: form.starts.size > 0 ? (form.submits.size / form.starts.size * 100).toFixed(1) : '0.0',
    fields: Object.values(form.fields)
      .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
      .map(f => ({
        name:        f.name,
        type:        f.type,
        interactions: f.interactions,
        avgTime:     f.times.length > 0 ? Math.round(f.times.reduce((a, b) => a + b, 0) / f.times.length / 1000) : null,
      })),
  }));
}

// ── Returning visitor latency ─────────────────────────────────────────────────

export async function getVisitorLatency(clientId, days = 90) {
  const { since } = dateRange(days);

  const { data } = await supabase
    .from('visitor_conversion_latency')
    .select('*')
    .eq('client_id', clientId);

  if (!data || data.length === 0) return { avgSessions: 0, avgHours: 0, distribution: [] };

  const avgSessions = (data.reduce((a, b) => a + Number(b.total_sessions), 0) / data.length).toFixed(1);
  const avgHours    = (data.reduce((a, b) => a + Number(b.hours_to_conversion), 0) / data.length).toFixed(1);

  // Distribution: bucket by session count
  const dist = { '1': 0, '2': 0, '3-5': 0, '6+': 0 };
  data.forEach(v => {
    const n = Number(v.total_sessions);
    if (n === 1) dist['1']++;
    else if (n === 2) dist['2']++;
    else if (n <= 5) dist['3-5']++;
    else dist['6+']++;
  });

  return {
    avgSessions,
    avgHours,
    totalConverters: data.length,
    distribution: Object.entries(dist).map(([label, count]) => ({ label, count })),
  };
}
