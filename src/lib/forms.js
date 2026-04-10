import { supabase } from './supabase';

// ── Form definitions ──────────────────────────────────────────────────────────

export async function getFormDefinitions(clientId) {
  const { data, error } = await supabase
    .from('form_definitions')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function createFormDefinition({ clientId, name, selector, urlPattern }) {
  const { data, error } = await supabase
    .from('form_definitions')
    .insert({ client_id: clientId, name, selector, url_pattern: urlPattern || null })
    .select()
    .single();
  return { data, error };
}

export async function deleteFormDefinition(id) {
  const { error } = await supabase.from('form_definitions').delete().eq('id', id);
  return { error };
}

// ── Form versions ─────────────────────────────────────────────────────────────

export async function getFormVersions(formId) {
  const { data, error } = await supabase
    .from('form_versions')
    .select('*')
    .eq('form_id', formId)
    .order('version_number', { ascending: false });
  return { data: data || [], error };
}

// ── Form funnel ───────────────────────────────────────────────────────────────

export async function getFormFunnel(formVersionId) {
  const [fieldsRes, summaryRes] = await Promise.all([
    supabase
      .from('form_field_stats')
      .select('*')
      .eq('form_version_id', formVersionId)
      .order('field_index', { ascending: true, nullsFirst: false }),
    supabase
      .from('form_session_summary')
      .select('*')
      .eq('form_version_id', formVersionId)
      .single(),
  ]);
  const fields  = fieldsRes.data  || [];
  const summary = summaryRes.data || { sessions_started: 0, sessions_submitted: 0, sessions_abandoned: 0 };
  return { fields, summary };
}

// ── Field transition times ────────────────────────────────────────────────────

export async function getFieldTransitionTimes(formVersionId) {
  const { data: events } = await supabase
    .from('events')
    .select('session_id, field_name, field_index, ts')
    .eq('form_version_id', formVersionId)
    .eq('type', 'form_field')
    .order('ts', { ascending: true });

  if (!events || events.length === 0) return [];

  const sessions = {};
  events.forEach(ev => {
    if (!sessions[ev.session_id]) sessions[ev.session_id] = [];
    sessions[ev.session_id].push({ name: ev.field_name, index: ev.field_index, ts: new Date(ev.ts).getTime() });
  });

  const gapMap = {};
  Object.values(sessions).forEach(fields => {
    const sorted = fields.sort((a, b) => a.ts - b.ts);
    for (let i = 0; i < sorted.length - 1; i++) {
      const key = `${sorted[i].name}→${sorted[i + 1].name}`;
      const gap = sorted[i + 1].ts - sorted[i].ts;
      if (gap > 0 && gap < 300000) {
        if (!gapMap[key]) gapMap[key] = [];
        gapMap[key].push(gap);
      }
    }
  });

  return Object.entries(gapMap).map(([transition, gaps]) => ({
    transition,
    medianMs: gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)],
    count: gaps.length,
  }));
}

// ── Form sessions ─────────────────────────────────────────────────────────────

export async function getFormSessions(formVersionId, limit = 100) {
  // Get all sessions that interacted with this form version
  const { data: fieldEvents } = await supabase
    .from('events')
    .select('session_id, ts, url')
    .eq('form_version_id', formVersionId)
    .in('type', ['form_field', 'form_submit'])
    .order('ts', { ascending: false });

  if (!fieldEvents || fieldEvents.length === 0) return [];

  // Get unique sessions with metadata
  const sessionIds = [...new Set(fieldEvents.map(e => e.session_id))].slice(0, limit);

  const { data: sessions } = await supabase
    .from('sessions')
    .select('session_id, visitor_id, device_type, utm_source, utm_medium, country, created_at, converted')
    .in('session_id', sessionIds);

  // Get submit events to know which sessions completed
  const { data: submits } = await supabase
    .from('events')
    .select('session_id')
    .eq('form_version_id', formVersionId)
    .eq('type', 'form_submit')
    .in('session_id', sessionIds);

  const submitSet = new Set((submits || []).map(s => s.session_id));

  // Get field counts per session
  const fieldCounts = {};
  fieldEvents.forEach(ev => {
    if (ev.type === 'form_field') {
      fieldCounts[ev.session_id] = (fieldCounts[ev.session_id] || 0) + 1;
    }
  });

  // Get first URL per session
  const sessionUrls = {};
  fieldEvents.forEach(ev => {
    if (!sessionUrls[ev.session_id]) sessionUrls[ev.session_id] = ev.url;
  });

  return sessionIds.map(sid => {
    const session = (sessions || []).find(s => s.session_id === sid) || {};
    return {
      session_id:   sid,
      visitor_id:   session.visitor_id,
      device_type:  session.device_type,
      utm_source:   session.utm_source,
      country:      session.country,
      created_at:   session.created_at,
      url:          sessionUrls[sid],
      fields_filled: fieldCounts[sid] || 0,
      submitted:    submitSet.has(sid),
      status:       submitSet.has(sid) ? 'submitted' : 'abandoned',
    };
  });
}

export async function deleteFormSession(sessionId) {
  // Delete all events for this session related to this form
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('session_id', sessionId)
    .in('type', ['form_field', 'form_submit', 'form_scan']);

  if (error) throw error;
  return { success: true };
}

// ── Form submit actions ───────────────────────────────────────────────────────

export async function getFormSubmitActions(formId) {
  const { data, error } = await supabase
    .from('form_submit_actions')
    .select('*')
    .eq('form_id', formId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function createFormSubmitAction({ formId, clientId, name, type, cssSelector, urlPattern, matchType }) {
  const { data, error } = await supabase
    .from('form_submit_actions')
    .insert({
      form_id:      formId,
      client_id:    clientId,
      name,
      type,
      css_selector: cssSelector || null,
      url_pattern:  urlPattern  || null,
      match_type:   matchType   || 'exact',
      active:       true,
    })
    .select()
    .single();
  return { data, error };
}

export async function deleteFormSubmitAction(id) {
  const { error } = await supabase.from('form_submit_actions').delete().eq('id', id);
  if (error) throw error;
  return { success: true };
}

export async function toggleFormSubmitAction(id, active) {
  const { data, error } = await supabase
    .from('form_submit_actions')
    .update({ active })
    .eq('id', id)
    .select()
    .single();
  return { data, error };
}
