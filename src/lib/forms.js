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

// ── Form funnel data ──────────────────────────────────────────────────────────
// Returns everything needed to render the waterfall funnel for one version.

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

// ── Per-field time between fields ─────────────────────────────────────────────
// For a given form version, get the median time between consecutive fields
// (i.e. how long between finishing field N and starting field N+1).

export async function getFieldTransitionTimes(formVersionId) {
  const { data: events } = await supabase
    .from('events')
    .select('session_id, field_name, field_index, ts')
    .eq('form_version_id', formVersionId)
    .eq('type', 'form_field')
    .order('ts', { ascending: true });

  if (!events || events.length === 0) return [];

  // Group by session, build ordered field timeline
  const sessions = {};
  events.forEach(ev => {
    if (!sessions[ev.session_id]) sessions[ev.session_id] = [];
    sessions[ev.session_id].push({ name: ev.field_name, index: ev.field_index, ts: new Date(ev.ts).getTime() });
  });

  // Compute time gaps between consecutive fields
  const gapMap = {}; // "fieldA→fieldB" → [ms, ms, ...]

  Object.values(sessions).forEach(fields => {
    const sorted = fields.sort((a, b) => a.ts - b.ts);
    for (let i = 0; i < sorted.length - 1; i++) {
      const key = `${sorted[i].name}→${sorted[i + 1].name}`;
      const gap = sorted[i + 1].ts - sorted[i].ts;
      if (gap > 0 && gap < 300000) { // ignore gaps > 5 min (user walked away)
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
