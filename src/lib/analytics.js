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

export function resolveRange(filter = {}) {
  const since  = filter.dateFrom ? new Date(filter.dateFrom).toISOString() : dateRange(30).since;
  const until  = filter.dateTo   ? new Date(filter.dateTo + 'T23:59:59').toISOString() : new Date().toISOString();
  const prevSince = filter.compFrom ? new Date(filter.compFrom).toISOString() : null;
  const prevUntil = filter.compTo   ? new Date(filter.compTo + 'T23:59:59').toISOString() : null;
  return { since, until, prevSince, prevUntil };
}

// ── Core session resolver ─────────────────────────────────────────────────────
// Single source of truth for filtered sessions. All other functions scope their
// events/conversion queries to the session IDs returned here so source/medium
// filters apply consistently across every tab.

async function resolveSessionIds(clientId, since, until, sources, mediums) {
  const { data } = await supabase
    .from('sessions')
    .select('session_id, utm_source, utm_medium, referrer_url, converted, visitor_id, device_type, country, created_at')
    .eq('client_id', clientId)
    .gte('created_at', since)
    .lte('created_at', until);

  const all = data || [];
  const filtered = (sources?.length || mediums?.length)
    ? all.filter(s => {
        const srcOk = !sources?.length || sources.includes(s.utm_source || 'direct');
        const medOk = !mediums?.length || mediums.includes(s.utm_medium || 'none');
        return srcOk && medOk;
      })
    : all;

  return {
    sessions: filtered,
    sessionIds: new Set(filtered.map(s => s.session_id)),
    allSessions: all,
  };
}

// ── Overview ──────────────────────────────────────────────────────────────────

export async function getOverview(clientId, filter = {}) {
  const { since, until, prevSince, prevUntil } = resolveRange(filter);
  const { sources, mediums } = filter;

  const [curr, prev, currConvRes, prevConvRes, currEventsRes, goals] = await Promise.all([
    resolveSessionIds(clientId, since, until, sources, mediums),
    prevSince
      ? resolveSessionIds(clientId, prevSince, prevUntil, sources, mediums)
      : Promise.resolve({ sessions: [], sessionIds: new Set() }),
    supabase.from('conversion_events').select('id, goal_id, session_id').eq('client_id', clientId).gte('created_at', since).lte('created_at', until),
    prevSince
      ? supabase.from('conversion_events').select('id, session_id').eq('client_id', clientId).gte('created_at', prevSince).lte('created_at', prevUntil)
      : Promise.resolve({ data: [] }),
    supabase.from('events').select('type, session_id').eq('client_id', clientId).in('type', ['pageview', 'click']).gte('created_at', since).lte('created_at', until),
    supabase.from('conversion_goals').select('id, name').eq('client_id', clientId),
  ]);

  const goalNames = {};
  (goals.data || []).forEach(g => { goalNames[g.id] = g.name; });

  const conversions = (currConvRes.data  || []).filter(c => curr.sessionIds.has(c.session_id));
  const prevConvs   = (prevConvRes.data  || []).filter(c => prev.sessionIds.has(c.session_id));
  const events      = (currEventsRes.data || []).filter(e => curr.sessionIds.has(e.session_id));

  const sessionCount     = curr.sessions.length;
  const prevSessionCount = prev.sessions.length;
  const convCount        = conversions.length;
  const prevConvCount    = prevConvs.length;
  const pageviews        = events.filter(e => e.type === 'pageview').length;
  const clicks           = events.filter(e => e.type === 'click').length;
  const convRate         = sessionCount > 0 ? (convCount / sessionCount * 100) : 0;
  const prevConvRate     = prevSessionCount > 0 ? (prevConvCount / prevSessionCount * 100) : 0;

  const visitorMap = {};
  curr.sessions.forEach(s => { visitorMap[s.visitor_id] = (visitorMap[s.visitor_id] || 0) + 1; });
  const newVisitors = Object.values(visitorMap).filter(n => n === 1).length;

  function delta(c, p) {
    if (!p) return null;
    return ((c - p) / p * 100).toFixed(1);
  }

  const conversionsByGoal = {};
  conversions.forEach(c => {
    const name = goalNames[c.goal_id] || 'Unknown goal';
    conversionsByGoal[name] = (conversionsByGoal[name] || 0) + 1;
  });

  return {
    sessions: sessionCount, sessionsDelta: delta(sessionCount, prevSessionCount),
    conversions: convCount, conversionsDelta: delta(convCount, prevConvCount),
    convRate: convRate.toFixed(2), convRateDelta: delta(convRate, prevConvRate),
    pageviews, clicks,
    newVisitors, returningVisitors: sessionCount - newVisitors,
    conversionsByGoal,
  };
}

