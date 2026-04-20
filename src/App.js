import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, signIn, signOut, onAuthChange, getPartners, createPartner, updatePartner, clearPartnerData, deletePartner, getGoals, createGoal, updateGoal, deleteGoal } from './lib/supabase';
import { generateSnippet } from './lib/snippet';
import { getOverview, getDailySeries, getTopPages, getTopPagesFast, getSources, getConversionPaths, getPageInfluence, getSessionPath, getFormAnalytics, getVisitorLatency } from './lib/analytics';
import './App.css';
import FormsPage from './pages/FormsPage';
import { getConversionEvents, deleteConversionEvent } from './lib/supabase';

const INGEST_URL = process.env.REACT_APP_INGEST_URL;

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: { subscription } } = onAuthChange(s => setSession(s));
    return () => subscription.unsubscribe();
  }, []);
  if (loading) return <Splash />;
  return session ? <Dashboard session={session} /> : <Login />;
}

// ─── Splash ───────────────────────────────────────────────────────────────────

function Splash() {
  return <div className="splash"><span className="logotype">CRO<em>hub</em></span></div>;
}

// ─── Login ────────────────────────────────────────────────────────────────────

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function handleSubmit(e) {
    e.preventDefault(); setLoading(true); setError('');
    const { error } = await signIn(email, password);
    if (error) setError(error.message);
    setLoading(false);
  }
  return (
    <div className="login-root">
      <div className="login-left">
        <div className="login-grid-bg" aria-hidden="true">
          {Array.from({ length: 64 }).map((_, i) => <div key={i} className="grid-cell" />)}
        </div>
        <div className="login-brand">
          <span className="logotype">CRO<em>hub</em></span>
          <p className="login-tagline">
            Conversion intelligence<br />
            <span>for your partners.</span>
          </p>
        </div>
      </div>
      <div className="login-right">
        <form className="login-form" onSubmit={handleSubmit}>
          <h1 className="login-heading">Sign in</h1>
          <p className="login-sub">Agency access only.</p>
          {error && <div className="login-error">{error}</div>}
          <div className="field">
            <label className="field-label">Email</label>
            <input className="field-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@agency.com" required autoFocus />
          </div>
          <div className="field">
            <label className="field-label">Password</label>
            <input className="field-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          <button className="btn-primary btn-full" type="submit" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Dashboard shell ──────────────────────────────────────────────────────────

function Dashboard({ session }) {
  const [partners, setPartners] = useState([]);
  const [loadingPartners, setLoadingPartners] = useState(true);

  // Rehydrate from sessionStorage so refresh doesn't kick back to partners list
  const [view, setView] = useState(() => sessionStorage.getItem('crohub_view') || 'partners');
  const [activePartner, setActivePartner] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('crohub_partner') || 'null'); } catch { return null; }
  });
  const [activePage, setActivePage] = useState(() => sessionStorage.getItem('crohub_page') || 'overview');
  const [showCreate, setShowCreate] = useState(false);

  // Keep sessionStorage in sync
  useEffect(() => { sessionStorage.setItem('crohub_view', view); }, [view]);
  useEffect(() => { sessionStorage.setItem('crohub_page', activePage); }, [activePage]);
  useEffect(() => { sessionStorage.setItem('crohub_partner', JSON.stringify(activePartner)); }, [activePartner]);

  const loadPartners = useCallback(async () => {
    setLoadingPartners(true);
    const { data } = await getPartners();
    const fetched = data || [];
    setPartners(fetched);
    setLoadingPartners(false);

    // If we restored an activePartner from sessionStorage, refresh it from
    // the freshly-loaded list so we always have up-to-date partner data.
    setActivePartner(prev => {
      if (!prev) return null;
      return fetched.find(p => p.id === prev.id) || prev;
    });
  }, []);

  useEffect(() => { loadPartners(); }, [loadPartners]);

  function openPartner(partner) { setActivePartner(partner); setView('partner'); setActivePage('overview'); }
  function goBack() { setView('partners'); setActivePartner(null); }

  return (
    <div className="dash-root">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="logotype sm">CRO<em>hub</em></span>
        </div>
        <nav className="sidebar-nav">
          <button className={`nav-item ${view === 'partners' ? 'active' : ''}`} onClick={goBack}>
            <IconGrid /> Partners
          </button>
          {activePartner && (
            <>
              <div className="nav-section">{activePartner.name}</div>
              {[
                { id: 'overview',    label: 'Overview',        icon: <IconChart /> },
                { id: 'goals',       label: 'Conversions',      icon: <IconTarget /> },
                { id: 'pages',       label: 'Top pages',        icon: <IconPages /> },
                { id: 'sources',     label: 'Sources',          icon: <IconSource /> },
                { id: 'paths',       label: 'Conversion paths', icon: <IconPath /> },
                { id: 'forms',       label: 'Form analytics',   icon: <IconForm /> },
                { id: 'latency',     label: 'Return latency',   icon: <IconClock /> },
                { id: 'snippet',     label: 'Snippet',          icon: <IconCode /> },
                { id: 'settings',    label: 'Settings',         icon: <IconGear /> },
              ].map(item => (
                <button key={item.id} className={`nav-item nav-sub ${activePage === item.id && view === 'partner' ? 'active' : ''}`} onClick={() => { setView('partner'); setActivePage(item.id); }}>
                  {item.icon} {item.label}
                </button>
              ))}
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="user-avatar">{session.user.email[0].toUpperCase()}</div>
            <span className="user-email">{session.user.email}</span>
          </div>
          <button className="btn-ghost btn-sm" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main className="dash-main">
        {view === 'partners' && (
          <PartnersPage partners={partners} loading={loadingPartners} onOpen={openPartner} onCreated={loadPartners} showCreate={showCreate} setShowCreate={setShowCreate} />
        )}
        {view === 'partner' && activePartner && (
          <PartnerShell partner={activePartner} page={activePage} onBack={goBack} onDeleted={() => { goBack(); loadPartners(); }} />
        )}
      </main>
    </div>
  );
}

// ─── Partners list ────────────────────────────────────────────────────────────

function PartnersPage({ partners, loading, onOpen, onCreated, showCreate, setShowCreate }) {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Partners</h2>
          <p className="page-sub">{partners.length} {partners.length === 1 ? 'site' : 'sites'} tracked</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ Add partner</button>
      </div>
      {showCreate && <CreatePartnerModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); onCreated(); }} />}
      {loading ? <div className="loading-state"><div className="spinner lg" /></div>
        : partners.length === 0 ? <EmptyState onAdd={() => setShowCreate(true)} />
        : <div className="partner-grid">{partners.map(p => <PartnerCard key={p.id} partner={p} onClick={() => onOpen(p)} />)}</div>}
    </div>
  );
}

function PartnerCard({ partner, onClick }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    async function load() {
      const PAGE = 1000;
      let sessions = [], from = 0;
      while (true) {
        const { data } = await supabase.from('sessions').select('session_id, converted').eq('client_id', partner.id).gte('created_at', since).range(from, from + PAGE - 1);
        if (!data?.length) break;
        sessions = sessions.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      const { data: convData } = await supabase.from('conversion_events').select('id').eq('client_id', partner.id).gte('created_at', since);
      const conversions = convData || [];
      const convRate = sessions.length > 0 ? (conversions.length / sessions.length * 100).toFixed(1) : '0.0';
      setStats({ sessions: sessions.length, conversions: conversions.length, convRate });
    }
    load();
  }, [partner.id]);
  return (
    <button className="partner-card" onClick={onClick}>
      <div className="card-top">
        <div className="card-favicon">
          <img src={`https://www.google.com/s2/favicons?domain=${partner.domain}&sz=32`} alt="" onError={e => { e.target.style.display = 'none'; }} />
        </div>
        <div className="card-meta">
          <span className="card-name">{partner.name}</span>
          <span className="card-domain">{partner.domain}</span>
        </div>
        <div className="card-arrow">→</div>
      </div>
      <div className="card-stats">
        <div className="stat"><span className="stat-value">{stats ? fmt(stats.sessions) : '—'}</span><span className="stat-label">Sessions</span></div>
        <div className="stat"><span className="stat-value">{stats ? fmt(stats.conversions) : '—'}</span><span className="stat-label">Conversions</span></div>
        <div className="stat"><span className="stat-value">{stats ? stats.convRate + '%' : '—'}</span><span className="stat-label">Conv rate</span></div>
      </div>
    </button>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">◈</div>
      <h3>No partners yet</h3>
      <p>Add your first partner site to start collecting data.</p>
      <button className="btn-primary" onClick={onAdd}>Add your first partner</button>
    </div>
  );
}

