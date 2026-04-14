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
  const [versionRes, fieldsRes, summaryRes, submitTimesRes] = await Promise.all([
    supabase
      .from('form_versions')
      .select('fields, form_id')
      .eq('id', formVersionId)
      .single(),
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
    // Fetch total_form_time_ms from submitted sessions for avg completion time
    supabase
      .from('events')
      .select('total_form_time_ms')
      .eq('form_version_id', formVersionId)
      .eq('type', 'form_submit')
      .not('total_form_time_ms', 'is', null),
  ]);

  const summary = summaryRes.data || { sessions_started: 0, sessions_submitted: 0, sessions_abandoned: 0 };
  const statsRows = fieldsRes.data || [];
  const canonicalFields = versionRes.data?.fields || [];
  const formId = versionRes.data?.form_id;

  // Avg completion time from form_submit events
  const submitTimes = (submitTimesRes.data || []).map(r => r.total_form_time_ms).filter(Boolean);
  const avgCompletionMs = submitTimes.length > 0
    ? Math.round(submitTimes.reduce((a, b) => a + b, 0) / submitTimes.length)
    : null;

  // If this form has no submit actions configured, we cannot reliably detect
  // submissions — zero them out so the funnel doesn't show misleading data.
  if (formId) {
    const { data: actions } = await supabase
      .from('form_submit_actions')
      .select('id')
      .eq('form_id', formId)
      .eq('active', true)
      .limit(1);
    if (!actions || actions.length === 0) {
      summary.sessions_submitted = 0;
      summary.sessions_abandoned = summary.sessions_started;
    }
  }

  // Build a lookup of stats by field name
  const statsMap = {};
  statsRows.forEach(r => { statsMap[r.field_name] = r; });

  // If we have canonical fields from the version snapshot, use them as the
  // authoritative ordered list and merge stats in. This ensures ALL fields
  // appear in the funnel even if nobody has touched them yet.
  let fields;
  if (canonicalFields.length > 0) {
    fields = canonicalFields.map(f => ({
      field_name:       f.name || f.field_name || '',
      field_type:       f.type || f.field_type || '',
      field_index:      f.field_index ?? f.index ?? null,
      required:         f.required ?? false,
      sessions_touched: statsMap[f.name || f.field_name]?.sessions_touched ?? 0,
      avg_fill_seconds: statsMap[f.name || f.field_name]?.avg_fill_seconds ?? null,
    }));
  } else {
    fields = statsRows.map(r => ({ ...r, required: false }));
  }

  return { fields, summary, avgCompletionMs };
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
  // Include total_form_time_ms from form_submit events for avg fill time display
  const { data: fieldEvents } = await supabase
    .from('events')
    .select('session_id, type, field_name, total_form_time_ms, ts, url')
    .eq('form_version_id', formVersionId)
    .in('type', ['form_field', 'form_submit'])
    .order('ts', { ascending: false });

  if (!fieldEvents || fieldEvents.length === 0) return [];

  const sessionIds = [...new Set(fieldEvents.map(e => e.session_id))].slice(0, limit);

  const { data: sessions } = await supabase
    .from('sessions')
    .select('session_id, visitor_id, device_type, utm_source, utm_medium, country, created_at, converted')
    .in('session_id', sessionIds);

  const submitSet = new Set();
  const fieldSets = {};
  const sessionUrls = {};
  const formTimes = {}; // session_id -> total_form_time_ms from submit event

  fieldEvents.forEach(ev => {
    if (!sessionUrls[ev.session_id]) sessionUrls[ev.session_id] = ev.url;
    if (ev.type === 'form_submit') {
      submitSet.add(ev.session_id);
      if (ev.total_form_time_ms) formTimes[ev.session_id] = ev.total_form_time_ms;
    }
    if (ev.type === 'form_field' && ev.field_name) {
      if (!fieldSets[ev.session_id]) fieldSets[ev.session_id] = new Set();
      fieldSets[ev.session_id].add(ev.field_name);
    }
  });

  return sessionIds.map(sid => {
    const session = (sessions || []).find(s => s.session_id === sid) || {};
    return {
      session_id:       sid,
      visitor_id:       session.visitor_id,
      device_type:      session.device_type,
      utm_source:       session.utm_source,
      country:          session.country,
      created_at:       session.created_at,
      url:              sessionUrls[sid],
      fields_filled:    fieldSets[sid]?.size ?? 0,
      total_form_time_ms: formTimes[sid] ?? null,
      submitted:        submitSet.has(sid),
      status:           submitSet.has(sid) ? 'submitted' : 'abandoned',
    };
  });
}

export async function deleteFormSession(clientId, sessionId) {
  // Delete all form-related events for this session scoped to this client.
  // We do NOT filter by form_version_id here because form_scan events are
  // written before the version is resolved and may have form_version_id = null,
  // which would cause those rows to be missed and the session to re-appear.
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('client_id', clientId)
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