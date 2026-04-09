import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, signIn, signOut, onAuthChange, getPartners, createPartner, deletePartner, getGoals, createGoal, toggleGoal, deleteGoal } from './lib/supabase';
import { generateSnippet } from './lib/snippet';
import { getOverview, getDailySeries, getTopPages, getSources, getConversionPaths, getFormAnalytics, getVisitorLatency } from './lib/analytics';
import './App.css';

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
        <div className="login-brand">
          <span className="logotype">CRO<em>hub</em></span>
          <p className="login-tagline">Conversion intelligence<br />for agencies that move fast.</p>
        </div>
        <div className="login-grid-bg" aria-hidden="true">
          {Array.from({ length: 64 }).map((_, i) => <div key={i} className="grid-cell" />)}
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
  const [view, setView] = useState('partners');
  const [activePartner, setActivePartner] = useState(null);
  const [activePage, setActivePage] = useState('overview');
  const [showCreate, setShowCreate] = useState(false);

  const loadPartners = useCallback(async () => {
    setLoadingPartners(true);
    const { data } = await getPartners();
    setPartners(data || []);
    setLoadingPartners(false);
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
                { id: 'goals',       label: 'Conversion goals', icon: <IconTarget /> },
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
    Promise.all([
      supabase.from('sessions').select('session_id, converted').eq('client_id', partner.id).gte('created_at', since),
      supabase.from('conversion_events').select('id').eq('client_id', partner.id).gte('created_at', since),
    ]).then(([sessRes, convRes]) => {
      const sessions = sessRes.data || [];
      const conversions = convRes.data || [];
      const convRate = sessions.length > 0 ? (conversions.length / sessions.length * 100).toFixed(1) : '0.0';
      setStats({ sessions: sessions.length, conversions: conversions.length, convRate });
    });
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

function PartnerShell({ partner, page, onBack, onDeleted }) {
  const [days, setDays] = useState(30);
  const pages = { overview: OverviewPage, goals: GoalsPage, pages: TopPagesPage, sources: SourcesPage, paths: PathsPage, forms: FormsPage, latency: LatencyPage, snippet: SnippetPage, settings: SettingsPage };
  const Page = pages[page] || OverviewPage;
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
          {!['snippet', 'settings', 'goals'].includes(page) && (
            <div className="date-filter">
              {[7, 30, 90].map(d => (
                <button key={d} className={`date-btn ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d}d</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <Page partner={partner} days={days} onDeleted={onDeleted} />
    </div>
  );
}

// ─── Overview page ────────────────────────────────────────────────────────────

function OverviewPage({ partner, days }) {
  const [data, setData] = useState(null);
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getOverview(partner.id, days),
      getDailySeries(partner.id, days),
    ]).then(([overview, daily]) => {
      setData(overview);
      setSeries(daily);
      setLoading(false);
    });
  }, [partner.id, days]);

  if (loading) return <div className="loading-state"><div className="spinner lg" /></div>;
  if (!data) return null;

  return (
    <div className="overview-content">
      <div className="stats-strip four">
        <StatBox label="Conversions" value={fmt(data.conversions)} delta={data.conversionsDelta} highlight />
        <StatBox label="Conv rate" value={data.convRate + '%'} delta={data.convRateDelta} highlight />
        <StatBox label="Sessions" value={fmt(data.sessions)} delta={data.sessionsDelta} />
        <StatBox label="Pageviews" value={fmt(data.pageviews)} />
      </div>

      <div className="chart-card">
        <div className="chart-header">
          <span className="chart-title">Sessions &amp; conversions</span>
          <div className="chart-legend">
            <span className="legend-dot sessions" />Sessions
            <span className="legend-dot conversions" />Conversions
          </div>
        </div>
        <Sparkline data={series} days={days} />
      </div>

      <div className="two-col">
        <div className="info-card">
          <h4 className="card-label">Visitor breakdown</h4>
          <div className="breakdown-rows">
            <div className="breakdown-row">
              <span>New visitors</span>
              <span className="breakdown-val">{fmt(data.newVisitors)}</span>
            </div>
            <div className="breakdown-row">
              <span>Returning visitors</span>
              <span className="breakdown-val">{fmt(data.returningVisitors)}</span>
            </div>
            <div className="breakdown-row">
              <span>Clicks</span>
              <span className="breakdown-val">{fmt(data.clicks)}</span>
            </div>
          </div>
        </div>
        <div className="info-card">
          <h4 className="card-label">Conversions by goal</h4>
          {Object.keys(data.conversionsByGoal).length === 0
            ? <p className="empty-note">No conversions yet. Set up goals to start tracking.</p>
            : Object.entries(data.conversionsByGoal).map(([goalId, count]) => (
              <div key={goalId} className="breakdown-row">
                <span className="mono-sm">{goalId.slice(0, 8)}…</span>
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

function GoalsPage({ partner }) {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const loadGoals = useCallback(async () => {
    setLoading(true);
    const { data } = await getGoals(partner.id);
    setGoals(data || []);
    setLoading(false);
  }, [partner.id]);

  useEffect(() => { loadGoals(); }, [loadGoals]);

  async function handleToggle(id, active) {
    await toggleGoal(id, active);
    loadGoals();
  }

  async function handleDelete(id) {
    await deleteGoal(id);
    loadGoals();
  }

  const typeLabels = { click: 'Click', element_visible: 'Element visible', page_load: 'Page load', form_submit: 'Form submit' };

  return (
    <div className="goals-content">
      <div className="section-header">
        <div>
          <h3 className="section-title">Conversion goals</h3>
          <p className="section-sub">Define what counts as a conversion on {partner.domain}</p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add goal</button>
      </div>

      {showAdd && <AddGoalModal clientId={partner.id} onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); loadGoals(); }} />}

      {loading ? <div className="loading-state"><div className="spinner lg" /></div>
        : goals.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">◎</div>
            <h3>No goals yet</h3>
            <p>Add a conversion goal to start tracking what matters.</p>
          </div>
        ) : (
          <div className="goals-list">
            {goals.map(goal => (
              <div key={goal.id} className={`goal-row ${!goal.active ? 'inactive' : ''}`}>
                <div className="goal-info">
                  <span className="goal-name">{goal.name}</span>
                  <span className={`goal-type-pill type-${goal.type}`}>{typeLabels[goal.type]}</span>
                  <span className="goal-detail mono-sm">
                    {goal.css_selector || goal.url_pattern || '—'}
                  </span>
                </div>
                <div className="goal-actions">
                  <button className={`toggle-btn ${goal.active ? 'on' : 'off'}`} onClick={() => handleToggle(goal.id, !goal.active)}>
                    {goal.active ? 'Active' : 'Paused'}
                  </button>
                  <button className="btn-icon-danger" onClick={() => handleDelete(goal.id)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

function AddGoalModal({ clientId, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('click');
  const [selector, setSelector] = useState('');
  const [urlPattern, setUrlPattern] = useState('');
  const [matchType, setMatchType] = useState('exact');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault(); setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    if ((type === 'click' || type === 'element_visible' || type === 'form_submit') && !selector.trim()) {
      setError('CSS selector is required for this goal type'); return;
    }
    if (type === 'page_load' && !urlPattern.trim()) {
      setError('URL pattern is required for page load goals'); return;
    }
    setLoading(true);
    const { error } = await createGoal({
      clientId, name: name.trim(), type,
      cssSelector: selector.trim() || null,
      urlPattern:  urlPattern.trim() || null,
      matchType,
    });
    if (error) { setError(error.message); setLoading(false); return; }
    onCreated();
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header"><h3>Add conversion goal</h3><button className="modal-close" onClick={onClose}>✕</button></div>
        <form onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}
          <div className="field">
            <label className="field-label">Goal name</label>
            <input className="field-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Demo request, Purchase, Sign up" required autoFocus />
          </div>
          <div className="field">
            <label className="field-label">Goal type</label>
            <select className="field-input" value={type} onChange={e => setType(e.target.value)}>
              <option value="click">Click — user clicks an element</option>
              <option value="element_visible">Element visible — element scrolls into view</option>
              <option value="page_load">Page load — user lands on a URL</option>
              <option value="form_submit">Form submit — user submits a form</option>
            </select>
          </div>
          {(type === 'click' || type === 'element_visible' || type === 'form_submit') && (
            <div className="field">
              <label className="field-label">CSS selector</label>
              <input className="field-input mono" value={selector} onChange={e => setSelector(e.target.value)} placeholder="#cta-button, .buy-now, form.checkout" />
              <span className="field-hint">Any valid CSS selector — ID, class, attribute, or tag.</span>
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
                  <option value="exact">Exact — URL must match exactly</option>
                  <option value="contains">Contains — URL contains this string</option>
                  <option value="starts_with">Starts with — URL starts with this</option>
                  <option value="regex">Regex — advanced pattern matching</option>
                </select>
              </div>
            </>
          )}
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>{loading ? <span className="spinner" /> : 'Save goal'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Top pages ────────────────────────────────────────────────────────────────

function TopPagesPage({ partner, days }) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [device, setDevice] = useState(null);

  useEffect(() => {
    setLoading(true);
    getTopPages(partner.id, days, device).then(data => { setPages(data); setLoading(false); });
  }, [partner.id, days, device]);

  return (
    <div>
      <div className="section-header">
        <div><h3 className="section-title">Top pages</h3><p className="section-sub">Ranked by pageviews</p></div>
        <div className="filter-group">
          {[null, 'mobile', 'tablet', 'desktop'].map(d => (
            <button key={d || 'all'} className={`filter-btn ${device === d ? 'active' : ''}`} onClick={() => setDevice(d)}>
              {d || 'All'}
            </button>
          ))}
        </div>
      </div>
      {loading ? <div className="loading-state"><div className="spinner lg" /></div> : (
        <div className="data-table">
          <div className="table-head">
            <span className="col-url">Page</span>
            <span className="col-num">Pageviews</span>
            <span className="col-num">Sessions</span>
            <span className="col-num">Avg time</span>
            <span className="col-num">Conv rate</span>
          </div>
          {pages.length === 0 ? <div className="table-empty">No data for this period</div>
            : pages.map((p, i) => (
              <div key={i} className="table-row">
                <span className="col-url mono-sm">{p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}</span>
                <span className="col-num">{fmt(p.pageviews)}</span>
                <span className="col-num">{fmt(p.sessions)}</span>
                <span className="col-num">{p.avgTime != null ? fmtTime(p.avgTime) : '—'}</span>
                <span className="col-num">{p.convRate}%</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── Sources page ─────────────────────────────────────────────────────────────

function SourcesPage({ partner, days }) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSources(partner.id, days).then(data => { setSources(data); setLoading(false); });
  }, [partner.id, days]);

  const maxSessions = useMemo(() => Math.max(...sources.map(s => s.sessions), 1), [sources]);

  return (
    <div>
      <div className="section-header">
        <div><h3 className="section-title">Traffic sources</h3><p className="section-sub">Where your sessions come from</p></div>
      </div>
      {loading ? <div className="loading-state"><div className="spinner lg" /></div> : (
        <div className="data-table">
          <div className="table-head">
            <span className="col-source">Source</span>
            <span className="col-medium">Medium</span>
            <span className="col-bar">Sessions</span>
            <span className="col-num">Conversions</span>
            <span className="col-num">Conv rate</span>
          </div>
          {sources.length === 0 ? <div className="table-empty">No data for this period</div>
            : sources.map((s, i) => (
              <div key={i} className="table-row">
                <span className="col-source">{s.source}</span>
                <span className="col-medium"><span className={`medium-pill medium-${s.medium}`}>{s.medium}</span></span>
                <span className="col-bar">
                  <div className="bar-cell">
                    <div className="bar-fill" style={{ width: `${(s.sessions / maxSessions) * 100}%` }} />
                    <span className="bar-label">{fmt(s.sessions)}</span>
                  </div>
                </span>
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

function PathsPage({ partner, days }) {
  const [paths, setPaths] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getConversionPaths(partner.id, days).then(data => { setPaths(data); setLoading(false); });
  }, [partner.id, days]);

  const maxCount = useMemo(() => Math.max(...paths.map(p => p.count), 1), [paths]);

  return (
    <div>
      <div className="section-header">
        <div><h3 className="section-title">Conversion paths</h3><p className="section-sub">Most common page sequences leading to conversion</p></div>
      </div>
      {loading ? <div className="loading-state"><div className="spinner lg" /></div>
        : paths.length === 0 ? <div className="empty-state"><div className="empty-icon">◈</div><h3>No conversion paths yet</h3><p>Set up conversion goals and collect some data first.</p></div>
        : (
          <div className="paths-list">
            {paths.map((p, i) => (
              <div key={i} className="path-row">
                <div className="path-steps">
                  {p.path.split(' → ').map((step, j, arr) => (
                    <React.Fragment key={j}>
                      <span className="path-step mono-sm">{step}</span>
                      {j < arr.length - 1 && <span className="path-arrow">→</span>}
                    </React.Fragment>
                  ))}
                </div>
                <div className="path-bar-wrap">
                  <div className="path-bar" style={{ width: `${(p.count / maxCount) * 100}%` }} />
                </div>
                <span className="path-count">{p.count}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ─── Form analytics ───────────────────────────────────────────────────────────

function FormsPage({ partner, days }) {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getFormAnalytics(partner.id, days).then(data => { setForms(data); setLoading(false); });
  }, [partner.id, days]);

  return (
    <div>
      <div className="section-header">
        <div><h3 className="section-title">Form analytics</h3><p className="section-sub">Field-level drop-off and hesitation time</p></div>
      </div>
      {loading ? <div className="loading-state"><div className="spinner lg" /></div>
        : forms.length === 0 ? <div className="empty-state"><div className="empty-icon">◈</div><h3>No form data yet</h3><p>The tracker automatically captures form interactions once the snippet is installed.</p></div>
        : forms.map((form, i) => (
          <div key={i} className="form-card">
            <div className="form-card-header">
              <span className="mono-sm">{form.url.replace(/^https?:\/\/[^/]+/, '') || '/'}</span>
              <span className="form-id mono-sm">{form.formId}</span>
              <div className="form-stats">
                <span>{form.starts} started</span>
                <span>{form.submits} submitted</span>
                <span className="conv-rate-pill">{form.completionRate}% completion</span>
              </div>
            </div>
            <div className="field-rows">
              <div className="field-row-head">
                <span>Field</span><span>Type</span><span>Interactions</span><span>Avg time</span>
              </div>
              {form.fields.map((field, j) => (
                <div key={j} className="field-row">
                  <span className="mono-sm">{field.name}</span>
                  <span className="field-type-tag">{field.type}</span>
                  <span>{field.interactions}</span>
                  <span>{field.avgTime != null ? fmtTime(field.avgTime) : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

// ─── Return latency ───────────────────────────────────────────────────────────

function LatencyPage({ partner, days }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getVisitorLatency(partner.id, days).then(d => { setData(d); setLoading(false); });
  }, [partner.id, days]);

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
  const [showDelete, setShowDelete] = useState(false);
  async function handleDelete() {
    const { error } = await deletePartner(partner.id);
    if (!error) onDeleted();
  }
  return (
    <div className="settings-section">
      <div className="settings-group">
        <h4 className="settings-label">Partner details</h4>
        <div className="settings-row"><span className="settings-key">Name</span><span className="settings-val">{partner.name}</span></div>
        <div className="settings-row"><span className="settings-key">Domain</span><span className="settings-val mono">{partner.domain}</span></div>
        <div className="settings-row"><span className="settings-key">Partner ID</span><span className="settings-val mono">{partner.id}</span></div>
        <div className="settings-row"><span className="settings-key">Created</span><span className="settings-val">{new Date(partner.created_at).toLocaleDateString()}</span></div>
      </div>
      <div className="settings-group danger-zone">
        <h4 className="settings-label danger">Danger zone</h4>
        <p className="settings-warn">Deleting a partner removes all associated event data permanently. This cannot be undone.</p>
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
