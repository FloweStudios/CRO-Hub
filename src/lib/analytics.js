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
  const PAGE = 1000;
  let all = [], from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('sessions')
      .select('session_id, utm_source, utm_medium, referrer_url, converted, visitor_id, device_type, country, created_at')
      .eq('client_id', clientId)
      .gte('created_at', since)
      .lte('created_at', until)
      .range(from, from + PAGE - 1);
    if (error || !data?.length) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

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

// Generic paginator for any Supabase query — removes the 1000 row default cap
async function fetchAllPages(query) {
  const PAGE = 1000;
  let rows = [], from = 0;
  while (true) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error || !data?.length) break;
    rows = rows.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

export async function getOverview(clientId, filter = {}) {
  const { since, until, prevSince, prevUntil } = resolveRange(filter);
  const { sources, mediums } = filter;

  const [curr, prev, currConvRes, prevConvRes, currEventsRes, goals, engagementRes] = await Promise.all([
    resolveSessionIds(clientId, since, until, sources, mediums),
    prevSince
      ? resolveSessionIds(clientId, prevSince, prevUntil, sources, mediums)
      : Promise.resolve({ sessions: [], sessionIds: new Set() }),
    supabase.from('conversion_events').select('id, goal_id, session_id').eq('client_id', clientId).gte('created_at', since).lte('created_at', until),
    prevSince
      ? supabase.from('conversion_events').select('id, session_id').eq('client_id', clientId).gte('created_at', prevSince).lte('created_at', prevUntil)
      : Promise.resolve({ data: [] }),
    supabase.from('events').select('type, session_id').eq('client_id', clientId).in('type', ['pageview', 'click']).gte('created_at', since).lte('created_at', until),
    supabase.from('conversion_goals').select('id, name, goal_value').eq('client_id', clientId),
    // Fetch time_on_page and scroll_depth for avg session length + avg scroll
    supabase.from('events').select('session_id, type, time_on_page_ms, depth_pct')
      .eq('client_id', clientId)
      .in('type', ['time_on_page', 'scroll_depth'])
      .gte('created_at', since).lte('created_at', until),
  ]);

  const goalNames = {};
  const goalValues = {};
  (goals.data || []).forEach(g => { goalNames[g.id] = g.name; goalValues[g.id] = g.goal_value ? Number(g.goal_value) : null; });

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
  const newVisitorIds      = new Set(Object.entries(visitorMap).filter(([, n]) => n === 1).map(([id]) => id));
  const newSessions        = curr.sessions.filter(s => newVisitorIds.has(s.visitor_id));
  const returningSessions  = curr.sessions.filter(s => !newVisitorIds.has(s.visitor_id));
  const newSessionIds      = new Set(newSessions.map(s => s.session_id));
  const returningSessionIds = new Set(returningSessions.map(s => s.session_id));
  const newConvs           = conversions.filter(c => newSessionIds.has(c.session_id));
  const returningConvs     = conversions.filter(c => returningSessionIds.has(c.session_id));
  const newConvRate        = newSessions.length > 0 ? (newConvs.length / newSessions.length * 100).toFixed(2) : '0.00';
  const returningConvRate  = returningSessions.length > 0 ? (returningConvs.length / returningSessions.length * 100).toFixed(2) : '0.00';

  // Avg session length: sum time_on_page_ms per session, then average across sessions
  // Avg scroll depth: max scroll per session, then average across sessions
  const engagementEvents = (engagementRes.data || []).filter(e => curr.sessionIds.has(e.session_id));
  const sessionTimeMap = {};
  const sessionDepthMap = {};
  engagementEvents.forEach(ev => {
    if (ev.type === 'time_on_page' && ev.time_on_page_ms) {
      sessionTimeMap[ev.session_id] = (sessionTimeMap[ev.session_id] || 0) + ev.time_on_page_ms;
    }
    if (ev.type === 'scroll_depth' && ev.depth_pct) {
      sessionDepthMap[ev.session_id] = Math.max(sessionDepthMap[ev.session_id] || 0, ev.depth_pct);
    }
  });
  const sessionTimes  = Object.values(sessionTimeMap);
  const sessionDepths = Object.values(sessionDepthMap);
  const avgSessionLengthMs = sessionTimes.length > 0
    ? Math.round(sessionTimes.reduce((a, b) => a + b, 0) / sessionTimes.length)
    : null;
  const avgScrollDepth = sessionDepths.length > 0
    ? Math.round(sessionDepths.reduce((a, b) => a + b, 0) / sessionDepths.length)
    : null;

  function delta(c, p) {
    if (!p) return null;
    return ((c - p) / p * 100).toFixed(1);
  }

  const conversionsByGoal = {};
  const revenueByGoal = {};
  let totalRevenue = 0;
  conversions.forEach(c => {
    const name = goalNames[c.goal_id] || 'Unknown goal';
    conversionsByGoal[name] = (conversionsByGoal[name] || 0) + 1;
    const val = goalValues[c.goal_id];
    if (val != null) {
      revenueByGoal[name] = (revenueByGoal[name] || 0) + val;
      totalRevenue += val;
    }
  });

  return {
    sessions: sessionCount, sessionsDelta: delta(sessionCount, prevSessionCount),
    conversions: convCount, conversionsDelta: delta(convCount, prevConvCount),
    convRate: convRate.toFixed(2), convRateDelta: delta(convRate, prevConvRate),
    pageviews, clicks,
    newVisitors: newSessions.length,
    returningVisitors: returningSessions.length,
    newConvRate,
    returningConvRate,
    avgSessionLengthMs,
    avgScrollDepth,
    conversionsByGoal,
    revenueByGoal,
    totalRevenue,
  };
}

