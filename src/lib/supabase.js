import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signOut() {
  return supabase.auth.signOut();
}

export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_event, session) => cb(session));
}

export async function getPartners() {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false });
  return { data, error };
}

export async function createPartner({ name, domain }) {
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    + '-' + Date.now().toString(36);

  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('clients')
    .insert({ id, name, domain, secret_key: secret, owner_id: user.id })
    .select()
    .single();

  return { data, error };
}

export async function deletePartner(id) {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  return { error };
}

// ── Stats ─────────────────────────────────────────────────────────────────────
// Pulls pageviews + clicks from events table, sessions from sessions table.
// Using .select('type') with a filter is the lightest query — no COUNT() on
// large tables, just fetches the type column for the date window.

export async function getPartnerStats(clientId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // Run queries in parallel
  const [eventsRes, sessionsRes, conversionsRes] = await Promise.all([
    supabase
      .from('events')
      .select('type')
      .eq('client_id', clientId)
      .in('type', ['pageview', 'click'])
      .gte('created_at', since),

    supabase
      .from('sessions')
      .select('session_id, converted')
      .eq('client_id', clientId)
      .gte('created_at', since),

    supabase
      .from('conversion_events')
      .select('id')
      .eq('client_id', clientId)
      .gte('created_at', since),
  ]);

  const events      = eventsRes.data      || [];
  const sessions    = sessionsRes.data    || [];
  const conversions = conversionsRes.data || [];

  const pageviews       = events.filter(e => e.type === 'pageview').length;
  const clicks          = events.filter(e => e.type === 'click').length;
  const sessionCount    = sessions.length;
  const convertedCount  = sessions.filter(s => s.converted).length;
  const conversionRate  = sessionCount > 0
    ? ((convertedCount / sessionCount) * 100).toFixed(1)
    : '0.0';

  return {
    pageviews,
    clicks,
    sessions:       sessionCount,
    conversions:    conversions.length,
    conversionRate, // e.g. "4.2"
  };
}

// ── Conversion goals ──────────────────────────────────────────────────────────

export async function getGoals(clientId) {
  const { data, error } = await supabase
    .from('conversion_goals')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  return { data, error };
}

export async function createGoal({ clientId, name, type, urlPattern, cssSelector, matchType }) {
  const { data, error } = await supabase
    .from('conversion_goals')
    .insert({
      client_id:    clientId,
      name,
      type,
      url_pattern:  urlPattern  || null,
      css_selector: cssSelector || null,
      match_type:   matchType   || 'exact',
      active:       true,
    })
    .select()
    .single();
  return { data, error };
}

export async function toggleGoal(id, active) {
  const { data, error } = await supabase
    .from('conversion_goals')
    .update({ active })
    .eq('id', id)
    .select()
    .single();
  return { data, error };
}

export async function updateGoal(id, { name, type, cssSelector, urlPattern, matchType, active }) {
  const { data, error } = await supabase
    .from('conversion_goals')
    .update({
      name,
      type,
      css_selector: cssSelector ?? null,
      url_pattern:  urlPattern  ?? null,
      match_type:   matchType   ?? 'exact',
      active,
    })
    .eq('id', id)
    .select()
    .single();
  return { data, error };
}

export async function deleteGoal(id) {
  const { error } = await supabase.from('conversion_goals').delete().eq('id', id);
  return { error };
}

export async function getConversionEvents(clientId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data, error } = await supabase
    .from('conversion_events')
    .select(`
      id,
      ts,
      url,
      device_type,
      utm_source,
      utm_medium,
      visitor_id,
      session_id,
      goal_id,
      conversion_goals ( name )
    `)
    .eq('client_id', clientId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200);

  return { data: data || [], error };
}

export async function deleteConversionEvent(id) {
  const { error } = await supabase
    .from('conversion_events')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[delete] conversion_events error:', error.message);
    throw error; // surface the error so UI can handle it
  }
  return { success: true };
}