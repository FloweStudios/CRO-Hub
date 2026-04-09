-- ─── Clients ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clients (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  domain      TEXT NOT NULL,
  secret_key  TEXT NOT NULL,
  owner_id    UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_clients_select" ON clients FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "owner_clients_insert" ON clients FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "owner_clients_delete" ON clients FOR DELETE USING (owner_id = auth.uid());

-- ─── Events ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events (
  event_id       UUID        NOT NULL,
  client_id      TEXT        NOT NULL REFERENCES clients(id),
  session_id     UUID        NOT NULL,
  type           TEXT        NOT NULL CHECK (type IN ('pageview', 'click', 'scroll_depth')),
  ts             TIMESTAMPTZ NOT NULL,
  url            TEXT        NOT NULL,
  referrer       TEXT,
  title          TEXT,
  device_type    TEXT        CHECK (device_type IN ('mobile', 'tablet', 'desktop')),
  screen_width   INTEGER,
  screen_height  INTEGER,
  xpath          TEXT,
  tag            TEXT,
  el_id          TEXT,
  el_classes     TEXT[],
  text_content   TEXT,
  href           TEXT,
  scroll_y       INTEGER,
  viewport_x     INTEGER,
  viewport_y     INTEGER,
  el_rect_top    INTEGER,
  el_rect_left   INTEGER,
  el_rect_width  INTEGER,
  el_rect_height INTEGER,
  depth_pct      INTEGER     CHECK (depth_pct IN (25, 50, 75, 100)),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, client_id, created_at)
) PARTITION BY RANGE (created_at);

-- ─── Partitions (2025–2026) ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events_2025_01 PARTITION OF events FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE IF NOT EXISTS events_2025_02 PARTITION OF events FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE IF NOT EXISTS events_2025_03 PARTITION OF events FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE IF NOT EXISTS events_2025_04 PARTITION OF events FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE IF NOT EXISTS events_2025_05 PARTITION OF events FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE IF NOT EXISTS events_2025_06 PARTITION OF events FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE IF NOT EXISTS events_2025_07 PARTITION OF events FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE IF NOT EXISTS events_2025_08 PARTITION OF events FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE IF NOT EXISTS events_2025_09 PARTITION OF events FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE IF NOT EXISTS events_2025_10 PARTITION OF events FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE IF NOT EXISTS events_2025_11 PARTITION OF events FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE IF NOT EXISTS events_2025_12 PARTITION OF events FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE IF NOT EXISTS events_2026_01 PARTITION OF events FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS events_2026_02 PARTITION OF events FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS events_2026_03 PARTITION OF events FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS events_2026_04 PARTITION OF events FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS events_2026_05 PARTITION OF events FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS events_2026_06 PARTITION OF events FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS events_2026_07 PARTITION OF events FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS events_2026_08 PARTITION OF events FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS events_2026_09 PARTITION OF events FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS events_2026_10 PARTITION OF events FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS events_2026_11 PARTITION OF events FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS events_2026_12 PARTITION OF events FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_events_client_url_type ON events (client_id, url, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_click_xpath     ON events (client_id, url, xpath) WHERE type = 'click' AND xpath IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_session         ON events (client_id, session_id, created_at ASC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_events_select" ON events FOR SELECT
  USING (client_id IN (SELECT id FROM clients WHERE owner_id = auth.uid()));