// ── Daily series ──────────────────────────────────────────────────────────────

export async function getRevenueBreakdown(clientId, filter = {}) {
  const { since, until } = resolveRange(filter);
  const { sources, mediums } = filter;

  let sessionIdFilter = null;
  if (sources?.length || mediums?.length) {
    const { sessionIds } = await resolveSessionIds(clientId, since, until, sources, mediums);
    sessionIdFilter = [...sessionIds];
  }

  const [goalsRes, convRes, sessRes] = await Promise.all([
    supabase.from('conversion_goals').select('id, name, goal_value').eq('client_id', clientId),
    supabase.from('conversion_events').select('goal_id, session_id').eq('client_id', clientId).gte('created_at', since).lte('created_at', until),
    fetchAllPages(supabase.from('sessions').select('session_id, utm_source, utm_medium, referrer_url').eq('client_id', clientId).gte('created_at', since).lte('created_at', until)),
  ]);

  const goalMap = {};
  (goalsRes.data || []).forEach(g => { goalMap[g.id] = { name: g.name, value: g.goal_value != null ? Number(g.goal_value) : null }; });

  const sessionSourceMap = {};
  sessRes.forEach(s => {
    let source = 'Direct';
    if (s.utm_source) source = s.utm_source;
    else if (s.referrer_url) {
      try {
        const host = new URL(s.referrer_url).hostname.replace('www.', '');
        if (/google|bing|yahoo|duckduckgo/.test(host)) source = 'Organic Search';
        else if (/facebook|instagram|twitter|linkedin|tiktok|pinterest/.test(host)) source = host;
        else source = host;
      } catch { source = 'Referral'; }
    }
    sessionSourceMap[s.session_id] = source;
  });

  let convs = convRes.data || [];
  if (sessionIdFilter) convs = convs.filter(c => sessionIdFilter.includes(c.session_id));

  let totalRevenue = 0;
  const byGoal = {};
  const bySource = {};

  convs.forEach(c => {
    const goal = goalMap[c.goal_id];
    if (!goal || goal.value == null) return;
    const rev = goal.value;
    totalRevenue += rev;

    // By goal
    if (!byGoal[goal.name]) byGoal[goal.name] = { conversions: 0, revenue: 0 };
    byGoal[goal.name].conversions++;
    byGoal[goal.name].revenue += rev;

    // By source
    const src = sessionSourceMap[c.session_id] || 'Direct';
    if (!bySource[src]) bySource[src] = { conversions: 0, revenue: 0 };
    bySource[src].conversions++;
    bySource[src].revenue += rev;
  });

  return {
    totalRevenue,
    byGoal: Object.entries(byGoal)
      .map(([name, d]) => ({ name, ...d, pct: totalRevenue > 0 ? (d.revenue / totalRevenue * 100).toFixed(0) : '0' }))
      .sort((a, b) => b.revenue - a.revenue),
    bySource: Object.entries(bySource)
      .map(([source, d]) => ({ source, ...d, pct: totalRevenue > 0 ? (d.revenue / totalRevenue * 100).toFixed(0) : '0' }))
      .sort((a, b) => b.revenue - a.revenue),
  };
}