// ── Daily series ──────────────────────────────────────────────────────────────

export async function getDailySeries(clientId, filter = {}) {
  const { since, until } = resolveRange(filter);
  const msRange = new Date(until) - new Date(since);
  const days = Math.max(1, Math.ceil(msRange / 86400000));
  const { sources, mediums } = filter;

  const [sessRes, convRes] = await Promise.all([
    supabase.from('sessions').select('session_id, created_at, utm_source, utm_medium').eq('client_id', clientId).gte('created_at', since).lte('created_at', until),
    supabase.from('conversion_events').select('session_id, created_at').eq('client_id', clientId).gte('created_at', since).lte('created_at', until),
  ]);

  const allSessions = sessRes.data || [];
  const filteredSessions = (sources?.length || mediums?.length)
    ? allSessions.filter(s => {
        const srcOk = !sources?.length || sources.includes(s.utm_source || 'direct');
        const medOk = !mediums?.length || mediums.includes(s.utm_medium || 'none');
        return srcOk && medOk;
      })
    : allSessions;
  const filteredIds = new Set(filteredSessions.map(s => s.session_id));
  const convs = (convRes.data || []).filter(c => filteredIds.has(c.session_id));

  const map = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(new Date(since).getTime() + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    map[key] = { date: key, sessions: 0, conversions: 0 };
  }
  filteredSessions.forEach(s => { const k = s.created_at.slice(0, 10); if (map[k]) map[k].sessions++; });
  convs.forEach(c => { const k = c.created_at.slice(0, 10); if (map[k]) map[k].conversions++; });
  return Object.values(map);
}

// ── Top pages ─────────────────────────────────────────────────────────────────

export async function getTopPages(clientId, filter = {}, device = null) {
  const { since, until } = resolveRange(filter);
  const { sources, mediums } = filter;
  const { sessionIds } = await resolveSessionIds(clientId, since, until, sources, mediums);

  let evQuery = supabase.from('events')
    .select('url, type, session_id, time_on_page_ms')
    .eq('client_id', clientId)
    .in('type', ['pageview', 'time_on_page'])
    .gte('created_at', since).lte('created_at', until);
  if (device) evQuery = evQuery.eq('device_type', device);

  const [evRes, convRes] = await Promise.all([
    evQuery,
    supabase.from('conversion_events').select('url, session_id').eq('client_id', clientId).gte('created_at', since).lte('created_at', until),
  ]);

  const events     = (evRes.data   || []).filter(e => sessionIds.has(e.session_id));
  const convEvents = (convRes.data || []).filter(c => sessionIds.has(c.session_id));
  if (!events.length) return [];

  const pages = {};
  events.forEach(ev => {
    const url = ev.url.replace(/\?.*/, '');
    if (!pages[url]) pages[url] = { url, pageviews: 0, sessions: new Set(), totalTime: 0, timeCount: 0, conversions: 0 };
    if (ev.type === 'pageview') { pages[url].pageviews++; pages[url].sessions.add(ev.session_id); }
    if (ev.type === 'time_on_page' && ev.time_on_page_ms) { pages[url].totalTime += ev.time_on_page_ms; pages[url].timeCount++; }
  });
  convEvents.forEach(ce => {
    const url = ce.url.replace(/\?.*/, '');
    if (pages[url]) pages[url].conversions++;
  });

  return Object.values(pages).map(p => ({
    url: p.url, pageviews: p.pageviews, sessions: p.sessions.size,
    avgTime: p.timeCount > 0 ? Math.round(p.totalTime / p.timeCount / 1000) : null,
    conversions: p.conversions,
    convRate: p.sessions.size > 0 ? (p.conversions / p.sessions.size * 100).toFixed(1) : '0.0',
  })).sort((a, b) => b.pageviews - a.pageviews).slice(0, 20);
}