// ─── Create partner modal ─────────────────────────────────────────────────────

function CreatePartnerModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function handleSubmit(e) {
    e.preventDefault(); setError('');
    let d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (!d || !d.includes('.')) { setError('Enter a valid domain, e.g. acme.com'); return; }
    setLoading(true);
    const { error } = await createPartner({ name: name.trim(), domain: d });
    if (error) { setError(error.message); setLoading(false); return; }
    onCreated();
  }
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header"><h3>Add partner</h3><button className="modal-close" onClick={onClose}>✕</button></div>
        <form onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}
          <div className="field">
            <label className="field-label">Partner name</label>
            <input className="field-input" value={name} onChange={e => setName(e.target.value)} placeholder="Acme Corporation" required autoFocus />
          </div>
          <div className="field">
            <label className="field-label">Website domain</label>
            <input className="field-input mono" value={domain} onChange={e => setDomain(e.target.value)} placeholder="acme.com" required />
            <span className="field-hint">Without https:// or www — subdomains included automatically.</span>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>{loading ? <span className="spinner" /> : 'Create partner'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Partner shell (routes to subpages) ──────────────────────────────────────

function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysAgoStr(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

function PartnerShell({ partner, page, onBack, onDeleted }) {
  const noFilter = ['snippet', 'settings', 'goals', 'forms'].includes(page);

  // Main date range — default last 30 days
  const [dateFrom, setDateFrom] = useState(daysAgoStr(30));
  const [dateTo,   setDateTo]   = useState(todayStr());

  // Comparison range
  const [compFrom, setCompFrom] = useState('');
  const [compTo,   setCompTo]   = useState('');
  const [showComp, setShowComp] = useState(false);

  // Source / medium multiselect
  const [availSources, setAvailSources] = useState([]);
  const [selSources,   setSelSources]   = useState([]);
  const [selMediums,   setSelMediums]   = useState([]);
  const [showSrcPicker, setShowSrcPicker] = useState(false);

  // Load available sources for this partner so we can populate the picker
  const [earliestDate, setEarliestDate] = useState('');
  useEffect(() => {
    if (noFilter) return;
    supabase.from('sessions').select('created_at').eq('client_id', partner.id).order('created_at', { ascending: true }).limit(1)
      .then(({ data }) => { if (data?.[0]) setEarliestDate(data[0].created_at.slice(0, 10)); });
  }, [partner.id]); // eslint-disable-line

  useEffect(() => {
    if (noFilter) return;
    getSources(partner.id, { dateFrom, dateTo }).then(rows => {
      setAvailSources(rows);
    });
  }, [partner.id, dateFrom, dateTo, noFilter]); // eslint-disable-line

  const filter = { dateFrom, dateTo, compFrom: showComp ? compFrom : '', compTo: showComp ? compTo : '', sources: selSources, mediums: selMediums };

  const pages = { overview: OverviewPage, goals: GoalsPage, pages: TopPagesPage, sources: SourcesPage, paths: PathsPage, forms: FormsPage, latency: LatencyPage, snippet: SnippetPage, settings: SettingsPage };
  const Page = pages[page] || OverviewPage;

  const activeSourceFilters = selSources.length + selMediums.length;

  function toggleSource(src) {
    setSelSources(prev => prev.includes(src) ? prev.filter(s => s !== src) : [...prev, src]);
  }
  function toggleMedium(med) {
    setSelMediums(prev => prev.includes(med) ? prev.filter(m => m !== med) : [...prev, med]);
  }

  const allMediums = [...new Set(availSources.map(s => s.medium))];

  return (
    <div className="page">
      <div className="detail-header">
        <button className="btn-back" onClick={onBack}>← Partners</button>
        <div className="detail-title-row">
          <div className="detail-favicon">
            <img src={`https://www.google.com/s2/favicons?domain=${partner.domain}&sz=32`} alt="" onError={e => { e.target.style.display = 'none'; }} />
          </div>
          <div>
            <h2 className="page-title">{partner.name}</h2>
            <a className="card-domain link" href={`https://${partner.domain}`} target="_blank" rel="noreferrer">{partner.domain} ↗</a>
          </div>
        </div>
      </div>

      {!noFilter && (
        <div className="global-filter-bar">
          {/* Date range */}
          <div className="gf-group">
            <span className="gf-label">Range</span>
            <input type="date" className="gf-date-input" value={dateFrom} min={earliestDate || undefined} max={dateTo} onChange={e => setDateFrom(e.target.value)} />
            <span className="gf-sep">→</span>
            <input type="date" className="gf-date-input" value={dateTo} min={dateFrom} max={todayStr()} onChange={e => setDateTo(e.target.value)} />
          </div>

          {/* Comparison toggle */}
          <div className="gf-group">
            <button className={`gf-toggle ${showComp ? 'active' : ''}`} onClick={() => {
              setShowComp(v => !v);
              if (!showComp && !compFrom) {
                // Default comparison to the equivalent prior period
                const ms = new Date(dateTo) - new Date(dateFrom);
                const days = Math.ceil(ms / 86400000) + 1;
                setCompTo(daysAgoStr(days + 1));
                setCompFrom(daysAgoStr(days * 2 + 1));
              }
            }}>
              Compare
            </button>
            {showComp && (
              <>
                <input type="date" className="gf-date-input" value={compFrom} onChange={e => setCompFrom(e.target.value)} />
                <span className="gf-sep">→</span>
                <input type="date" className="gf-date-input" value={compTo} onChange={e => setCompTo(e.target.value)} />
              </>
            )}
          </div>

          {/* Source / medium picker */}
          <div className="gf-group" style={{ position: 'relative' }}>
            <button className={`gf-toggle ${activeSourceFilters > 0 ? 'active' : ''}`} onClick={() => setShowSrcPicker(v => !v)}>
              Source {activeSourceFilters > 0 ? `(${activeSourceFilters})` : ''}
            </button>
            {showSrcPicker && (
              <div className="src-picker" onClick={e => e.stopPropagation()}>
                <div className="src-picker-section">
                  <div className="src-picker-label">Source</div>
                  {availSources.map(s => (
                    <label key={s.source} className="src-picker-row">
                      <input type="checkbox" checked={selSources.includes(s.source)} onChange={() => toggleSource(s.source)} />
                      <span>{s.source}</span>
                      <span className="src-picker-count">{s.sessions}</span>
                    </label>
                  ))}
                </div>
                <div className="src-picker-section">
                  <div className="src-picker-label">Medium</div>
                  {allMediums.map(m => (
                    <label key={m} className="src-picker-row">
                      <input type="checkbox" checked={selMediums.includes(m)} onChange={() => toggleMedium(m)} />
                      <span className={`medium-pill medium-${m}`}>{m}</span>
                    </label>
                  ))}
                </div>
                {activeSourceFilters > 0 && (
                  <button className="src-picker-clear" onClick={() => { setSelSources([]); setSelMediums([]); }}>Clear filters</button>
                )}
              </div>
            )}
          </div>

          {/* Active filter summary chips */}
          {selSources.map(s => (
            <span key={s} className="gf-chip">{s} <button onClick={() => toggleSource(s)}>✕</button></span>
          ))}
          {selMediums.map(m => (
            <span key={m} className="gf-chip">{m} <button onClick={() => toggleMedium(m)}>✕</button></span>
          ))}
        </div>
      )}

      <Page partner={partner} filter={filter} onDeleted={onDeleted} />
    </div>
  );
}

// ─── Overview page ────────────────────────────────────────────────────────────

function OverviewPage({ partner, filter }) {
  const [data, setData] = useState(null);
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getOverview(partner.id, filter),
      getDailySeries(partner.id, filter),
    ]).then(([overview, daily]) => {
      setData(overview);
      setSeries(daily);
      setLoading(false);
    });
  }, [partner.id, JSON.stringify(filter)]); // eslint-disable-line

  if (loading) return <div className="loading-state"><div className="spinner lg" /></div>;
  if (!data) return null;

  return (
    <div className="overview-content">
      <div className="stats-strip six">
        <StatBox label="Conversions" value={fmt(data.conversions)} delta={data.conversionsDelta} highlight />
        <StatBox label="Conv rate" value={data.convRate + '%'} delta={data.convRateDelta} highlight />
        <StatBox label="Sessions" value={fmt(data.sessions)} delta={data.sessionsDelta} />
        <StatBox label="Pageviews" value={fmt(data.pageviews)} />
        <StatBox label="Avg session length" value={data.avgSessionLengthMs != null ? fmtTime(Math.round(data.avgSessionLengthMs / 1000)) : '—'} />
        <StatBox label="Avg scroll depth" value={data.avgScrollDepth != null ? `${data.avgScrollDepth}%` : '—'} />
      </div>

      <div className="chart-card">
        <div className="chart-header">
          <span className="chart-title">Sessions &amp; conversions</span>
          <div className="chart-legend">
            <span className="legend-dot sessions" />Sessions
            <span className="legend-dot conversions" />Conversions
          </div>
        </div>
        <Sparkline data={series} />
      </div>

      <div className="two-col">
        <div className="info-card">
          <h4 className="card-label">Visitor breakdown</h4>
          <div className="breakdown-rows">
            <div className="breakdown-row">
              <span>New visitors</span>
              <span className="breakdown-val-group">
                <span className="breakdown-val">{fmt(data.newVisitors)}</span>
                <span className="breakdown-sub">{data.newConvRate}% conv</span>
              </span>
            </div>
            <div className="breakdown-row">
              <span>Returning visitors</span>
              <span className="breakdown-val-group">
                <span className="breakdown-val">{fmt(data.returningVisitors)}</span>
                <span className="breakdown-sub">{data.returningConvRate}% conv</span>
              </span>
            </div>
          </div>
        </div>
        <div className="info-card">
          <h4 className="card-label">Conversions by goal</h4>
          {Object.keys(data.conversionsByGoal).length === 0
            ? <p className="empty-note">No conversions yet. Set up goals to start tracking.</p>
            : Object.entries(data.conversionsByGoal).map(([name, count]) => (
              <div key={name} className="breakdown-row">
                <span className="breakdown-goal-name">{name}</span>
                <span className="breakdown-val">{count}</span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}

// ─── Goals page ───────────────────────────────────────────────────────────────

function GoalsPage({ partner, filter }) {
  const [goals, setGoals]             = useState([]);
  const [events, setEvents]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [showAdd, setShowAdd]         = useState(false);
  const [editGoal, setEditGoal]       = useState(null); // goal object to edit
  const [tab, setTab]                 = useState('events');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [sessionPath, setSessionPath] = useState(null); // { ev, steps[] }
  const [pathLoading, setPathLoading] = useState(false);

  const loadGoals = useCallback(async () => {
    setLoading(true);
    const { data } = await getGoals(partner.id);
    setGoals(data || []);
    setLoading(false);
  }, [partner.id]);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    const since = filter?.dateFrom ? new Date(filter.dateFrom).toISOString() : new Date(Date.now() - 30 * 86400000).toISOString();
    const { data } = await getConversionEvents(partner.id, 365);
    setEvents((data || []).filter(e => !filter?.dateFrom || e.ts >= since));
    setEventsLoading(false);
  }, [partner.id, JSON.stringify(filter)]); // eslint-disable-line

  useEffect(() => { loadGoals(); }, [loadGoals]);
  useEffect(() => { loadEvents(); }, [loadEvents]);

  async function handleConfirmDelete() {
    if (!confirmDelete) return;
    try {
      if (confirmDelete.type === 'goal') { await deleteGoal(confirmDelete.id); loadGoals(); }
      else { await deleteConversionEvent(confirmDelete.id); await loadEvents(); }
      setConfirmDelete(null);
    } catch (err) {
      alert('Delete failed: ' + (err.message || 'Unknown error'));
      setConfirmDelete(null);
    }
  }

  async function handleEventClick(ev) {
    setPathLoading(true);
    setSessionPath({ ev, steps: [] });
    const steps = await getSessionPath(partner.id, ev.session_id);
    setSessionPath({ ev, steps });
    setPathLoading(false);
  }

  const typeLabels = { click: 'Click', click_url: 'Click URL', element_visible: 'Element visible', page_load: 'Page load', form_submit: 'Form submit' };
  const typeColors = { click: 'type-click', click_url: 'type-click', element_visible: 'type-element_visible', page_load: 'type-page_load', form_submit: 'type-form_submit' };

  return (
    <div className="goals-content">

      {/* Confirm delete modal */}
      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete {confirmDelete.type === 'goal' ? 'goal' : 'event'}?</h3>
              <button className="modal-close" onClick={() => setConfirmDelete(null)}>✕</button>
            </div>
            <p style={{ color: 'var(--text2)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: 8 }}>
              {confirmDelete.type === 'goal'
                ? <>Deleting <strong style={{ color: 'var(--text)' }}>{confirmDelete.label}</strong> will stop tracking future conversions. Historical events remain.</>
                : <>Permanently remove this conversion event? This cannot be undone.</>}
            </p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={handleConfirmDelete}>Yes, delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Session path modal */}
      {sessionPath && (
        <div className="modal-backdrop" onClick={() => setSessionPath(null)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Conversion path</h3>
              <button className="modal-close" onClick={() => setSessionPath(null)}>✕</button>
            </div>
            <div className="session-path-meta">
              <span className="ce-goal-name">{sessionPath.ev.conversion_goals?.name || '—'}</span>
              <span className="mono-sm" style={{ color: 'var(--text3)' }}>{fmtInTz(sessionPath.ev.ts, partner.timezone)}</span>
              {sessionPath.ev.utm_source && <span className="medium-pill medium-referral">{sessionPath.ev.utm_source}</span>}
            </div>
            {pathLoading ? <div className="loading-state"><div className="spinner lg" /></div> : (
              sessionPath.steps.length === 0
                ? <p style={{ color: 'var(--text3)', padding: '20px 0' }}>No pageview data found for this session.</p>
                : <div className="session-path-steps">
                    {sessionPath.steps.map((step, i) => (
                      <div key={i} className="session-path-step">
                        <div className="sp-index">{i + 1}</div>
                        <div className="sp-body">
                          <div className="sp-url mono-sm">{step.path}</div>
                          <div className="sp-stats">
                            {step.timeMs != null && <span className="sp-stat"><span className="sp-stat-label">Time</span>{fmtTime(Math.round(step.timeMs / 1000))}</span>}
                            {step.maxDepth != null && <span className="sp-stat"><span className="sp-stat-label">Scroll</span>{step.maxDepth}%</span>}
                          </div>
                        </div>
                        {i < sessionPath.steps.length - 1 && <div className="sp-arrow">↓</div>}
                      </div>
                    ))}
                    <div className="session-path-step step-conversion">
                      <div className="sp-index conv">✓</div>
                      <div className="sp-body"><div className="sp-url">Converted — {sessionPath.ev.conversion_goals?.name}</div></div>
                    </div>
                  </div>
            )}
          </div>
        </div>
      )}

      <div className="section-header">
        <div>
          <h3 className="section-title">Conversions</h3>
          <p className="section-sub">Conversion events and triggers for {partner.domain}</p>
        </div>
        {tab === 'goals' && <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add trigger</button>}
      </div>

      <div className="goals-tabs">
        <button className={`goals-tab ${tab === 'events' ? 'active' : ''}`} onClick={() => setTab('events')}>
          Conversions <span className="goals-tab-count">{events.length || ''}</span>
        </button>
        <button className={`goals-tab ${tab === 'goals' ? 'active' : ''}`} onClick={() => setTab('goals')}>
          Conversion triggers <span className="goals-tab-count">{goals.length}</span>
        </button>
      </div>

      {(showAdd || editGoal) && (
        <GoalModal
          clientId={partner.id}
          goal={editGoal}
          onClose={() => { setShowAdd(false); setEditGoal(null); }}
          onSaved={() => { setShowAdd(false); setEditGoal(null); loadGoals(); }}
        />
      )}

      {/* ── Conversion Triggers tab ── */}
      {tab === 'goals' && (
        loading
          ? <div className="loading-state"><div className="spinner lg" /></div>
          : goals.length === 0
            ? <div className="empty-state"><div className="empty-icon">◎</div><h3>No triggers yet</h3><p>Add a conversion trigger to start tracking what matters.</p><button className="btn-primary" onClick={() => setShowAdd(true)}>Add your first trigger</button></div>
            : (
              <div className="goals-list">
                {goals.map(goal => (
                  <div key={goal.id} className={`goal-row ${!goal.active ? 'inactive' : ''}`}>
                    <div className="goal-info">
                      <span className="goal-name">{goal.name}</span>
                      <span className={`goal-type-pill ${typeColors[goal.type] || 'type-click'}`}>{typeLabels[goal.type] || goal.type}</span>
                      <span className="goal-detail mono-sm">{goal.css_selector || goal.url_pattern || '—'}</span>
                      <span className={`goal-status-badge ${goal.active ? 'status-active' : 'status-paused'}`}>{goal.active ? 'Active' : 'Paused'}</span>
                    </div>
                    <div className="goal-actions">
                      <button className="btn-ghost btn-sm" onClick={() => setEditGoal(goal)}>Edit</button>
                      <button className="btn-icon-danger" onClick={() => setConfirmDelete({ id: goal.id, type: 'goal', label: goal.name })}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )
      )}

      {/* ── Conversions tab ── */}
      {tab === 'events' && (
        eventsLoading
          ? <div className="loading-state"><div className="spinner lg" /></div>
          : events.length === 0
            ? <div className="empty-state"><div className="empty-icon">◎</div><h3>No conversion events yet</h3><p>Events will appear here once visitors trigger a goal.</p></div>
            : (
              <div className="conv-events-table">
                <div className="conv-events-head">
                  <span className="ce-col-goal">Goal</span>
                  <span className="ce-col-page">Page</span>
                  <span className="ce-col-device">Device</span>
                  <span className="ce-col-source">Source</span>
                  <span className="ce-col-date">Date &amp; time</span>
                  <span className="ce-col-action"></span>
                </div>
                {events.map(ev => (
                  <div key={ev.id} className="conv-events-row conv-events-row-clickable" onClick={() => handleEventClick(ev)}>
                    <span className="ce-col-goal"><span className="ce-goal-name">{ev.conversion_goals?.name || '—'}</span></span>
                    <span className="ce-col-page mono-sm">{ev.url.replace(/^https?:\/\/[^/]+/, '') || '/'}</span>
                    <span className="ce-col-device"><span className={`device-pill device-${ev.device_type}`}>{ev.device_type || '—'}</span></span>
                    <span className="ce-col-source mono-sm">{ev.utm_source || 'direct'}</span>
                    <span className="ce-col-date">
                      <span className="ce-date">{fmtDateInTz(ev.ts, partner.timezone)}</span>
                      <span className="ce-time">{fmtTimeInTz(ev.ts, partner.timezone)}</span>
                    </span>
                    <span className="ce-col-action">
                      <button className="btn-icon-danger" title="Delete event" onClick={e => { e.stopPropagation(); setConfirmDelete({ id: ev.id, type: 'event', label: ev.conversion_goals?.name || ev.url }); }}>✕</button>
                    </span>
                  </div>
                ))}
              </div>
            )
      )}
    </div>
  );
}

// ─── Unified add/edit goal modal ──────────────────────────────────────────────

function GoalModal({ clientId, goal, onClose, onSaved }) {
  const isEdit = !!goal;

  const [name, setName]                     = useState(goal?.name || '');
  const [type, setType]                     = useState(goal?.type || 'click');
  const [active, setActive]                 = useState(goal?.active ?? true);
  const [selector, setSelector]             = useState(goal?.css_selector || '');
  const [urlPattern, setUrlPattern]         = useState(goal?.type === 'page_load' ? (goal?.url_pattern || '') : '');
  const [matchType, setMatchType]           = useState(goal?.match_type || 'exact');
  const [clickUrlPattern, setClickUrlPattern] = useState(goal?.type === 'click_url' ? (goal?.url_pattern || '') : '');
  const [clickUrlMatch, setClickUrlMatch]   = useState(goal?.match_type || 'contains');
  const [formDefs, setFormDefs]             = useState([]);
  const [selForms, setSelForms]             = useState(() => {
    // Pre-populate from existing selector if editing a form_submit goal
    if (goal?.type === 'form_submit' && goal?.css_selector) {
      return goal.css_selector.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
  });
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState('');

  // Load form definitions when form_submit type is selected
  useEffect(() => {
    if (type === 'form_submit') {
      import('./lib/forms').then(({ getFormDefinitions }) => {
        getFormDefinitions(clientId).then(({ data }) => setFormDefs(data || []));
      });
    }
  }, [type, clientId]);

  function toggleForm(selector) {
    setSelForms(prev => prev.includes(selector) ? prev.filter(s => s !== selector) : [...prev, selector]);
  }

  async function handleSubmit(e) {
    e.preventDefault(); setError('');
    if (!name.trim()) { setError('Name is required'); return; }

    let cssSelector = null, finalUrlPattern = null, finalMatchType = matchType;
    if (type === 'click') {
      if (!selector.trim()) { setError('CSS selector is required'); return; }
      cssSelector = selector.trim();
    } else if (type === 'click_url') {
      if (!clickUrlPattern.trim()) { setError('URL pattern is required'); return; }
      cssSelector = 'a'; finalUrlPattern = clickUrlPattern.trim(); finalMatchType = clickUrlMatch;
    } else if (type === 'element_visible') {
      if (!selector.trim()) { setError('CSS selector is required'); return; }
      cssSelector = selector.trim();
    } else if (type === 'form_submit') {
      if (selForms.length === 0 && !selector.trim()) { setError('Select at least one form or enter a CSS selector'); return; }
      // If forms selected from list, use their selectors joined; else fall back to manual input
      cssSelector = selForms.length > 0 ? selForms.join(', ') : selector.trim();
    } else if (type === 'page_load') {
      if (!urlPattern.trim()) { setError('URL pattern is required'); return; }
      finalUrlPattern = urlPattern.trim();
    }

    setLoading(true);
    const payload = { name: name.trim(), type: type === 'click_url' ? 'click_url' : type, cssSelector, urlPattern: finalUrlPattern, matchType: finalMatchType, active };
    const { error: err } = isEdit
      ? await updateGoal(goal.id, payload)
      : await createGoal({ clientId, ...payload });
    if (err) { setError(err.message); setLoading(false); return; }
    onSaved();
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h3>{isEdit ? 'Edit trigger' : 'Add conversion trigger'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}

          <div className="field">
            <label className="field-label">Goal name</label>
            <input className="field-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Phone click, Demo request, Purchase" required autoFocus />
          </div>

          <div className="field">
            <label className="field-label">Goal type</label>
            <select className="field-input" value={type} onChange={e => setType(e.target.value)}>
              <option value="click">Click — user clicks an element (CSS selector)</option>
              <option value="click_url">Click URL — user clicks a link whose URL contains a pattern</option>
              <option value="element_visible">Element visible — element scrolls into view</option>
              <option value="page_load">Page load — user lands on a URL</option>
              <option value="form_submit">Form submit — user submits a form</option>
            </select>
          </div>

          {type === 'click' && (
            <div className="field">
              <label className="field-label">CSS selector</label>
              <input className="field-input mono" value={selector} onChange={e => setSelector(e.target.value)} placeholder="#cta-button, .buy-now, button[type=submit]" />
              <span className="field-hint">Any valid CSS selector — ID, class, attribute, or tag.</span>
            </div>
          )}

          {type === 'click_url' && (
            <>
              <div className="goal-hint-box">Track clicks on phone numbers, email addresses, or any link by its URL.</div>
              <div className="field">
                <label className="field-label">URL match type</label>
                <select className="field-input" value={clickUrlMatch} onChange={e => setClickUrlMatch(e.target.value)}>
                  <option value="contains">Contains</option>
                  <option value="exact">Equals</option>
                  <option value="starts_with">Starts with</option>
                  <option value="regex">Matches regex</option>
                </select>
              </div>
              <div className="field">
                <label className="field-label">URL pattern</label>
                <input className="field-input mono" value={clickUrlPattern} onChange={e => setClickUrlPattern(e.target.value)} placeholder="tel:, mailto:, /checkout" />
                <span className="field-hint">Examples: <code>tel:</code> for phone · <code>mailto:</code> for email · <code>/checkout</code> for checkout links</span>
              </div>
            </>
          )}

          {type === 'element_visible' && (
            <div className="field">
              <label className="field-label">CSS selector</label>
              <input className="field-input mono" value={selector} onChange={e => setSelector(e.target.value)} placeholder="#pricing-section, .cta-banner" />
            </div>
          )}

          {type === 'form_submit' && (
            <div className="field">
              <label className="field-label">Forms to track</label>
              {formDefs.length > 0 ? (
                <>
                  <div className="form-select-list">
                    {formDefs.map(f => (
                      <label key={f.id} className="form-select-row">
                        <input type="checkbox" checked={selForms.includes(f.selector)} onChange={() => toggleForm(f.selector)} />
                        <span className="form-select-name">{f.name}</span>
                        <span className="form-select-selector mono-sm">{f.selector}</span>
                      </label>
                    ))}
                  </div>
                  <span className="field-hint" style={{ marginTop: 8 }}>Or enter a custom selector below (leave blank to use selections above)</span>
                  <input className="field-input mono" style={{ marginTop: 6 }} value={selector} onChange={e => setSelector(e.target.value)} placeholder="form, form#contact" />
                </>
              ) : (
                <>
                  <div className="goal-hint-box">No forms set up yet. Go to Form Analytics to add forms, or enter a CSS selector manually.</div>
                  <input className="field-input mono" value={selector} onChange={e => setSelector(e.target.value)} placeholder="form, form#contact" />
                </>
              )}
            </div>
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

          {isEdit && (
            <div className="field">
              <label className="field-label">Status</label>
              <div className="goal-status-toggle">
                <button type="button" className={`status-opt ${active ? 'active' : ''}`} onClick={() => setActive(true)}>Active</button>
                <button type="button" className={`status-opt ${!active ? 'active' : ''}`} onClick={() => setActive(false)}>Paused</button>
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>{loading ? <span className="spinner" /> : isEdit ? 'Save changes' : 'Save trigger'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}


// ─── Top pages ────────────────────────────────────────────────────────────────

function TopPagesPage({ partner, filter }) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingAll, setLoadingAll] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const [device, setDevice] = useState(null);
  const [sortCol, setSortCol] = useState('conversions');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    setLoading(true);
    setAllLoaded(false);
    // Fast load: top 10 by conversions only — no time/scroll data
    getTopPagesFast(partner.id, filter, device).then(data => {
      setPages(data);
      setLoading(false);
    });
  }, [partner.id, JSON.stringify(filter), device]); // eslint-disable-line

  function handleLoadAll() {
    setLoadingAll(true);
    getTopPages(partner.id, filter, device).then(data => {
      setPages(data);
      setLoadingAll(false);
      setAllLoaded(true);
    });
  }

  function handleSort(col) {
    if (sortCol === col) { setSortDir(d => d === 'desc' ? 'asc' : 'desc'); }
    else { setSortCol(col); setSortDir('desc'); }
  }

  const sorted = useMemo(() => {
    return [...pages].sort((a, b) => {
      const av = a[sortCol] ?? -1, bv = b[sortCol] ?? -1;
      const av2 = typeof av === 'string' ? parseFloat(av) : av;
      const bv2 = typeof bv === 'string' ? parseFloat(bv) : bv;
      return sortDir === 'desc' ? bv2 - av2 : av2 - bv2;
    });
  }, [pages, sortCol, sortDir]);

  function SortTh({ col, children, className }) {
    const active = sortCol === col;
    return (
      <span className={`${className} sort-th ${active ? 'sort-active' : ''}`} onClick={() => handleSort(col)}>
        {children}
        <span className="sort-arrow">{active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ' ↕'}</span>
      </span>
    );
  }

  return (
    <div>
      <div className="section-header">
        <div><h3 className="section-title">Top pages</h3><p className="section-sub">Top 10 by conversions · click a column to sort</p></div>
        <div className="filter-group">
          {[null, 'mobile', 'tablet', 'desktop'].map(d => (
            <button key={d || 'all'} className={`filter-btn ${device === d ? 'active' : ''}`} onClick={() => setDevice(d)}>{d || 'All'}</button>
          ))}
        </div>
      </div>
      {loading ? <div className="loading-state"><div className="spinner lg" /></div> : (
        <>
          <div className="data-table">
            <div className="table-head">
              <span className="col-url">Page</span>
              <SortTh col="pageviews"      className="col-num">Pageviews</SortTh>
              <SortTh col="avgTime"        className="col-num">Avg time</SortTh>
              <SortTh col="avgScrollDepth" className="col-num">Avg scroll</SortTh>
              <SortTh col="conversions"    className="col-num">Convs</SortTh>
              <SortTh col="convRate"       className="col-num">Conv rate</SortTh>
              <SortTh col="exitRate"       className="col-num">Exit rate</SortTh>
            </div>
            {sorted.length === 0 ? <div className="table-empty">No data for this period</div>
              : sorted.map((p, i) => (
                <div key={i} className="table-row">
                  <span className="col-url mono-sm">{p.url}</span>
                  <span className="col-num">{fmt(p.pageviews)}</span>
                  <span className="col-num">{p.avgTime != null ? fmtTime(p.avgTime) : '—'}</span>
                  <span className="col-num">{p.avgScrollDepth != null ? `${p.avgScrollDepth}%` : '—'}</span>
                  <span className="col-num">{fmt(p.conversions)}</span>
                  <span className="col-num">{p.convRate}%</span>
                  <span className="col-num">{p.exitRate != null ? `${p.exitRate}%` : '—'}</span>
                </div>
              ))}
          </div>
          {!allLoaded && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <button className="btn-ghost" onClick={handleLoadAll} disabled={loadingAll}>
                {loadingAll ? <><span className="spinner" style={{ marginRight: 8 }} />Loading all pages…</> : 'Load all pages with time & scroll data'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sources page ─────────────────────────────────────────────────────────────

function SourcesPage({ partner, filter }) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState('sessions');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    setLoading(true);
    getSources(partner.id, filter).then(data => { setSources(data); setLoading(false); });
  }, [partner.id, JSON.stringify(filter)]); // eslint-disable-line

  function handleSort(col) {
    if (sortCol === col) { setSortDir(d => d === 'desc' ? 'asc' : 'desc'); }
    else { setSortCol(col); setSortDir('desc'); }
  }

  const sorted = useMemo(() => {
    return [...sources].sort((a, b) => {
      const av = typeof a[sortCol] === 'string' ? parseFloat(a[sortCol]) : (a[sortCol] ?? -1);
      const bv = typeof b[sortCol] === 'string' ? parseFloat(b[sortCol]) : (b[sortCol] ?? -1);
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [sources, sortCol, sortDir]);

  function SortTh({ col, children, className }) {
    const active = sortCol === col;
    return (
      <span className={`${className} sort-th ${active ? 'sort-active' : ''}`} onClick={() => handleSort(col)}>
        {children}
        <span className="sort-arrow">{active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ' ↕'}</span>
      </span>
    );
  }

  return (
    <div>
      <div className="section-header">
        <div><h3 className="section-title">Traffic sources</h3><p className="section-sub">Click a column header to sort</p></div>
      </div>
      {loading ? <div className="loading-state"><div className="spinner lg" /></div> : (
        <div className="data-table">
          <div className="table-head">
            <SortTh col="source"             className="col-source">Source</SortTh>
            <SortTh col="medium"             className="col-medium">Medium</SortTh>
            <SortTh col="sessions"           className="col-num">Sessions</SortTh>
            <SortTh col="avgSessionLengthMs" className="col-num">Avg time</SortTh>
            <SortTh col="conversions"        className="col-num">Convs</SortTh>
            <SortTh col="convRate"           className="col-num">Conv rate</SortTh>
          </div>
          {sorted.length === 0 ? <div className="table-empty">No data for this period</div>
            : sorted.map((s, i) => (
              <div key={i} className="table-row">
                <span className="col-source">{s.source}</span>
                <span className="col-medium"><span className={`medium-pill medium-${s.medium}`}>{s.medium}</span></span>
                <span className="col-num">{fmt(s.sessions)}</span>
                <span className="col-num">{s.avgSessionLengthMs != null ? fmtTime(Math.round(s.avgSessionLengthMs / 1000)) : '—'}</span>
                <span className="col-num">{fmt(s.conversions)}</span>
                <span className="col-num">{s.convRate}%</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── Conversion paths ─────────────────────────────────────────────────────────

// ─── Conversion paths ─────────────────────────────────────────────────────────

function PathsPage({ partner, filter }) {
  const [paths, setPaths]           = useState([]);
  const [influence, setInfluence]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [view, setView]             = useState('paths'); // 'paths' | 'influence'
  const [influenceSort, setInfluenceSort] = useState('sessions');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getConversionPaths(partner.id, filter),
      getPageInfluence(partner.id, filter),
    ]).then(([p, inf]) => { setPaths(p); setInfluence(inf); setLoading(false); });
  }, [partner.id, JSON.stringify(filter)]); // eslint-disable-line


  const sortedInfluence = useMemo(() => {
    return [...influence].sort((a, b) => {
      if (influenceSort === 'sessions') return b.sessions - a.sessions;
      if (influenceSort === 'time') return (b.avgTimeMs ?? -1) - (a.avgTimeMs ?? -1);
      if (influenceSort === 'depth') return (b.avgDepth ?? -1) - (a.avgDepth ?? -1);
      return 0;
    });
  }, [influence, influenceSort]);

  const maxInfluence = useMemo(() => Math.max(...sortedInfluence.map(p => p.sessions), 1), [sortedInfluence]);

  return (
    <div>
      <div className="section-header">
        <div>
          <h3 className="section-title">Conversion paths</h3>
          <p className="section-sub">Page sequences and key pages in converting sessions</p>
        </div>
        <div className="filter-group">
          <button className={`filter-btn ${view === 'paths' ? 'active' : ''}`} onClick={() => setView('paths')}>Top paths</button>
          <button className={`filter-btn ${view === 'influence' ? 'active' : ''}`} onClick={() => setView('influence')}>Page influence</button>
        </div>
      </div>

      {loading ? <div className="loading-state"><div className="spinner lg" /></div> : (

        view === 'paths' ? (
          paths.length === 0
            ? <div className="empty-state"><div className="empty-icon">◈</div><h3>No conversion paths yet</h3><p>Set up conversion goals and collect some data first.</p></div>
            : (
              <div className="data-table">
                <div className="table-head">
                  <span className="col-path-steps">Path</span>
                  <span className="col-num">Avg time</span>
                  <span className="col-num">Convs</span>
                </div>
                {paths.map((p, i) => {
                  // Avg time across all steps that have timing data
                  const stepTimes = p.steps.map(s => s.avgTimeMs).filter(t => t != null);
                  const pathAvgMs = stepTimes.length > 0
                    ? Math.round(stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length)
                    : null;
                  return (
                    <div key={i} className="path-table-row">
                      <span className="col-path-steps">
                        <div className="path-chips">
                          {p.steps.map((step, j) => (
                            <React.Fragment key={j}>
                              <div className="path-chip">
                                <span className="path-chip-url">{step.path}</span>
                                <span className="path-chip-stats">
                                  {step.avgTimeMs != null && <span className="path-chip-stat">⏱ {fmtTime(Math.round(step.avgTimeMs / 1000))}</span>}
                                  {step.avgDepth  != null && <span className="path-chip-stat">↕ {step.avgDepth}%</span>}
                                </span>
                              </div>
                              <span className="path-chip-arrow">›</span>
                            </React.Fragment>
                          ))}
                          <div className="path-chip path-chip-conv">✓ Converted</div>
                        </div>
                      </span>
                      <span className="col-num">{pathAvgMs != null ? fmtTime(Math.round(pathAvgMs / 1000)) : '—'}</span>
                      <span className="col-num">{p.count}</span>
                    </div>
                  );
                })}
              </div>
            )
        ) : (

          /* ── Page influence view ── */
          influence.length === 0
            ? <div className="empty-state"><div className="empty-icon">◈</div><h3>No data yet</h3><p>Set up conversion goals and collect some data first.</p></div>
            : (
              <div>
                <div className="influence-sort-bar">
                  <span className="gf-label">Sort by</span>
                  {[['sessions','Frequency'],['time','Avg time'],['depth','Avg scroll']].map(([val, label]) => (
                    <button key={val} className={`filter-btn ${influenceSort === val ? 'active' : ''}`} onClick={() => setInfluenceSort(val)}>{label}</button>
                  ))}
                  <span className="influence-sub">Showing pages visited in converting sessions</span>
                </div>
                <div className="data-table">
                  <div className="table-head">
                    <span className="col-url">Page</span>
                    <span className="col-bar">Sessions involved</span>
                    <span className="col-num">% of convs</span>
                    <span className="col-num">Avg time</span>
                    <span className="col-num">Avg scroll</span>
                  </div>
                  {sortedInfluence.map((p, i) => (
                    <div key={i} className="table-row">
                      <span className="col-url mono-sm">{p.path}</span>
                      <span className="col-bar">
                        <div className="bar-cell">
                          <div className="bar-fill" style={{ width: `${(p.sessions / maxInfluence) * 100}%` }} />
                          <span className="bar-label">{p.sessions}</span>
                        </div>
                      </span>
                      <span className="col-num">{p.pct.toFixed(1)}%</span>
                      <span className="col-num">{p.avgTimeMs != null ? fmtTime(Math.round(p.avgTimeMs / 1000)) : '—'}</span>
                      <span className="col-num">{p.avgDepth != null ? `${p.avgDepth}%` : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
        )
      )}
    </div>
  );
}

// ─── Return latency ───────────────────────────────────────────────────────────

function LatencyPage({ partner, filter }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getVisitorLatency(partner.id, filter).then(d => { setData(d); setLoading(false); });
  }, [partner.id, JSON.stringify(filter)]); // eslint-disable-line

  if (loading) return <div className="loading-state"><div className="spinner lg" /></div>;
  if (!data) return null;

  return (
    <div>
      <div className="section-header">
        <div><h3 className="section-title">Returning visitor latency</h3><p className="section-sub">How long it takes returning visitors to convert</p></div>
      </div>
      {data.totalConverters === 0 ? (
        <div className="empty-state"><div className="empty-icon">◈</div><h3>No returning converter data yet</h3><p>This report populates once returning visitors (tracked by visitor_id) complete a conversion goal.</p></div>
      ) : (
        <>
          <div className="stats-strip three">
            <StatBox label="Avg sessions to convert" value={data.avgSessions} />
            <StatBox label="Avg hours to convert" value={fmtHours(Number(data.avgHours))} />
            <StatBox label="Returning converters" value={fmt(data.totalConverters)} />
          </div>
          <div className="info-card" style={{ marginTop: 24 }}>
            <h4 className="card-label">Sessions before conversion</h4>
            <div className="dist-bars">
              {data.distribution.map((d, i) => (
                <div key={i} className="dist-row">
                  <span className="dist-label">{d.label} session{d.label !== '1' ? 's' : ''}</span>
                  <div className="dist-bar-wrap">
                    <div className="dist-bar" style={{ width: `${data.totalConverters > 0 ? (d.count / data.totalConverters) * 100 : 0}%` }} />
                  </div>
                  <span className="dist-count">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Snippet page ─────────────────────────────────────────────────────────────

function SnippetPage({ partner }) {
  const [copied, setCopied] = useState(false);
  const snippet = generateSnippet({ clientId: partner.id, ingestUrl: INGEST_URL });
  function copySnippet() {
    navigator.clipboard.writeText(snippet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  return (
    <div className="snippet-section">
      <div className="snippet-intro">
        <p>Paste this into the <code>&lt;head&gt;</code> of every page on <strong>{partner.domain}</strong>. It only fires on that domain.</p>
      </div>
      <div className="snippet-toolbar">
        <span className="snippet-lang">HTML</span>
        <button className="btn-copy" onClick={copySnippet}>{copied ? '✓ Copied' : 'Copy snippet'}</button>
      </div>
      <pre className="snippet-code"><code>{snippet}</code></pre>
      <div className="snippet-notes">
        <div className="note-row"><span className="note-pill green">Domain locked</span><span>Only fires on <code>{partner.domain}</code> and its subdomains</span></div>
        <div className="note-row"><span className="note-pill blue">Non-blocking</span><span>Loads asynchronously — zero impact on page speed</span></div>
        <div className="note-row"><span className="note-pill amber">Buffered</span><span>Events queue locally and flush every 2s — survives tab closes</span></div>
        <div className="note-row"><span className="note-pill gray">Idempotent</span><span>Retried batches are deduplicated — no duplicate data</span></div>
      </div>
    </div>
  );
}

// ─── Settings page ────────────────────────────────────────────────────────────

function SettingsPage({ partner, onDeleted }) {
  const [showDelete, setShowDelete]     = useState(false);
  const [showClear, setShowClear]       = useState(false);
  const [clearing, setClearing]         = useState(false);
  const [cleared, setCleared]           = useState(false);
  const [timezone, setTimezone]         = useState(partner.timezone || 'UTC');
  const [saving, setSaving]             = useState(false);
  const [saved, setSaved]               = useState(false);
  const [saveError, setSaveError]       = useState('');
  const [currentTime, setCurrentTime]   = useState(() => nowInTz(partner.timezone || 'UTC'));

  // Partner details editing
  const [editingDetails, setEditingDetails] = useState(false);
  const [editName, setEditName]         = useState(partner.name);
  const [editDomain, setEditDomain]     = useState(partner.domain);
  const [confirmDetails, setConfirmDetails] = useState(false);
  const [savingDetails, setSavingDetails]   = useState(false);
  const [detailsError, setDetailsError]     = useState('');

  useEffect(() => {
    const tz = timezone || 'UTC';
    setCurrentTime(nowInTz(tz));
    const interval = setInterval(() => setCurrentTime(nowInTz(tz)), 1000);
    return () => clearInterval(interval);
  }, [timezone]);

  async function handleSaveTimezone() {
    setSaving(true); setSaveError(''); setSaved(false);
    const { error } = await updatePartner(partner.id, { name: partner.name, domain: partner.domain, timezone });
    setSaving(false);
    if (error) { setSaveError(error.message); }
    else { setSaved(true); partner.timezone = timezone; setTimeout(() => setSaved(false), 3000); }
  }

  async function handleSaveDetails() {
    setSavingDetails(true); setDetailsError('');
    const { error } = await updatePartner(partner.id, { name: editName.trim(), domain: editDomain.trim(), timezone });
    setSavingDetails(false);
    if (error) { setDetailsError(error.message); return; }
    partner.name = editName.trim();
    partner.domain = editDomain.trim();
    setConfirmDetails(false);
    setEditingDetails(false);
  }

  async function handleClearData() {
    setClearing(true);
    const { error } = await clearPartnerData(partner.id);
    setClearing(false);
    if (error) { alert('Clear failed: ' + error.message); }
    else { setCleared(true); setShowClear(false); }
  }

  async function handleDelete() {
    const { error } = await deletePartner(partner.id);
    if (!error) onDeleted();
  }

  const tzLabel = TIMEZONES.find(t => t.value === timezone)?.label || timezone;

  return (
    <div className="settings-section">
      <div className="settings-group">
        <h4 className="settings-label">Partner details</h4>
        {editingDetails ? (
          <>
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="field-label">Name</label>
              <input className="field-input" value={editName} onChange={e => setEditName(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="field-label">Domain</label>
              <input className="field-input mono" value={editDomain} onChange={e => setEditDomain(e.target.value)} placeholder="example.com" />
            </div>
            {detailsError && <div className="login-error" style={{ marginBottom: 10 }}>{detailsError}</div>}
            {confirmDetails ? (
              <div className="confirm-row">
                <span style={{ color: 'var(--text2)', fontSize: '0.88rem' }}>Save changes to name and domain?</span>
                <button className="btn-ghost" onClick={() => setConfirmDetails(false)}>Back</button>
                <button className="btn-primary" onClick={handleSaveDetails} disabled={savingDetails}>
                  {savingDetails ? <span className="spinner" /> : 'Confirm'}
                </button>
              </div>
            ) : (
              <div className="confirm-row">
                <button className="btn-ghost" onClick={() => { setEditingDetails(false); setEditName(partner.name); setEditDomain(partner.domain); setDetailsError(''); }}>Cancel</button>
                <button className="btn-primary" onClick={() => setConfirmDetails(true)} disabled={!editName.trim() || !editDomain.trim()}>Save changes</button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="settings-row"><span className="settings-key">Name</span><span className="settings-val">{partner.name}</span></div>
            <div className="settings-row"><span className="settings-key">Domain</span><span className="settings-val mono">{partner.domain}</span></div>
            <div className="settings-row"><span className="settings-key">Partner ID</span><span className="settings-val mono">{partner.id}</span></div>
            <div className="settings-row"><span className="settings-key">Created</span><span className="settings-val">{new Date(partner.created_at).toLocaleDateString()}</span></div>
            <button className="btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setEditingDetails(true)}>Edit name / domain</button>
          </>
        )}
      </div>

      <div className="settings-group">
        <h4 className="settings-label">Timezone</h4>
        <p className="settings-sub">Sets how timestamps are displayed across this partner's dashboard. The tracker always records in UTC — this is display only.</p>
        <div className="tz-picker-row">
          <select
            className="field-input tz-select"
            value={timezone}
            onChange={e => { setTimezone(e.target.value); setSaved(false); }}
          >
            {TIMEZONES.map(tz => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
          <button
            className="btn-primary"
            onClick={handleSaveTimezone}
            disabled={saving || timezone === (partner.timezone || 'UTC')}
          >
            {saving ? <span className="spinner" /> : saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
        {saveError && <div className="login-error" style={{ marginTop: 10 }}>{saveError}</div>}
        <div className="tz-clock-row">
          <span className="tz-clock-label">Current time in {tzLabel}</span>
          <span className="tz-clock">{currentTime}</span>
        </div>
      </div>

      <div className="settings-group danger-zone">
        <h4 className="settings-label danger">Danger zone</h4>

        {/* Clear data */}
        <div className="danger-action">
          <div className="danger-action-info">
            <span className="danger-action-title">Clear all data</span>
            <span className="danger-action-desc">Deletes all events, sessions, and conversion records for this partner. Goals, form definitions, and settings are kept. Use this to wipe test data before launch.</span>
          </div>
          {cleared ? (
            <span className="danger-cleared">✓ Data cleared</span>
          ) : !showClear ? (
            <button className="btn-danger" onClick={() => setShowClear(true)}>Clear data</button>
          ) : (
            <div className="confirm-row">
              <span>Wipe all analytics data?</span>
              <button className="btn-ghost" onClick={() => setShowClear(false)}>Cancel</button>
              <button className="btn-danger" onClick={handleClearData} disabled={clearing}>
                {clearing ? <span className="spinner" /> : 'Yes, clear'}
              </button>
            </div>
          )}
        </div>

        {/* Delete partner */}
        <div className="danger-action" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div className="danger-action-info">
            <span className="danger-action-title">Delete partner</span>
            <span className="danger-action-desc">Permanently removes the partner and all associated data. This cannot be undone.</span>
          </div>
          {!showDelete ? (
            <button className="btn-danger" onClick={() => setShowDelete(true)}>Delete partner</button>
          ) : (
            <div className="confirm-row">
              <span>Are you sure?</span>
              <button className="btn-ghost" onClick={() => setShowDelete(false)}>Cancel</button>
              <button className="btn-danger" onClick={handleDelete}>Yes, delete</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────

function StatBox({ label, value, delta, highlight }) {
  return (
    <div className={`stat-box ${highlight ? 'stat-box-highlight' : ''}`}>
      <span className="stat-box-val">{value}</span>
      {delta != null && (
        <span className={`stat-delta ${Number(delta) >= 0 ? 'positive' : 'negative'}`}>
          {Number(delta) >= 0 ? '↑' : '↓'} {Math.abs(delta)}% vs prev
        </span>
      )}
      <span className="stat-box-label">{label}</span>
    </div>
  );
}

function Sparkline({ data, days }) {
  if (!data || data.length === 0) return null;
  const maxSessions = Math.max(...data.map(d => d.sessions), 1);
  const maxConv = Math.max(...data.map(d => d.conversions), 1);
  const w = 100 / data.length;

  return (
    <div className="sparkline-wrap">
      <svg viewBox={`0 0 ${data.length * 10} 60`} preserveAspectRatio="none" className="sparkline-svg">
        {data.map((d, i) => (
          <g key={i}>
            <rect x={i * 10 + 1} y={60 - (d.sessions / maxSessions) * 50} width={8} height={(d.sessions / maxSessions) * 50} className="spark-bar-sessions" />
            {d.conversions > 0 && (
              <rect x={i * 10 + 1} y={60 - (d.conversions / maxConv) * 50} width={8} height={4} className="spark-bar-conv" />
            )}
          </g>
        ))}
      </svg>
      <div className="sparkline-labels">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconGrid()   { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".8"/><rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".8"/><rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".8"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".8"/></svg>; }
function IconChart()  { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="8" width="3" height="7" fill="currentColor" opacity=".8"/><rect x="6" y="4" width="3" height="11" fill="currentColor" opacity=".8"/><rect x="11" y="1" width="3" height="14" fill="currentColor" opacity=".8"/></svg>; }
function IconTarget() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" opacity=".8"/><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" opacity=".8"/><circle cx="8" cy="8" r="1" fill="currentColor" opacity=".8"/></svg>; }
function IconPages()  { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" opacity=".8"/><line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="1.5" opacity=".6"/><line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.5" opacity=".6"/><line x1="5" y1="11" x2="9" y2="11" stroke="currentColor" strokeWidth="1.5" opacity=".6"/></svg>; }
function IconSource() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1a7 7 0 100 14A7 7 0 008 1z" stroke="currentColor" strokeWidth="1.5" opacity=".8"/><path d="M1 8h14M8 1c-2 2-3 4-3 7s1 5 3 7M8 1c2 2 3 4 3 7s-1 5-3 7" stroke="currentColor" strokeWidth="1.5" opacity=".6"/></svg>; }
function IconPath()   { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="2" cy="8" r="1.5" fill="currentColor" opacity=".8"/><circle cx="8" cy="4" r="1.5" fill="currentColor" opacity=".8"/><circle cx="14" cy="8" r="1.5" fill="currentColor" opacity=".8"/><path d="M3.5 8C5 6 6 5 6.5 4M9.5 4C10 5 11 6 12.5 8" stroke="currentColor" strokeWidth="1.5" opacity=".6"/></svg>; }
function IconForm()   { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" opacity=".8"/><line x1="4" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.5" opacity=".6"/><line x1="4" y1="10" x2="8" y2="10" stroke="currentColor" strokeWidth="1.5" opacity=".6"/></svg>; }
function IconClock()  { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" opacity=".8"/><path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".8"/></svg>; }
function IconCode()   { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 4L1 8l4 4M11 4l4 4-4 4M9 2l-2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".8"/></svg>; }
function IconGear()   { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" opacity=".8"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".6"/></svg>; }

// ─── Utils ────────────────────────────────────────────────────────────────────

// ─── Timezone-aware formatting ────────────────────────────────────────────────

// Common IANA timezones grouped by region for the picker
const TIMEZONES = [
  { label: 'UTC',                          value: 'UTC' },
  { label: 'Pacific Time (PT)',             value: 'America/Vancouver' },
  { label: 'Mountain Time (MT)',            value: 'America/Denver' },
  { label: 'Central Time (CT)',             value: 'America/Chicago' },
  { label: 'Eastern Time (ET)',             value: 'America/New_York' },
  { label: 'Atlantic Time (AT)',            value: 'America/Halifax' },
  { label: 'Newfoundland (NT)',             value: 'America/St_Johns' },
  { label: 'São Paulo (BRT)',               value: 'America/Sao_Paulo' },
  { label: 'London (GMT/BST)',              value: 'Europe/London' },
  { label: 'Paris / Berlin (CET)',          value: 'Europe/Paris' },
  { label: 'Helsinki (EET)',                value: 'Europe/Helsinki' },
  { label: 'Moscow (MSK)',                  value: 'Europe/Moscow' },
  { label: 'Dubai (GST)',                   value: 'Asia/Dubai' },
  { label: 'Karachi (PKT)',                 value: 'Asia/Karachi' },
  { label: 'India (IST)',                   value: 'Asia/Kolkata' },
  { label: 'Bangladesh (BST)',              value: 'Asia/Dhaka' },
  { label: 'Bangkok (ICT)',                 value: 'Asia/Bangkok' },
  { label: 'Singapore / KL (SGT)',          value: 'Asia/Singapore' },
  { label: 'Hong Kong / Beijing (CST)',     value: 'Asia/Hong_Kong' },
  { label: 'Tokyo (JST)',                   value: 'Asia/Tokyo' },
  { label: 'Sydney (AEDT)',                 value: 'Australia/Sydney' },
  { label: 'Auckland (NZST)',               value: 'Pacific/Auckland' },
];

function fmtInTz(ts, tz, opts = {}) {
  if (!ts) return '—';
  const date = new Date(ts);
  const timezone = tz || 'UTC';
  const defaultOpts = { timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return date.toLocaleString('en-CA', { ...defaultOpts, ...opts });
}

function fmtDateInTz(ts, tz) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtTimeInTz(ts, tz) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-CA', { timeZone: tz || 'UTC', hour: '2-digit', minute: '2-digit' });
}

function nowInTz(tz) {
  return new Date().toLocaleTimeString('en-CA', { timeZone: tz || 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function fmtTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function fmtHours(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}