export async function getDailySeries(clientId, filter = {}) {
  const { since, until } = resolveRange(filter);
  const msRange = new Date(until) - new Date(since);
  const days = Math.max(1, Math.ceil(msRange / 86400000));
  const { sources, mediums } = filter;

  const [allSessions, convData] = await Promise.all([
    fetchAllPages(supabase.from('sessions').select('session_id, created_at, utm_source, utm_medium').eq('client_id', clientId).gte('created_at', since).lte('created_at', until)),
    fetchAllPages(supabase.from('conversion_events').select('session_id, created_at').eq('client_id', clientId).gte('created_at', since).lte('created_at', until)),
  ]);

  const filteredSessions = (sources?.length || mediums?.length)
    ? allSessions.filter(s => {
        const srcOk = !sources?.length || sources.includes(s.utm_source || 'direct');
        const medOk = !mediums?.length || mediums.includes(s.utm_medium || 'none');
        return srcOk && medOk;
      })
    : allSessions;
  const filteredIds = new Set(filteredSessions.map(s => s.session_id));
  const convs = convData.filter(c => filteredIds.has(c.session_id));

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

function normUrl(raw) {
  try { return (new URL(raw).pathname.replace(/\/+$/, '') || '/').toLowerCase(); }
  catch { return raw.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*/, '').replace(/\/+$/, '').toLowerCase() || '/'; }
}

// Fast version — only fetches pageviews + conversions, no time/scroll.
// Used for the initial top-10 render. Returns top 10 sorted by conversions desc.
export async function getEntryExitPages(clientId, filter = {}) {
  const { since, until } = resolveRange(filter);
  const { sources, mediums } = filter;

  let sessionIdFilter = null;
  if (sources?.length || mediums?.length) {
    const { sessionIds } = await resolveSessionIds(clientId, since, until, sources, mediums);
    sessionIdFilter = [...sessionIds];
  }

  // Entry pages come from sessions.landing_url — already stored, no event scan needed
  let sessQuery = supabase.from('sessions').select('landing_url, session_id')
    .eq('client_id', clientId).gte('created_at', since).lte('created_at', until)
    .not('landing_url', 'is', null);
  if (sessionIdFilter) sessQuery = sessQuery.in('session_id', sessionIdFilter);

  // Exit pages: last pageview per session by ts
  let pvQuery = supabase.from('events').select('url, session_id, ts')
    .eq('client_id', clientId).eq('type', 'pageview')
    .gte('created_at', since).lte('created_at', until);
  if (sessionIdFilter) pvQuery = pvQuery.in('session_id', sessionIdFilter);

  const [sessions, pvEvents] = await Promise.all([
    fetchAllPages(sessQuery),
    fetchAllPages(pvQuery),
  ]);

  // Entry counts
  const entryCounts = {};
  sessions.forEach(s => {
    const url = normUrl(s.landing_url);
    entryCounts[url] = (entryCounts[url] || 0) + 1;
  });

  // Exit counts — last pageview per session
  const sessionLastPage = {};
  pvEvents.forEach(ev => {
    const url = normUrl(ev.url);
    const ex = sessionLastPage[ev.session_id];
    if (!ex || ev.ts > ex.ts) sessionLastPage[ev.session_id] = { url, ts: ev.ts };
  });
  const exitCounts = {};
  Object.values(sessionLastPage).forEach(({ url }) => { exitCounts[url] = (exitCounts[url] || 0) + 1; });

  const allUrls = new Set([...Object.keys(entryCounts), ...Object.keys(exitCounts)]);
  const total = sessions.length;

  const rows = [...allUrls].map(url => ({
    url,
    entries: entryCounts[url] || 0,
    entryRate: total > 0 ? ((entryCounts[url] || 0) / total * 100).toFixed(1) : '0.0',
    exits: exitCounts[url] || 0,
    exitRate: total > 0 ? ((exitCounts[url] || 0) / total * 100).toFixed(1) : '0.0',
  }));

  return {
    topEntries: [...rows].sort((a, b) => b.entries - a.entries).slice(0, 15),
    topExits:   [...rows].sort((a, b) => b.exits   - a.exits  ).slice(0, 15),
  };
}