// ── Sources ───────────────────────────────────────────────────────────────────
// Conversions = conversion_events rows (not the boolean flag), so totals match
// the goals tab and overview exactly.

export async function getSources(clientId, filter = {}) {
  const { since, until } = resolveRange(filter);

  const [sessRes, convRes] = await Promise.all([
    supabase.from('sessions').select('session_id, utm_source, utm_medium, referrer_url').eq('client_id', clientId).gte('created_at', since).lte('created_at', until),
    supabase.from('conversion_events').select('session_id').eq('client_id', clientId).gte('created_at', since).lte('created_at', until),
  ]);

  if (!sessRes.data) return [];

  const convCountBySession = {};
  (convRes.data || []).forEach(c => {
    convCountBySession[c.session_id] = (convCountBySession[c.session_id] || 0) + 1;
  });

  const sourceMap = {};
  (sessRes.data || []).forEach(s => {
    let source = 'Direct', medium = 'none';
    if (s.utm_source) { source = s.utm_source; medium = s.utm_medium || 'none'; }
    else if (s.referrer_url) {
      try {
        const host = new URL(s.referrer_url).hostname.replace('www.', '');
        if (/google|bing|yahoo|duckduckgo/.test(host)) { source = 'Organic Search'; medium = 'organic'; }
        else if (/facebook|instagram|twitter|linkedin|tiktok|pinterest/.test(host)) { source = 'Organic Social'; medium = 'social'; }
        else { source = host; medium = 'referral'; }
      } catch { source = 'Referral'; medium = 'referral'; }
    }
    const key = source + '|' + medium;
    if (!sourceMap[key]) sourceMap[key] = { source, medium, sessions: 0, conversions: 0 };
    sourceMap[key].sessions++;
    sourceMap[key].conversions += (convCountBySession[s.session_id] || 0);
  });

  return Object.values(sourceMap).map(s => ({
    ...s,
    convRate: s.sessions > 0 ? (s.conversions / s.sessions * 100).toFixed(1) : '0.0',
  })).sort((a, b) => b.sessions - a.sessions);
}

// ── Conversion paths ──────────────────────────────────────────────────────────

