import React, { useState, useEffect, useCallback } from 'react';
import { getFormDefinitions, createFormDefinition, deleteFormDefinition, getFormVersions, getFormFunnel, getFieldTransitionTimes } from '../lib/forms';

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
          <p className="section-sub">Field-level funnel, drop-off, and time analysis</p>
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
                <button
                  className="form-list-delete"
                  onClick={e => { e.stopPropagation(); handleDelete(form.id); }}
                >✕</button>
              </div>
            ))}
          </div>
          <div className="forms-detail">
            {activeForm
              ? <FormDetail form={activeForm} />
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
  const [name, setName]           = useState('');
  const [selector, setSelector]   = useState('');
  const [urlPattern, setUrlPattern] = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  async function handleSubmit(e) {
    e.preventDefault(); setError('');
    if (!name.trim())     { setError('Name is required'); return; }
    if (!selector.trim()) { setError('CSS selector is required'); return; }
    setLoading(true);
    const { error } = await createFormDefinition({
      clientId, name: name.trim(),
      selector: selector.trim(),
      urlPattern: urlPattern.trim() || null,
    });
    if (error) { setError(error.message); setLoading(false); return; }
    onCreated();
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h3>Add form</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}

          <div className="field">
            <label className="field-label">Form name</label>
            <input className="field-input" value={name} onChange={e => setName(e.target.value)} placeholder="Contact form, Booking form, Sign up" required autoFocus />
          </div>

          <div className="field">
            <label className="field-label">CSS selector</label>
            <input className="field-input mono" value={selector} onChange={e => setSelector(e.target.value)} placeholder="#contact-form, form.booking, [data-form=signup]" required />
            <span className="field-hint">
              This must match the <code>id</code>, <code>name</code>, or attribute of the <code>&lt;form&gt;</code> element.
              The tracker uses this to identify which form events belong to.
            </span>
          </div>

          <div className="field">
            <label className="field-label">URL pattern <span className="field-optional">(optional)</span></label>
            <input className="field-input mono" value={urlPattern} onChange={e => setUrlPattern(e.target.value)} placeholder="/contact, /book" />
            <span className="field-hint">Only track this form on pages matching this URL. Leave blank to track on all pages.</span>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Save form'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Form detail ──────────────────────────────────────────────────────────────

function FormDetail({ form }) {
  const [versions, setVersions]         = useState([]);
  const [activeVersionId, setActiveVersionId] = useState(null);
  const [funnel, setFunnel]             = useState(null);
  const [transitions, setTransitions]   = useState([]);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    setLoading(true);
    getFormVersions(form.id).then(({ data }) => {
      setVersions(data);
      if (data.length > 0) {
        const current = data.find(v => v.is_current) || data[0];
        setActiveVersionId(current.id);
      } else {
        setLoading(false);
      }
    });
  }, [form.id]);

  useEffect(() => {
    if (!activeVersionId) return;
    setLoading(true);
    Promise.all([
      getFormFunnel(activeVersionId),
      getFieldTransitionTimes(activeVersionId),
    ]).then(([funnelData, transitionData]) => {
      setFunnel(funnelData);
      setTransitions(transitionData);
      setLoading(false);
    });
  }, [activeVersionId]);

  const activeVersion = versions.find(v => v.id === activeVersionId);

  if (versions.length === 0 && !loading) {
    return (
      <div className="empty-state">
        <div className="empty-icon">◎</div>
        <h3>No data yet for "{form.name}"</h3>
        <p>Once visitors interact with <code>{form.selector}</code> the funnel will appear here.</p>
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
        {versions.length > 0 && (
          <div className="version-selector">
            <span className="version-label">Version</span>
            <select
              className="version-select"
              value={activeVersionId || ''}
              onChange={e => setActiveVersionId(e.target.value)}
            >
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

      {activeVersion && !activeVersion.is_current && (
  <div className="version-archive-notice">
    Viewing archived version v{activeVersion.version_number} — field structure changed on {new Date(activeVersion.last_seen).toLocaleDateString()}
  </div>
)}

      {loading ? (
        <div className="loading-state"><div className="spinner lg" /></div>
      ) : funnel ? (
        <FormFunnel funnel={funnel} transitions={transitions} version={activeVersion} />
      ) : null}
    </div>
  );
}

// ─── Form funnel visualisation ────────────────────────────────────────────────

function FormFunnel({ funnel, transitions, version }) {
  const { fields, summary } = funnel;
  const started   = summary.sessions_started   || 0;
  const submitted = summary.sessions_submitted || 0;
  const abandoned = summary.sessions_abandoned || 0;
  const successRate  = started > 0 ? (submitted / started * 100).toFixed(1) : '0.0';
  const abandonRate  = started > 0 ? (abandoned / started * 100).toFixed(1) : '0.0';

  // Build transition map for quick lookup
  const transitionMap = {};
  transitions.forEach(t => { transitionMap[t.transition] = t.medianMs; });

  // The top of the funnel is sessions_started
  // Each field step shows how many sessions touched it
  const maxTouched = Math.max(...fields.map(f => Number(f.sessions_touched)), started, 1);

  return (
    <div className="form-funnel">
      {/* Summary strip */}
      <div className="funnel-summary">
        <div className="funnel-stat">
          <span className="funnel-stat-val">{started}</span>
          <span className="funnel-stat-label">Started</span>
        </div>
        <div className="funnel-stat">
          <span className="funnel-stat-val green">{submitted}</span>
          <span className="funnel-stat-label">Submitted</span>
        </div>
        <div className="funnel-stat">
          <span className="funnel-stat-val red">{abandoned}</span>
          <span className="funnel-stat-label">Abandoned</span>
        </div>
        <div className="funnel-stat">
          <span className="funnel-stat-val green">{successRate}%</span>
          <span className="funnel-stat-label">Completion rate</span>
        </div>
        <div className="funnel-stat">
          <span className="funnel-stat-val red">{abandonRate}%</span>
          <span className="funnel-stat-label">Abandonment rate</span>
        </div>
      </div>

      {fields.length === 0 ? (
        <div className="empty-state" style={{ padding: '40px 0' }}>
          <p>No field interaction data for this version yet.</p>
        </div>
      ) : (
        <div className="funnel-steps">
          {/* Entry row */}
          <FunnelStep
            label="Form reached"
            count={started}
            maxCount={maxTouched}
            pct={100}
            fillColor="var(--accent)"
            isEntry
          />

          {fields.map((field, i) => {
            const prevField  = i > 0 ? fields[i - 1] : null;
            const touched    = Number(field.sessions_touched);
            const pct        = started > 0 ? (touched / started * 100) : 0;
            const dropPct    = prevField
              ? (((Number(prevField.sessions_touched) - touched) / Number(prevField.sessions_touched)) * 100)
              : ((started - touched) / started * 100);

            // Transition time from previous field
            const transKey   = prevField ? `${prevField.field_name}→${field.field_name}` : null;
            const gapMs      = transKey ? transitionMap[transKey] : null;

            return (
              <React.Fragment key={field.field_name || i}>
                {/* Gap indicator between steps */}
                {i > 0 && (
                  <div className="funnel-gap">
                    <div className="funnel-gap-line" />
                    <div className="funnel-gap-info">
                      {dropPct > 0 && (
                        <span className="funnel-drop">
                          −{dropPct.toFixed(1)}% drop
                        </span>
                      )}
                      {gapMs != null && (
                        <span className="funnel-time">
                          {fmtMs(gapMs)} median
                        </span>
                      )}
                    </div>
                    <div className="funnel-gap-line" />
                  </div>
                )}
                <FunnelStep
                  label={field.field_name || `Field ${i + 1}`}
                  sublabel={field.field_type}
                  count={touched}
                  maxCount={maxTouched}
                  pct={pct}
                  avgTime={field.avg_fill_seconds}
                  fillColor={pct < 50 ? 'var(--red)' : pct < 75 ? 'var(--amber)' : 'var(--accent)'}
                />
              </React.Fragment>
            );
          })}

          {/* Exit: submitted */}
          {submitted > 0 && (
            <>
              <div className="funnel-gap">
                <div className="funnel-gap-line" />
                <div className="funnel-gap-info">
                  {fields.length > 0 && (
                    <span className="funnel-drop">
                      −{((Number(fields[fields.length-1]?.sessions_touched || started) - submitted) / started * 100).toFixed(1)}% drop
                    </span>
                  )}
                </div>
                <div className="funnel-gap-line" />
              </div>
              <FunnelStep
                label="Submitted"
                count={submitted}
                maxCount={maxTouched}
                pct={started > 0 ? submitted / started * 100 : 0}
                fillColor="var(--green)"
                isExit
              />
            </>
          )}
        </div>
      )}

      {/* Version field list */}
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
        <div
          className="funnel-step-bar"
          style={{ width: `${barWidth}%`, background: fillColor }}
        />
      </div>
      <div className="funnel-step-meta">
        <span className="funnel-step-count">{count}</span>
        <span className="funnel-step-pct">{pct.toFixed(1)}%</span>
        {avgTime != null && <span className="funnel-step-time">{avgTime}s avg</span>}
      </div>
    </div>
  );
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function fmtMs(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