export async function getTopPagesFast(clientId, filter = {}, device = null) {
  const { since, until } = resolveRange(filter);
  const { sources, mediums } = filter;

  let sessionIdFilter = null;
  if (sources?.length || mediums?.length) {
    const { sessionIds } = await resolveSessionIds(clientId, since, until, sources, mediums);
    sessionIdFilter = [...sessionIds];
  }

  let pvQuery = supabase.from('events').select('url, session_id, ts').eq('client_id', clientId).eq('type', 'pageview').gte('created_at', since).lte('created_at', until);
  if (device) pvQuery = pvQuery.eq('device_type', device);
  if (sessionIdFilter) pvQuery = pvQuery.in('session_id', sessionIdFilter);

  let convQuery = supabase.from('conversion_events').select('url').eq('client_id', clientId).gte('created_at', since).lte('created_at', until);
  if (sessionIdFilter) convQuery = convQuery.in('session_id', sessionIdFilter);

  const [pvEvents, convEvents] = await Promise.all([
    fetchAllPages(pvQuery),
    fetchAllPages(convQuery),
  ]);

  // Find last page per session for exit rate
  const sessionLastPage = {};
  pvEvents.forEach(ev => {
    const url = normUrl(ev.url);
    const existing = sessionLastPage[ev.session_id];
    if (!existing || ev.ts > existing.ts) sessionLastPage[ev.session_id] = { url, ts: ev.ts };
  });
  const exitCounts = {};
  Object.values(sessionLastPage).forEach(({ url }) => {
    exitCounts[url] = (exitCounts[url] || 0) + 1;
  });

  const pages = {};
  pvEvents.forEach(ev => {
    const url = normUrl(ev.url);
    if (!pages[url]) pages[url] = { url, pageviews: 0, sessions: new Set(), conversions: 0 };
    pages[url].pageviews++;
    pages[url].sessions.add(ev.session_id);
  });
  convEvents.forEach(ce => {
    const url = normUrl(ce.url);
    if (!pages[url]) pages[url] = { url, pageviews: 0, sessions: new Set(), conversions: 0 };
    pages[url].conversions++;
  });

  return Object.values(pages).map(p => ({
    url: p.url, pageviews: p.pageviews, conversions: p.conversions,
    avgTime: null, avgScrollDepth: null,
    exitRate: p.sessions.size > 0 ? ((exitCounts[p.url] || 0) / p.sessions.size * 100).toFixed(1) : '0.0',
    convRate: p.pageviews > 0 ? (p.conversions / p.pageviews * 100).toFixed(1) : '0.0',
  })).sort((a, b) => b.conversions - a.conversions).slice(0, 10);
}