export async function getConversionPaths(clientId, filter = {}) {
  const { since, until } = resolveRange(filter);
  const { sources, mediums } = filter;
  const { sessionIds: filteredIds } = await resolveSessionIds(clientId, since, until, sources, mediums);

  const { data: convSessions } = await supabase
    .from('conversion_events').select('session_id')
    .eq('client_id', clientId).gte('created_at', since).lte('created_at', until);
  if (!convSessions || convSessions.length === 0) return [];

  const sessionIds = [...new Set(convSessions.map(c => c.session_id).filter(id => filteredIds.has(id)))].slice(0, 200);
  if (!sessionIds.length) return [];

  const { data: events } = await supabase
    .from('events')
    .select('session_id, type, url, ts, time_on_page_ms, depth_pct')
    .eq('client_id', clientId)
    .in('type', ['pageview', 'time_on_page', 'scroll_depth'])
    .in('session_id', sessionIds)
    .order('ts', { ascending: true });
  if (!events) return [];

  const sessionData = {};
  events.forEach(ev => {
    if (!sessionData[ev.session_id]) sessionData[ev.session_id] = {};
    const path = ev.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*/, '') || '/';
    if (!sessionData[ev.session_id][path]) sessionData[ev.session_id][path] = { path, order: null, timeMs: null, maxDepth: null };
    const step = sessionData[ev.session_id][path];
    if (ev.type === 'pageview' && step.order === null) step.order = new Date(ev.ts).getTime();
    if (ev.type === 'time_on_page' && ev.time_on_page_ms) step.timeMs = ev.time_on_page_ms;
    if (ev.type === 'scroll_depth' && ev.depth_pct) step.maxDepth = Math.max(step.maxDepth || 0, ev.depth_pct);
  });

  const sessionPaths = {};
  Object.entries(sessionData).forEach(([sid, pages]) => {
    sessionPaths[sid] = Object.values(pages).filter(p => p.order !== null).sort((a, b) => a.order - b.order).slice(0, 4);
  });

  const pathMap = {};
  Object.values(sessionPaths).forEach(steps => {
    const key = steps.map(s => s.path).join(' -> ');
    if (!pathMap[key]) pathMap[key] = { path: key, count: 0, steps: steps.map(s => ({ path: s.path, times: [], depths: [] })) };
    pathMap[key].count++;
    steps.forEach((s, i) => {
      if (pathMap[key].steps[i]) {
        if (s.timeMs != null) pathMap[key].steps[i].times.push(s.timeMs);
        if (s.maxDepth != null) pathMap[key].steps[i].depths.push(s.maxDepth);
      }
    });
  });

  return Object.values(pathMap).sort((a, b) => b.count - a.count).slice(0, 10).map(p => ({
    ...p,
    steps: p.steps.map(s => ({
      path: s.path,
      avgTimeMs: s.times.length > 0 ? Math.round(s.times.reduce((a, b) => a + b, 0) / s.times.length) : null,
      avgDepth:  s.depths.length > 0 ? Math.round(s.depths.reduce((a, b) => a + b, 0) / s.depths.length) : null,
    })),
  }));
}

// ── Page influence ────────────────────────────────────────────────────────────

export async function getPageInfluence(clientId, filter = {}) {
  const { since, until } = resolveRange(filter);
  const { sources, mediums } = filter;
  const { sessionIds: filteredIds } = await resolveSessionIds(clientId, since, until, sources, mediums);

  const { data: convSessions } = await supabase
    .from('conversion_events').select('session_id')
    .eq('client_id', clientId).gte('created_at', since).lte('created_at', until);
  if (!convSessions || convSessions.length === 0) return [];

  const sessionIds = [...new Set(convSessions.map(c => c.session_id).filter(id => filteredIds.has(id)))].slice(0, 500);
  if (!sessionIds.length) return [];

  const { data: events } = await supabase
    .from('events').select('session_id, type, url, time_on_page_ms, depth_pct')
    .eq('client_id', clientId)
    .in('type', ['pageview', 'time_on_page', 'scroll_depth'])
    .in('session_id', sessionIds);
  if (!events) return [];

  const pageMap = {};
  const seen = new Set();
  events.forEach(ev => {
    const path = ev.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*/, '') || '/';
    if (!pageMap[path]) pageMap[path] = { path, sessions: 0, times: [], depths: [] };
    const key = ev.session_id + '|' + path;
    if (ev.type === 'pageview' && !seen.has(key)) { seen.add(key); pageMap[path].sessions++; }
    if (ev.type === 'time_on_page' && ev.time_on_page_ms) pageMap[path].times.push(ev.time_on_page_ms);
    if (ev.type === 'scroll_depth' && ev.depth_pct) pageMap[path].depths.push(ev.depth_pct);
  });

  const total = sessionIds.length;
  return Object.values(pageMap).map(p => ({
    path: p.path, sessions: p.sessions,
    pct: total > 0 ? (p.sessions / total * 100) : 0,
    avgTimeMs: p.times.length > 0 ? Math.round(p.times.reduce((a, b) => a + b, 0) / p.times.length) : null,
    avgDepth:  p.depths.length > 0 ? Math.round(p.depths.reduce((a, b) => a + b, 0) / p.depths.length) : null,
  })).sort((a, b) => b.sessions - a.sessions).slice(0, 30);
}

// ── Session path (drilldown) ──────────────────────────────────────────────────

