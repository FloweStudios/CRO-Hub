import React, { useState, useEffect, useCallback } from 'react';
import { supabase, signIn, signOut, onAuthChange, getPartners, createPartner, deletePartner, getPartnerStats } from './lib/supabase';
import { generateSnippet } from './lib/snippet';
import './App.css';

const INGEST_URL = process.env.REACT_APP_INGEST_URL || 'https://your-project.vercel.app/api/ingest';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: { subscription } } = onAuthChange(s => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (loading) return <Splash />;
  return session ? <Dashboard session={session} /> : <Login />;
}

function Splash() {
  return (
    <div className="splash">
      <div className="splash-mark">
        <span className="logotype">CRO<em>hub</em></span>
      </div>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
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

function Dashboard({ session }) {
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('partners');
  const [activePartner, setActivePartner] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadPartners = useCallback(async () => {
    setLoading(true);
    const { data } = await getPartners();
    setPartners(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadPartners(); }, [loadPartners]);

  function openPartner(partner) { setActivePartner(partner); setView('partner-detail'); }
  function goBack() { setView('partners'); setActivePartner(null); }

  return (
    <div className="dash-root">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="logotype sm">CRO<em>hub</em></span>
        </div>
        <nav className="sidebar-nav">
          <button className={`nav-item ${view === 'partners' || view === 'partner-detail' ? 'active' : ''}`} onClick={goBack}>
            <IconGrid /> Partners
          </button>
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
          <PartnersPage partners={partners} loading={loading} onOpen={openPartner} onCreated={loadPartners} showCreate={showCreate} setShowCreate={setShowCreate} />
        )}
        {view === 'partner-detail' && activePartner && (
          <PartnerDetail partner={activePartner} onBack={goBack} onDeleted={() => { goBack(); loadPartners(); }} />
        )}
      </main>
    </div>
  );
}

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
      {showCreate && (
        <CreatePartnerModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); onCreated(); }} />
      )}
      {loading ? (
        <div className="loading-state"><div className="spinner lg" /></div>
      ) : partners.length === 0 ? (
        <EmptyState onAdd={() => setShowCreate(true)} />
      ) : (
        <div className="partner-grid">
          {partners.map(p => <PartnerCard key={p.id} partner={p} onClick={() => onOpen(p)} />)}
        </div>
      )}
    </div>
  );
}

function PartnerCard({ partner, onClick }) {
  const [stats, setStats] = useState(null);
  useEffect(() => { getPartnerStats(partner.id).then(setStats); }, [partner.id]);

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
        <div className="stat"><span className="stat-value">{stats ? fmt(stats.pageviews) : '—'}</span><span className="stat-label">Pageviews</span></div>
        <div className="stat"><span className="stat-value">{stats ? fmt(stats.clicks) : '—'}</span><span className="stat-label">Clicks</span></div>
        <div className="stat"><span className="stat-value">30d</span><span className="stat-label">Period</span></div>
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

function CreatePartnerModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
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
        <div className="modal-header">
          <h3>Add partner</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}
          <div className="field">
            <label className="field-label">Partner name</label>
            <input className="field-input" value={name} onChange={e => setName(e.target.value)} placeholder="Acme Corporation" required autoFocus />
          </div>
          <div className="field">
            <label className="field-label">Website domain</label>
            <input className="field-input mono" value={domain} onChange={e => setDomain(e.target.value)} placeholder="acme.com" required />
            <span className="field-hint">Without https:// or www — subdomains are included automatically.</span>
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

function PartnerDetail({ partner, onBack, onDeleted }) {
  const [copied, setCopied] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [stats, setStats] = useState(null);
  const [tab, setTab] = useState('snippet');

  useEffect(() => { getPartnerStats(partner.id).then(setStats); }, [partner.id]);

  const snippet = generateSnippet({
    clientId: partner.id,
    domain: partner.domain,
    secretKey: partner.secret_key,
    ingestUrl: INGEST_URL,
  });

  function copySnippet() {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleDelete() {
    const { error } = await deletePartner(partner.id);
    if (!error) onDeleted();
  }

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

      <div className="stats-strip">
        <div className="stat-box"><span className="stat-box-val">{stats ? fmt(stats.pageviews) : '—'}</span><span className="stat-box-label">Pageviews (30d)</span></div>
        <div className="stat-box"><span className="stat-box-val">{stats ? fmt(stats.clicks) : '—'}</span><span className="stat-box-label">Clicks (30d)</span></div>
        <div className="stat-box"><span className="stat-box-val mono">{partner.id}</span><span className="stat-box-label">Partner ID</span></div>
        <div className="stat-box"><span className="stat-box-val mono">{partner.domain}</span><span className="stat-box-label">Domain lock</span></div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'snippet' ? 'active' : ''}`} onClick={() => setTab('snippet')}>Tracking snippet</button>
        <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>Settings</button>
      </div>

      {tab === 'snippet' && (
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
            <div className="note-row"><span className="note-pill amber">Buffered</span><span>Events queue locally and flush every 10s — survives tab closes</span></div>
            <div className="note-row"><span className="note-pill gray">Idempotent</span><span>Retried batches are deduplicated — no duplicate data</span></div>
          </div>
        </div>
      )}

      {tab === 'settings' && (
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
      )}
    </div>
  );
}

function IconGrid() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity=".8"/>
      <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity=".8"/>
      <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".8"/>
      <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".8"/>
    </svg>
  );
}

function fmt(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