// Full version — includes time on page and scroll depth. Slower due to volume.
export async function getTopPages(clientId, filter = {}, device = null) {
  const { since, until } = resolveRange(filter);
  const { sources, mediums } = filter;

  let sessionIdFilter = null;
  if (sources?.length || mediums?.length) {
    const { sessionIds } = await resolveSessionIds(clientId, since, until, sources, mediums);
    sessionIdFilter = [...sessionIds];
  }

  let pvQuery = supabase.from('events').select('url, session_id, ts').eq('client_id', clientId).eq('type', 'pageview').gte('created_at', since).lte('created_at', until);
  if (device) pvQuery = pvQuery.eq('device_type', device);
  if (sessionIdFilter) pvQuery = pvQuery.in('session_id', sessionIdFilter);

  let topQuery = supabase.from('events').select('url, session_id, time_on_page_ms, depth_pct, type').eq('client_id', clientId).in('type', ['time_on_page', 'scroll_depth']).gte('created_at', since).lte('created_at', until);
  if (sessionIdFilter) topQuery = topQuery.in('session_id', sessionIdFilter);

  let convQuery = supabase.from('conversion_events').select('url, session_id').eq('client_id', clientId).gte('created_at', since).lte('created_at', until);
  if (sessionIdFilter) convQuery = convQuery.in('session_id', sessionIdFilter);

  const [pvEvents, engEvents, convEvents] = await Promise.all([
    fetchAllPages(pvQuery),
    fetchAllPages(topQuery),
    fetchAllPages(convQuery),
  ]);

  // Exit rate: find last page per session
  const sessionLastPage = {};
  pvEvents.forEach(ev => {
    const url = normUrl(ev.url);
    const ex = sessionLastPage[ev.session_id];
    if (!ex || ev.ts > ex.ts) sessionLastPage[ev.session_id] = { url, ts: ev.ts };
  });
  const exitCounts = {};
  Object.values(sessionLastPage).forEach(({ url }) => { exitCounts[url] = (exitCounts[url] || 0) + 1; });

  const pages = {};
  pvEvents.forEach(ev => {
    const url = normUrl(ev.url);
    if (!pages[url]) pages[url] = { url, pageviews: 0, sessions: new Set(), sessionTimes: {}, depths: {}, conversions: 0 };
    pages[url].pageviews++;
    pages[url].sessions.add(ev.session_id);
    if (!pages[url].sessionTimes[ev.session_id]) pages[url].sessionTimes[ev.session_id] = 0;
  });
  engEvents.forEach(ev => {
    const url = normUrl(ev.url);
    if (!pages[url]) return;
    if (ev.type === 'time_on_page' && ev.time_on_page_ms)
      pages[url].sessionTimes[ev.session_id] = (pages[url].sessionTimes[ev.session_id] || 0) + ev.time_on_page_ms;
    if (ev.type === 'scroll_depth' && ev.depth_pct)
      pages[url].depths[ev.session_id] = Math.max(pages[url].depths[ev.session_id] || 0, ev.depth_pct);
  });
  convEvents.forEach(ce => {
    const url = normUrl(ce.url);
    if (!pages[url]) pages[url] = { url, pageviews: 0, sessions: new Set(), sessionTimes: {}, depths: {}, conversions: 0 };
    pages[url].conversions++;
  });

  return Object.values(pages).map(p => {
    const times = Object.values(p.sessionTimes).filter(t => t > 0);
    const depths = Object.values(p.depths || {});
    const sessionCount = p.sessions.size;
    return {
      url: p.url, pageviews: p.pageviews,
      avgTime: times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length / 1000) : null,
      avgScrollDepth: depths.length > 0 ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length) : null,
      conversions: p.conversions,
      convRate: p.pageviews > 0 ? (p.conversions / p.pageviews * 100).toFixed(1) : '0.0',
      exitRate: sessionCount > 0 ? ((exitCounts[p.url] || 0) / sessionCount * 100).toFixed(1) : '0.0',
    };
  }).sort((a, b) => b.conversions - a.conversions);
}

// Fast version — sessions + conversions only, no time_on_page scan. Top 10 by sessions.
export async function getSourcesFast(clientId, filter = {}) {
  const { since, until } = resolveRange(filter);

  const [allSessions, convData] = await Promise.all([
    fetchAllPages(supabase.from('sessions').select('session_id, utm_source, utm_medium, referrer_url').eq('client_id', clientId).gte('created_at', since).lte('created_at', until)),
    fetchAllPages(supabase.from('conversion_events').select('session_id').eq('client_id', clientId).gte('created_at', since).lte('created_at', until)),
  ]);

  if (!allSessions.length) return [];

  const convCountBySession = {};
  convData.forEach(c => { convCountBySession[c.session_id] = (convCountBySession[c.session_id] || 0) + 1; });

  const sourceMap = {};
  allSessions.forEach(s => {
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
    source: s.source, medium: s.medium, sessions: s.sessions,
    avgSessionLengthMs: null,
    conversions: s.conversions,
    convRate: s.sessions > 0 ? (s.conversions / s.sessions * 100).toFixed(1) : '0.0',
  })).sort((a, b) => b.sessions - a.sessions).slice(0, 10);
}