export async function getSessionPath(clientId, sessionId) {
  const { data: events } = await supabase
    .from('events').select('type, url, ts, time_on_page_ms, depth_pct')
    .eq('client_id', clientId).eq('session_id', sessionId)
    .in('type', ['pageview', 'time_on_page', 'scroll_depth'])
    .order('ts', { ascending: true });
  if (!events) return [];

  const pages = {};
  const order = [];
  events.forEach(ev => {
    const path = ev.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*/, '') || '/';
    if (ev.type === 'pageview' && !pages[path]) { pages[path] = { path, ts: ev.ts, timeMs: null, maxDepth: null }; order.push(path); }
    if (ev.type === 'time_on_page' && ev.time_on_page_ms && pages[path]) pages[path].timeMs = ev.time_on_page_ms;
    if (ev.type === 'scroll_depth' && ev.depth_pct && pages[path]) pages[path].maxDepth = Math.max(pages[path].maxDepth || 0, ev.depth_pct);
  });
  return order.map(p => pages[p]);
}

// ── Form analytics ────────────────────────────────────────────────────────────

export async function getFormAnalytics(clientId, days = 30) {
  const { since } = dateRange(days);
  const { data: events } = await supabase.from('events')
    .select('type, form_id, field_name, field_type, field_index, time_to_fill_ms, url, session_id')
    .eq('client_id', clientId).in('type', ['form_field', 'form_submit']).gte('created_at', since);
  if (!events || events.length === 0) return [];

  const forms = {};
  events.forEach(ev => {
    const formKey = ev.url.replace(/\?.*/, '') + '|' + (ev.form_id || 'unknown');
    if (!forms[formKey]) forms[formKey] = { url: ev.url.replace(/\?.*/, ''), formId: ev.form_id || 'unknown', fields: {}, submits: new Set(), starts: new Set() };
    const form = forms[formKey];
    if (ev.type === 'form_submit') form.submits.add(ev.session_id);
    if (ev.type === 'form_field' && ev.field_name) {
      form.starts.add(ev.session_id);
      if (!form.fields[ev.field_name]) form.fields[ev.field_name] = { name: ev.field_name, type: ev.field_type, index: ev.field_index, times: [], interactions: 0 };
      form.fields[ev.field_name].interactions++;
      if (ev.time_to_fill_ms) form.fields[ev.field_name].times.push(ev.time_to_fill_ms);
    }
  });

  return Object.values(forms).map(form => ({
    url: form.url, formId: form.formId, starts: form.starts.size, submits: form.submits.size,
    completionRate: form.starts.size > 0 ? (form.submits.size / form.starts.size * 100).toFixed(1) : '0.0',
    fields: Object.values(form.fields).sort((a, b) => (a.index ?? 99) - (b.index ?? 99)).map(f => ({
      name: f.name, type: f.type, interactions: f.interactions,
      avgTime: f.times.length > 0 ? Math.round(f.times.reduce((a, b) => a + b, 0) / f.times.length / 1000) : null,
    })),
  }));
}

// ── Visitor latency ───────────────────────────────────────────────────────────

export async function getVisitorLatency(clientId) {
  const { data } = await supabase.from('visitor_conversion_latency').select('*').eq('client_id', clientId);
  if (!data || data.length === 0) return { avgSessions: 0, avgHours: 0, distribution: [] };

  const avgSessions = (data.reduce((a, b) => a + Number(b.total_sessions), 0) / data.length).toFixed(1);
  const avgHours    = (data.reduce((a, b) => a + Number(b.hours_to_conversion), 0) / data.length).toFixed(1);

  const dist = { '1': 0, '2': 0, '3-5': 0, '6+': 0 };
  data.forEach(v => {
    const n = Number(v.total_sessions);
    if (n === 1) dist['1']++;
    else if (n === 2) dist['2']++;
    else if (n <= 5) dist['3-5']++;
    else dist['6+']++;
  });

  return {
    avgSessions, avgHours, totalConverters: data.length,
    distribution: Object.entries(dist).map(([label, count]) => ({ label, count })),
  };
}