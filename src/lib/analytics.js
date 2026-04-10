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

// Given a filter object { dateFrom, dateTo, compFrom, compTo, sources, mediums }
// return { since, until, prevSince, prevUntil } as ISO strings.
export function resolveRange(filter = {}) {
  const since  = filter.dateFrom ? new Date(filter.dateFrom).toISOString() : dateRange(30).since;
  const until  = filter.dateTo   ? new Date(filter.dateTo + 'T23:59:59').toISOString() : new Date().toISOString();
  const prevSince = filter.compFrom ? new Date(filter.compFrom).toISOString() : null;
  const prevUntil = filter.compTo   ? new Date(filter.compTo + 'T23:59:59').toISOString() : null;
  return { since, until, prevSince, prevUntil };
}

// Apply source/medium filters to a sessions query result (client-side, since
// UTM data is on the sessions row and filtering server-side is complex).
function matchesSourceFilter(session, sources, mediums) {
  if ((!sources || sources.length === 0) && (!mediums || mediums.length === 0)) return true;
  const src = session.utm_source || 'direct';
  const med = session.utm_medium || 'none';
  const srcMatch = !sources || sources.length === 0 || sources.includes(src);
  const medMatch = !mediums || mediums.length === 0 || mediums.includes(med);
  return srcMatch && medMatch;
}

export async function getOverview(clientId, filter = {}) {
  const { since, until, prevSince, prevUntil } = resolveRange(filter);
  const { sources, mediums } = filter;

  const [currSessions, prevSessions, currConv, prevConv, currEvents, goals] = await Promise.all([
    supabase.from('sessions').select('session_id, converted, visitor_id, utm_source, utm_medium').eq('client_id', clientId).gte('created_at', since).lte('created_at', until),
    prevSince ? supabase.from('sessions').select('session_id, converted, utm_source, utm_medium').eq('client_id', clientId).gte('created_at', prevSince).lte('created_at', prevUntil) : Promise.resolve({ data: [] }),
    supabase.from('conversion_events').select('id, goal_id, session_id').eq('client_id', clientId).gte('created_at', since).lte('created_at', until),
    prevSince ? supabase.from('conversion_events').select('id, session_id').eq('client_id', clientId).gte('created_at', prevSince).lte('created_at', prevUntil) : Promise.resolve({ data: [] }),
    supabase.from('events').select('type, session_id').eq('client_id', clientId).in('type', ['pageview', 'click']).gte('created_at', since).lte('created_at', until),
    supabase.from('conversion_goals').select('id, name').eq('client_id', clientId),
  ]);

  // Apply source/medium filter client-side
  const allSessions  = (currSessions.data || []).filter(s => matchesSourceFilter(s, sources, mediums));
  const allPrevSess  = (prevSessions.data || []).filter(s => matchesSourceFilter(s, sources, mediums));
  const sessionIdSet = new Set(allSessions.map(s => s.session_id));
  const prevSessIdSet = new Set(allPrevSess.map(s => s.session_id));

  const goalNames = {};
  (goals.data || []).forEach(g => { goalNames[g.id] = g.name; });

  const sessions      = allSessions;
  const prevSess      = allPrevSess;
  const conversions   = (currConv.data   || []).filter(c => !sessionIdSet.size || sessionIdSet.has(c.session_id));
  const prevConvs     = (prevConv.data   || []).filter(c => !prevSessIdSet.size || prevSessIdSet.has(c.session_id));
  const events        = (currEvents.data || []).filter(e => !sessionIdSet.size || sessionIdSet.has(e.session_id));

  const sessionCount     = sessions.length;
  const prevSessionCount = prevSess.length;
  const convCount        = conversions.length;
  const prevConvCount    = prevConvs.length;
  const pageviews        = events.filter(e => e.type === 'pageview').length;
  const clicks           = events.filter(e => e.type === 'click').length;
  const convRate         = sessionCount > 0 ? (convCount / sessionCount * 100) : 0;
  const prevConvRate     = prevSessionCount > 0 ? (prevConvCount / prevSessionCount * 100) : 0;
  const newVisitors      = sessions.filter(s =>
    sessions.filter(s2 => s2.visitor_id === s.visitor_id).length === 1
  ).length;

  function delta(curr, prev) {
    if (!prev) return null;
    return ((curr - prev) / prev * 100).toFixed(1);
  }

  // Group by goal name (not ID)
  const conversionsByGoal = {};
  conversions.forEach(c => {
    const name = goalNames[c.goal_id] || 'Unknown goal';
    conversionsByGoal[name] = (conversionsByGoal[name] || 0) + 1;
  });

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
    returningVisitors: sessionCount - newVisitors,
    conversionsByGoal,
  };
}