// Full version — includes avg session length from time_on_page events.
export async function getSources(clientId, filter = {}) {
  const { since, until } = resolveRange(filter);

  const [allSessions, convData, timeData] = await Promise.all([
    fetchAllPages(supabase.from('sessions').select('session_id, utm_source, utm_medium, referrer_url').eq('client_id', clientId).gte('created_at', since).lte('created_at', until)),
    fetchAllPages(supabase.from('conversion_events').select('session_id').eq('client_id', clientId).gte('created_at', since).lte('created_at', until)),
    fetchAllPages(supabase.from('events').select('session_id, time_on_page_ms').eq('client_id', clientId).eq('type', 'time_on_page').gte('created_at', since).lte('created_at', until)),
  ]);

  if (!allSessions.length) return [];

  const sessionTotalTime = {};
  timeData.forEach(ev => {
    if (ev.time_on_page_ms) sessionTotalTime[ev.session_id] = (sessionTotalTime[ev.session_id] || 0) + ev.time_on_page_ms;
  });

  const convCountBySession = {};
  convData.forEach(c => {
    convCountBySession[c.session_id] = (convCountBySession[c.session_id] || 0) + 1;
  });

  const sourceMap = {};
  allSessions.forEach(s => {
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
    if (!sourceMap[key]) sourceMap[key] = { source, medium, sessions: 0, conversions: 0, totalTimeMs: 0, timeSessions: 0 };
    sourceMap[key].sessions++;
    sourceMap[key].conversions += (convCountBySession[s.session_id] || 0);
    const t = sessionTotalTime[s.session_id];
    if (t) { sourceMap[key].totalTimeMs += t; sourceMap[key].timeSessions++; }
  });

  return Object.values(sourceMap).map(s => ({
    source: s.source, medium: s.medium, sessions: s.sessions,
    avgSessionLengthMs: s.timeSessions > 0 ? Math.round(s.totalTimeMs / s.timeSessions) : null,
    conversions: s.conversions,
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
    if (!sessionData[ev.session_id][path]) sessionData[ev.session_id][path] = { path, order: null, timeMs: 0, hasTime: false, maxDepth: null };
    const step = sessionData[ev.session_id][path];
    if (ev.type === 'pageview' && step.order === null) step.order = new Date(ev.ts).getTime();
    // Sum chunks so total session time on this page is correct (not just last 2s chunk)
    if (ev.type === 'time_on_page' && ev.time_on_page_ms) { step.timeMs += ev.time_on_page_ms; step.hasTime = true; }
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
        if (s.hasTime) pathMap[key].steps[i].times.push(s.timeMs);
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
  const sessionPageTime = {}; // session|path -> accumulated ms
  events.forEach(ev => {
    const path = ev.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*/, '') || '/';
    if (!pageMap[path]) pageMap[path] = { path, sessions: 0, sessionTimes: {}, depths: [] };
    const key = ev.session_id + '|' + path;
    if (ev.type === 'pageview' && !seen.has(key)) { seen.add(key); pageMap[path].sessions++; }
    // Sum chunks per session per page so avg reflects total time, not chunk size
    if (ev.type === 'time_on_page' && ev.time_on_page_ms) {
      pageMap[path].sessionTimes[ev.session_id] = (pageMap[path].sessionTimes[ev.session_id] || 0) + ev.time_on_page_ms;
    }
    if (ev.type === 'scroll_depth' && ev.depth_pct) pageMap[path].depths.push(ev.depth_pct);
  });

  const total = sessionIds.length;
  return Object.values(pageMap).map(p => {
    const sessionTimeValues = Object.values(p.sessionTimes);
    const avgTimeMs = sessionTimeValues.length > 0
      ? Math.round(sessionTimeValues.reduce((a, b) => a + b, 0) / sessionTimeValues.length)
      : null;
    return {
      path: p.path, sessions: p.sessions,
      pct: total > 0 ? (p.sessions / total * 100) : 0,
      avgTimeMs,
      avgDepth: p.depths.length > 0 ? Math.round(p.depths.reduce((a, b) => a + b, 0) / p.depths.length) : null,
    };
  }).sort((a, b) => b.sessions - a.sessions).slice(0, 30);
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
    if (ev.type === 'pageview' && !pages[path]) { pages[path] = { path, ts: ev.ts, timeMs: 0, hasTime: false, maxDepth: null }; order.push(path); }
    if (ev.type === 'time_on_page' && ev.time_on_page_ms && pages[path]) { pages[path].timeMs += ev.time_on_page_ms; pages[path].hasTime = true; }
    if (ev.type === 'scroll_depth' && ev.depth_pct && pages[path]) pages[path].maxDepth = Math.max(pages[path].maxDepth || 0, ev.depth_pct);
  });
  return order.map(p => ({ ...pages[p], timeMs: pages[p].hasTime ? pages[p].timeMs : null }));
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

export async function getVisitorLatency(clientId, filter = {}) {
  const { since, until } = resolveRange(filter);
  const { sources, mediums } = filter;

  // Build latency from raw data so date range and source filter work correctly.
  // The visitor_conversion_latency view has no date/source columns so we bypass it.
  const [allSessions, convData] = await Promise.all([
    fetchAllPages(supabase.from('sessions').select('session_id, visitor_id, utm_source, utm_medium, created_at, converted').eq('client_id', clientId).gte('created_at', since).lte('created_at', until)),
    fetchAllPages(supabase.from('conversion_events').select('session_id, created_at').eq('client_id', clientId).gte('created_at', since).lte('created_at', until)),
  ]);

  if (!allSessions.length) return { avgSessions: 0, avgHours: 0, distribution: [], totalConverters: 0 };

  // Apply source/medium filter
  const filteredSessions = (sources?.length || mediums?.length)
    ? allSessions.filter(s => {
        const srcOk = !sources?.length || sources.includes(s.utm_source || 'direct');
        const medOk = !mediums?.length || mediums.includes(s.utm_medium || 'none');
        return srcOk && medOk;
      })
    : allSessions;

  // Map session_id -> visitor_id for filtered sessions
  const sessionToVisitor = {};
  filteredSessions.forEach(s => { sessionToVisitor[s.session_id] = s.visitor_id; });
  const filteredSessionIds = new Set(filteredSessions.map(s => s.session_id));

  // Find converting sessions that pass filter
  const convertingSessionIds = new Set(
    convData
      .filter(c => filteredSessionIds.has(c.session_id))
      .map(c => c.session_id)
  );

  if (convertingSessionIds.size === 0) return { avgSessions: 0, avgHours: 0, distribution: [], totalConverters: 0 };

  // Group all filtered sessions by visitor_id
  const visitorSessions = {};
  filteredSessions.forEach(s => {
    if (!visitorSessions[s.visitor_id]) visitorSessions[s.visitor_id] = [];
    visitorSessions[s.visitor_id].push(s);
  });

  // For each visitor who converted, compute total sessions before conversion and time span
  const converterData = [];
  convertingSessionIds.forEach(sid => {
    const vid = sessionToVisitor[sid];
    if (!vid) return;
    const allVisitorSessions = (visitorSessions[vid] || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const convIdx = allVisitorSessions.findIndex(s => s.session_id === sid);
    const sessionsToConvert = convIdx >= 0 ? convIdx + 1 : allVisitorSessions.length;
    const firstSeen = new Date(allVisitorSessions[0]?.created_at);
    const convTime  = new Date(allVisitorSessions[convIdx >= 0 ? convIdx : 0]?.created_at);
    const hoursToConversion = (convTime - firstSeen) / 3600000;
    converterData.push({ sessions: sessionsToConvert, hours: hoursToConversion });
  });

  if (converterData.length === 0) return { avgSessions: 0, avgHours: 0, distribution: [], totalConverters: 0 };

  const avgSessions = (converterData.reduce((a, b) => a + b.sessions, 0) / converterData.length).toFixed(1);
  const avgHours    = (converterData.reduce((a, b) => a + b.hours,   0) / converterData.length).toFixed(1);

  const dist = { '1': 0, '2': 0, '3-5': 0, '6+': 0 };
  converterData.forEach(v => {
    const n = v.sessions;
    if (n === 1) dist['1']++;
    else if (n === 2) dist['2']++;
    else if (n <= 5) dist['3-5']++;
    else dist['6+']++;
  });

  return {
    avgSessions, avgHours, totalConverters: converterData.length,
    distribution: Object.entries(dist).map(([label, count]) => ({ label, count })),
  };
}