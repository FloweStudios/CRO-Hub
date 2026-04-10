import React, { useState, useEffect, useCallback } from 'react';
import {
  getFormDefinitions, createFormDefinition, deleteFormDefinition,
  getFormVersions, getFormFunnel, getFieldTransitionTimes,
  getFormSessions, deleteFormSession,
  getFormSubmitActions, createFormSubmitAction, deleteFormSubmitAction, toggleFormSubmitAction,
} from '../lib/forms';

export default function FormsPage({ partner }) {
  const [forms, setForms]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showAdd, setShowAdd]       = useState(false);
  const [activeForm, setActiveForm] = useState(null);

  const loadForms = useCallback(async () => {
    setLoading(true);
    const { data } = await getFormDefinitions(partner.id);
    setForms(data);
    setLoading(false);
  }, [partner.id]);

  useEffect(() => { loadForms(); }, [loadForms]);

  async function handleDelete(id) {
    await deleteFormDefinition(id);
    if (activeForm?.id === id) setActiveForm(null);
    loadForms();
  }

  return (
    <div className="forms-page">
      <div className="section-header">
        <div>
          <h3 className="section-title">Form analytics</h3>
          <p className="section-sub">Field-level funnel, sessions, and submission actions</p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add form</button>
      </div>

      {showAdd && (
        <AddFormModal
          clientId={partner.id}
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); loadForms(); }}
        />
      )}

      {loading ? (
        <div className="loading-state"><div className="spinner lg" /></div>
      ) : forms.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◈</div>
          <h3>No forms tracked yet</h3>
          <p>Add a form by its CSS selector to start tracking field-level analytics.</p>
        </div>
      ) : (
        <div className="forms-layout">
          <div className="forms-sidebar">
            {forms.map(form => (
              <div
                key={form.id}
                className={`form-list-item ${activeForm?.id === form.id ? 'active' : ''}`}
                onClick={() => setActiveForm(form)}
              >
                <div className="form-list-name">{form.name}</div>
                <div className="form-list-selector mono-sm">{form.selector}</div>
                <button className="form-list-delete" onClick={e => { e.stopPropagation(); handleDelete(form.id); }}>✕</button>
              </div>
            ))}
          </div>
          <div className="forms-detail">
            {activeForm
              ? <FormDetail form={activeForm} clientId={partner.id} />
              : <div className="forms-pick">Select a form to view analytics</div>
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add form modal ───────────────────────────────────────────────────────────

function AddFormModal({ clientId, onClose, onCreated }) {
  const [name, setName]               = useState('');
  const [selector, setSelector]       = useState('');
  const [urlPattern, setUrlPattern]   = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  async function handleSubmit(e) {
    e.preventDefault(); setError('');
    if (!name.trim())     { setError('Name is required'); return; }
    if (!selector.trim()) { setError('CSS selector is required'); return; }
    setLoading(true);
    const { error } = await createFormDefinition({ clientId, name: name.trim(), selector: selector.trim(), urlPattern: urlPattern.trim() || null });
    if (error) { setError(error.message); setLoading(false); return; }
    onCreated();
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header"><h3>Add form</h3><button className="modal-close" onClick={onClose}>✕</button></div>
        <form onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}
          <div className="field">
            <label className="field-label">Form name</label>
            <input className="field-input" value={name} onChange={e => setName(e.target.value)} placeholder="Contact form, Booking form" required autoFocus />
          </div>
          <div className="field">
            <label className="field-label">CSS selector</label>
            <input className="field-input mono" value={selector} onChange={e => setSelector(e.target.value)} placeholder="#contact-form, .booking-form, [data-form=signup]" required />
            <span className="field-hint">Matches the container element — doesn't have to be a &lt;form&gt; tag.</span>
          </div>
          <div className="field">
            <label className="field-label">URL pattern <span className="field-optional">(optional)</span></label>
            <input className="field-input mono" value={urlPattern} onChange={e => setUrlPattern(e.target.value)} placeholder="/contact" />
            <span className="field-hint">Only track on pages matching this URL. Leave blank for all pages.</span>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>{loading ? <span className="spinner" /> : 'Save form'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Form detail ──────────────────────────────────────────────────────────────

function FormDetail({ form, clientId }) {
  const [versions, setVersions]           = useState([]);
  const [activeVersionId, setActiveVersionId] = useState(null);
  const [tab, setTab]                     = useState('funnel');
  const [loading, setLoading]             = useState(true);

  useEffect(() => {
    setLoading(true);
    getFormVersions(form.id).then(({ data }) => {
      setVersions(data);
      if (data.length > 0) {
        const current = data.find(v => v.is_current) || data[0];
        setActiveVersionId(current.id);
      }
      setLoading(false);
    });
  }, [form.id]);

  const activeVersion = versions.find(v => v.id === activeVersionId);

  if (loading) return <div className="loading-state"><div className="spinner lg" /></div>;

  if (versions.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">◎</div>
        <h3>No data yet for "{form.name}"</h3>
        <p>Once visitors interact with <code>{form.selector}</code> the analytics will appear here.</p>
      </div>
    );
  }

  return (
    <div className="form-detail">
      <div className="form-detail-header">
        <div>
          <span className="form-detail-name">{form.name}</span>
          <span className="mono-sm" style={{ marginLeft: 10 }}>{form.selector}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {versions.length > 0 && (
            <div className="version-selector">
              <span className="version-label">Version</span>
              <select className="version-select" value={activeVersionId || ''} onChange={e => setActiveVersionId(e.target.value)}>
                {versions.map(v => (
                  <option key={v.id} value={v.id}>
                    v{v.version_number} {v.is_current ? '(current)' : ''}
                    {' — '}{new Date(v.first_seen).toLocaleDateString()}
                    {!v.is_current && ` → ${new Date(v.last_seen).toLocaleDateString()}`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {activeVersion && !activeVersion.is_current && (
        <div className="version-archive-notice">
          Viewing archived version v{activeVersion.version_number} — field structure changed on {new Date(activeVersion.last_seen).toLocaleDateString()}
        </div>
      )}

      {/* Tabs */}
      <div className="goals-tabs">
        <button className={`goals-tab ${tab === 'funnel' ? 'active' : ''}`} onClick={() => setTab('funnel')}>Funnel</button>
        <button className={`goals-tab ${tab === 'sessions' ? 'active' : ''}`} onClick={() => setTab('sessions')}>Sessions</button>
        <button className={`goals-tab ${tab === 'actions' ? 'active' : ''}`} onClick={() => setTab('actions')}>Submit actions</button>
      </div>

      {tab === 'funnel' && activeVersionId && (
        <FunnelTab formVersionId={activeVersionId} version={activeVersion} />
      )}
      {tab === 'sessions' && activeVersionId && (
        <SessionsTab formVersionId={activeVersionId} />
      )}
      {tab === 'actions' && (
        <ActionsTab form={form} clientId={clientId} />
      )}
    </div>
  );
}

// ─── Funnel tab ───────────────────────────────────────────────────────────────

function FunnelTab({ formVersionId, version }) {
  const [funnel, setFunnel]           = useState(null);
  const [transitions, setTransitions] = useState([]);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([getFormFunnel(formVersionId), getFieldTransitionTimes(formVersionId)])
      .then(([f, t]) => { setFunnel(f); setTransitions(t); setLoading(false); });
  }, [formVersionId]);

  if (loading) return <div className="loading-state"><div className="spinner lg" /></div>;
  if (!funnel)  return null;

  return <FormFunnel funnel={funnel} transitions={transitions} version={version} />;
}

// ─── Sessions tab ─────────────────────────────────────────────────────────────

function SessionsTab({ formVersionId }) {
  const [sessions, setSessions]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    const data = await getFormSessions(formVersionId);
    setSessions(data);
    setLoading(false);
  }, [formVersionId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await deleteFormSession(confirmDelete);
      await loadSessions();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
    setConfirmDelete(null);
  }

  if (loading) return <div className="loading-state"><div className="spinner lg" /></div>;

  return (
    <div>
      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Delete session?</h3><button className="modal-close" onClick={() => setConfirmDelete(null)}>✕</button></div>
            <p style={{ color: 'var(--text2)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: 8 }}>
              This will permanently remove all form interaction events for this session. This cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={handleDelete}>Yes, delete</button>
            </div>
          </div>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◎</div>
          <h3>No sessions yet</h3>
          <p>Sessions will appear here once visitors interact with this form.</p>
        </div>
      ) : (
        <div className="conv-events-table">
          <div className="form-sessions-head">
            <span>Status</span>
            <span>Fields filled</span>
            <span>Device</span>
            <span>Source</span>
            <span>Country</span>
            <span>Date</span>
            <span></span>
          </div>
          {sessions.map(s => (
            <div key={s.session_id} className="form-sessions-row">
              <span>
                <span className={`status-pill ${s.status}`}>
                  {s.status === 'submitted' ? '✓ Submitted' : '✗ Abandoned'}
                </span>
              </span>
              <span className="mono-sm">{s.fields_filled}</span>
              <span>
                {s.device_type && <span className={`device-pill device-${s.device_type}`}>{s.device_type}</span>}
              </span>
              <span className="mono-sm">{s.utm_source || 'direct'}</span>
              <span className="mono-sm">{s.country || '—'}</span>
              <span className="ce-date">{s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</span>
              <span>
                <button className="btn-icon-danger" onClick={() => setConfirmDelete(s.session_id)}>✕</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Submit actions tab ───────────────────────────────────────────────────────

function ActionsTab({ form, clientId }) {
  const [actions, setActions]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const loadActions = useCallback(async () => {
    setLoading(true);
    const { data } = await getFormSubmitActions(form.id);
    setActions(data);
    setLoading(false);
  }, [form.id]);

  useEffect(() => { loadActions(); }, [loadActions]);

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await deleteFormSubmitAction(confirmDelete.id);
      loadActions();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
    setConfirmDelete(null);
  }

  async function handleToggle(id, active) {
    await toggleFormSubmitAction(id, active);
    loadActions();
  }

  const typeLabels = { click: 'Click', click_url: 'Click URL', element_visible: 'Element visible', page_load: 'Page load' };

  return (
    <div>
      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Delete action?</h3><button className="modal-close" onClick={() => setConfirmDelete(null)}>✕</button></div>
            <p style={{ color: 'var(--text2)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: 8 }}>
              Delete <strong style={{ color: 'var(--text)' }}>{confirmDelete.name}</strong>? This will stop detecting this submission trigger.
            </p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={handleDelete}>Yes, delete</button>
            </div>
          </div>
        </div>
      )}

      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: '0.88rem', color: 'var(--text2)', lineHeight: 1.6 }}>
            Define what counts as a form submission for <strong style={{ color: 'var(--text)' }}>{form.name}</strong>. Fires a <code>form_submit</code> event when triggered. Counts as a conversion only if a matching conversion goal is set up.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add action</button>
      </div>

      {showAdd && (
        <AddActionModal
          formId={form.id}
          clientId={clientId}
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); loadActions(); }}
        />
      )}

      {loading ? <div className="loading-state"><div className="spinner lg" /></div>
        : actions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">◎</div>
            <h3>No submission actions</h3>
            <p>Add an action to define what counts as a form submission — a button click, page redirect, element appearing, etc.</p>
          </div>
        ) : (
          <div className="goals-list">
            {actions.map(action => (
              <div key={action.id} className={`goal-row ${!action.active ? 'inactive' : ''}`}>
                <div className="goal-info">
                  <span className="goal-name">{action.name}</span>
                  <span className={`goal-type-pill type-${action.type}`}>{typeLabels[action.type] || action.type}</span>
                  <span className="goal-detail mono-sm">{action.css_selector || action.url_pattern || '—'}</span>
                </div>
                <div className="goal-actions">
                  <button className={`toggle-btn ${action.active ? 'on' : 'off'}`} onClick={() => handleToggle(action.id, !action.active)}>
                    {action.active ? 'Active' : 'Paused'}
                  </button>
                  <button className="btn-icon-danger" onClick={() => setConfirmDelete(action)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ─── Add action modal ─────────────────────────────────────────────────────────

function AddActionModal({ formId, clientId, onClose, onCreated }) {
  const [name, setName]               = useState('');
  const [type, setType]               = useState('click');
  const [selector, setSelector]       = useState('');
  const [urlPattern, setUrlPattern]   = useState('');
  const [clickUrlPattern, setClickUrlPattern] = useState('');
  const [matchType, setMatchType]     = useState('contains');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  async function handleSubmit(e) {
    e.preventDefault(); setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    if ((type === 'click' || type === 'element_visible') && !selector.trim()) { setError('CSS selector is required'); return; }
    if (type === 'click_url' && !clickUrlPattern.trim()) { setError('URL pattern is required'); return; }
    if (type === 'page_load' && !urlPattern.trim()) { setError('URL pattern is required'); return; }

    setLoading(true);
    const { error } = await createFormSubmitAction({
      formId, clientId,
      name: name.trim(),
      type,
      cssSelector:  type === 'click' || type === 'element_visible' ? selector.trim() : type === 'click_url' ? 'a' : null,
      urlPattern:   type === 'click_url' ? clickUrlPattern.trim() : type === 'page_load' ? urlPattern.trim() : null,
      matchType:    type === 'click_url' ? matchType : type === 'page_load' ? matchType : 'exact',
    });
    if (error) { setError(error.message); setLoading(false); return; }
    onCreated();
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header"><h3>Add submission action</h3><button className="modal-close" onClick={onClose}>✕</button></div>
        <form onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}

          <div className="field">
            <label className="field-label">Action name</label>
            <input className="field-input" value={name} onChange={e => setName(e.target.value)} placeholder="Submit button click, Thank you page, Confirmation banner" required autoFocus />
          </div>

          <div className="field">
            <label className="field-label">Trigger type</label>
            <select className="field-input" value={type} onChange={e => setType(e.target.value)}>
              <option value="click">Click — user clicks an element</option>
              <option value="click_url">Click URL — user clicks a link matching a URL pattern</option>
              <option value="element_visible">Element visible — confirmation element appears</option>
              <option value="page_load">Page load — thank you / confirmation page loads</option>
            </select>
          </div>

          {(type === 'click' || type === 'element_visible') && (
            <div className="field">
              <label className="field-label">CSS selector</label>
              <input className="field-input mono" value={selector} onChange={e => setSelector(e.target.value)} placeholder="button[type=submit], .submit-btn, #send-message" />
              <span className="field-hint">The element to watch for this trigger.</span>
            </div>
          )}

          {type === 'click_url' && (
            <>
              <div className="goal-hint-box">Use this to detect a redirect after submission — e.g. clicking a link to <code>/thank-you</code>.</div>
              <div className="field">
                <label className="field-label">Match type</label>
                <select className="field-input" value={matchType} onChange={e => setMatchType(e.target.value)}>
                  <option value="contains">Contains</option>
                  <option value="exact">Exact</option>
                  <option value="starts_with">Starts with</option>
                  <option value="regex">Regex</option>
                </select>
              </div>
              <div className="field">
                <label className="field-label">URL pattern</label>
                <input className="field-input mono" value={clickUrlPattern} onChange={e => setClickUrlPattern(e.target.value)} placeholder="/thank-you, /confirmation" />
              </div>
            </>
          )}

          {type === 'page_load' && (
            <>
              <div className="field">
                <label className="field-label">URL pattern</label>
                <input className="field-input mono" value={urlPattern} onChange={e => setUrlPattern(e.target.value)} placeholder="/thank-you" />
              </div>
              <div className="field">
                <label className="field-label">Match type</label>
                <select className="field-input" value={matchType} onChange={e => setMatchType(e.target.value)}>
                  <option value="exact">Exact</option>
                  <option value="contains">Contains</option>
                  <option value="starts_with">Starts with</option>
                  <option value="regex">Regex</option>
                </select>
              </div>
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>{loading ? <span className="spinner" /> : 'Save action'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Form funnel visualisation ────────────────────────────────────────────────

function FormFunnel({ funnel, transitions, version }) {
  const { fields, summary } = funnel;
  const started   = summary.sessions_started   || 0;
  const submitted = summary.sessions_submitted || 0;
  const abandoned = summary.sessions_abandoned || 0;
  const successRate = started > 0 ? (submitted / started * 100).toFixed(1) : '0.0';
  const abandonRate = started > 0 ? (abandoned / started * 100).toFixed(1) : '0.0';

  const transitionMap = {};
  transitions.forEach(t => { transitionMap[t.transition] = t.medianMs; });

  const maxTouched = Math.max(...fields.map(f => Number(f.sessions_touched)), started, 1);

  return (
    <div className="form-funnel">
      <div className="funnel-summary">
        <div className="funnel-stat"><span className="funnel-stat-val">{started}</span><span className="funnel-stat-label">Started</span></div>
        <div className="funnel-stat"><span className="funnel-stat-val green">{submitted}</span><span className="funnel-stat-label">Submitted</span></div>
        <div className="funnel-stat"><span className="funnel-stat-val red">{abandoned}</span><span className="funnel-stat-label">Abandoned</span></div>
        <div className="funnel-stat"><span className="funnel-stat-val green">{successRate}%</span><span className="funnel-stat-label">Completion</span></div>
        <div className="funnel-stat"><span className="funnel-stat-val red">{abandonRate}%</span><span className="funnel-stat-label">Abandonment</span></div>
      </div>

      {fields.length === 0 ? (
        <div className="empty-state" style={{ padding: '40px 0' }}><p>No field interaction data for this version yet.</p></div>
      ) : (
        <div className="funnel-steps">
          <FunnelStep label="Form reached" count={started} maxCount={maxTouched} pct={100} fillColor="var(--blue-1)" isEntry />
          {fields.map((field, i) => {
            const prevField = i > 0 ? fields[i - 1] : null;
            const touched   = Number(field.sessions_touched);
            const pct       = started > 0 ? (touched / started * 100) : 0;
            const dropPct   = prevField
              ? ((Number(prevField.sessions_touched) - touched) / Number(prevField.sessions_touched) * 100)
              : ((started - touched) / started * 100);
            const transKey  = prevField ? `${prevField.field_name}→${field.field_name}` : null;
            const gapMs     = transKey ? transitionMap[transKey] : null;

            return (
              <React.Fragment key={field.field_name || i}>
                {i > 0 && (
                  <div className="funnel-gap">
                    <div className="funnel-gap-line" />
                    <div className="funnel-gap-info">
                      {dropPct > 0 && <span className="funnel-drop">−{dropPct.toFixed(1)}% drop</span>}
                      {gapMs != null && <span className="funnel-time">{fmtMs(gapMs)} median</span>}
                    </div>
                    <div className="funnel-gap-line" />
                  </div>
                )}
                <FunnelStep
                  label={field.field_name || `Field ${i + 1}`}
                  sublabel={field.field_type}
                  count={touched} maxCount={maxTouched} pct={pct}
                  avgTime={field.avg_fill_seconds}
                  fillColor={pct < 50 ? 'var(--red)' : pct < 75 ? 'var(--amber)' : 'var(--accent-1)'}
                />
              </React.Fragment>
            );
          })}

          {submitted > 0 && (
            <>
              <div className="funnel-gap">
                <div className="funnel-gap-line" />
                <div className="funnel-gap-info">
                  {fields.length > 0 && (
                    <span className="funnel-drop">
                      −{((Number(fields[fields.length - 1]?.sessions_touched || started) - submitted) / started * 100).toFixed(1)}% drop
                    </span>
                  )}
                </div>
                <div className="funnel-gap-line" />
              </div>
              <FunnelStep label="Submitted" count={submitted} maxCount={maxTouched} pct={started > 0 ? submitted / started * 100 : 0} fillColor="var(--green)" isExit />
            </>
          )}
        </div>
      )}

      {version?.fields && (
        <div className="version-fields">
          <div className="version-fields-title">Fields in this version</div>
          <div className="version-fields-list">
            {version.fields.map((f, i) => (
              <span key={i} className="version-field-tag">
                {i + 1}. {f.name || '?'} <span className="field-type-dim">{f.type}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FunnelStep({ label, sublabel, count, maxCount, pct, avgTime, fillColor, isEntry, isExit }) {
  const barWidth = maxCount > 0 ? (count / maxCount * 100) : 0;
  return (
    <div className={`funnel-step ${isEntry ? 'step-entry' : ''} ${isExit ? 'step-exit' : ''}`}>
      <div className="funnel-step-label">
        <span className="funnel-field-name">{label}</span>
        {sublabel && <span className="funnel-field-type">{sublabel}</span>}
      </div>
      <div className="funnel-step-bar-wrap">
        <div className="funnel-step-bar" style={{ width: `${barWidth}%`, background: fillColor }} />
      </div>
      <div className="funnel-step-meta">
        <span className="funnel-step-count">{count}</span>
        <span className="funnel-step-pct">{pct.toFixed(1)}%</span>
        {avgTime != null && <span className="funnel-step-time">{avgTime}s avg</span>}
      </div>
    </div>
  );
}

function fmtMs(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