export async function getDailySeries(clientId, filter = {}) {
  const { since, until } = resolveRange(filter);
  // Calculate number of days in the range for the x-axis
  const msRange = new Date(until) - new Date(since);
  const days = Math.max(1, Math.ceil(msRange / 86400000));

  const [sessRes, convRes] = await Promise.all([
    supabase.from('sessions').select('created_at, utm_source, utm_medium').eq('client_id', clientId).gte('created_at', since).lte('created_at', until),
    supabase.from('conversion_events').select('created_at').eq('client_id', clientId).gte('created_at', since).lte('created_at', until),
  ]);

  const { sources, mediums } = filter;
  const sessions    = (sessRes.data || []).filter(s => matchesSourceFilter(s, sources, mediums));
  const conversions = convRes.data || [];

  const map = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(new Date(since).getTime() + (days - 1 - i) * 86400000);
    const key = d.toISOString().slice(0, 10);
    map[key] = { date: key, sessions: 0, conversions: 0 };
  }

  sessions.forEach(s => { const k = s.created_at.slice(0, 10); if (map[k]) map[k].sessions++; });
  conversions.forEach(c => { const k = c.created_at.slice(0, 10); if (map[k]) map[k].conversions++; });

  return Object.values(map);
}

export async function getTopPages(clientId, filter = {}, device = null) {
  const { since, until } = resolveRange(filter);

  let query = supabase.from('events').select('url, type, session_id, time_on_page_ms').eq('client_id', clientId).in('type', ['pageview', 'time_on_page']).gte('created_at', since).lte('created_at', until);
  if (device) query = query.eq('device_type', device);

  const { data: events } = await query;
  const { data: convEvents } = await supabase.from('conversion_events').select('url').eq('client_id', clientId).gte('created_at', since).lte('created_at', until);

  if (!events) return [];

  const pages = {};
  events.forEach(ev => {
    const url = ev.url.replace(/\?.*/, '');
    if (!pages[url]) pages[url] = { url, pageviews: 0, sessions: new Set(), totalTime: 0, timeCount: 0, conversions: 0 };
    if (ev.type === 'pageview') { pages[url].pageviews++; pages[url].sessions.add(ev.session_id); }
    if (ev.type === 'time_on_page' && ev.time_on_page_ms) { pages[url].totalTime += ev.time_on_page_ms; pages[url].timeCount++; }
  });

  (convEvents || []).forEach(ce => {
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

export async function getSources(clientId, filter = {}) {
  const { since, until } = resolveRange(filter);
  const { data: sessions } = await supabase.from('sessions').select('session_id, utm_source, utm_medium, referrer_url, converted').eq('client_id', clientId).gte('created_at', since).lte('created_at', until);
  if (!sessions) return [];

  const sourceMap = {};
  sessions.forEach(s => {
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
    const key = `${source}|${medium}`;
    if (!sourceMap[key]) sourceMap[key] = { source, medium, sessions: 0, conversions: 0 };
    sourceMap[key].sessions++;
    if (s.converted) sourceMap[key].conversions++;
  });

  return Object.values(sourceMap).map(s => ({
    ...s, convRate: s.sessions > 0 ? (s.conversions / s.sessions * 100).toFixed(1) : '0.0',
  })).sort((a, b) => b.sessions - a.sessions);
}

export async function getConversionPaths(clientId, filter = {}) {
  const { since, until } = resolveRange(filter);
  const { data: convSessions } = await supabase.from('conversion_events').select('session_id').eq('client_id', clientId).gte('created_at', since).lte('created_at', until);
  if (!convSessions || convSessions.length === 0) return [];

  const sessionIds = [...new Set(convSessions.map(c => c.session_id))].slice(0, 200);
  const { data: pageviews } = await supabase.from('events').select('session_id, url, ts').eq('client_id', clientId).eq('type', 'pageview').in('session_id', sessionIds).order('ts', { ascending: true });
  if (!pageviews) return [];

  const sessionPaths = {};
  pageviews.forEach(pv => {
    const path = pv.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*/, '') || '/';
    if (!sessionPaths[pv.session_id]) sessionPaths[pv.session_id] = [];
    sessionPaths[pv.session_id].push(path);
  });

  const pathCounts = {};
  Object.values(sessionPaths).forEach(pages => {
    const key = pages.slice(0, 4).join(' → ');
    pathCounts[key] = (pathCounts[key] || 0) + 1;
  });

  return Object.entries(pathCounts).map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count).slice(0, 10);
}

export async function getFormAnalytics(clientId, days = 30) {
  const { since } = dateRange(days);
  const { data: events } = await supabase.from('events').select('type, form_id, field_name, field_type, field_index, time_to_fill_ms, url, session_id').eq('client_id', clientId).in('type', ['form_field', 'form_submit']).gte('created_at', since);
  if (!events || events.length === 0) return [];

  const forms = {};
  events.forEach(ev => {
    const formKey = `${ev.url.replace(/\?.*/, '')}|${ev.form_id || 'unknown'}`;
    if (!forms[formKey]) forms[formKey] = { url: ev.url.replace(/\?.*/, ''), formId: ev.form_id || 'unknown', fields: {}, submits: new Set(), starts: new Set() };
    const form = forms[formKey];
    if (ev.type === 'form_submit') form.submits.add(ev.session_id);
    if (ev.type === 'form_field' && ev.field_name) {
      form.starts.add(ev.session_id);
      const fk = ev.field_name;
      if (!form.fields[fk]) form.fields[fk] = { name: fk, type: ev.field_type, index: ev.field_index, times: [], interactions: 0 };
      form.fields[fk].interactions++;
      if (ev.time_to_fill_ms) form.fields[fk].times.push(ev.time_to_fill_ms);
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

export async function getVisitorLatency(clientId, days = 90) {
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