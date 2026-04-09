# CROhub

## Folder structure — every file and where it lives

```
crohub/                        ← this is the repo root
├── api/
│   └── ingest.js              ← Vercel reads this automatically as /api/ingest
├── src/
│   ├── App.js
│   ├── App.css
│   ├── index.js
│   └── lib/
│       ├── supabase.js
│       └── snippet.js
├── public/
│   └── index.html
├── supabase/
│   └── 001_events_schema.sql  ← run this in Supabase SQL editor
├── .env.example               ← copy to .env.local, fill in your keys
├── .gitignore
├── package.json
├── vercel.json
└── README.md
```

---

## Step 1 — Supabase

1. Go to **supabase.com** → New project. Wait for it to finish provisioning.

2. In the left sidebar go to **SQL Editor**.

3. Copy the entire contents of `supabase/001_events_schema.sql` and paste it into the editor. Click **Run**.

4. Go to **Authentication → Providers** and confirm **Email** is toggled on.

5. Go to **Authentication → Users** → click **Invite user** → enter your email address. You'll get an email — click it and set a password. This is your dashboard login.

6. Go to **Settings → API** and keep this page open. You'll need:
   - **Project URL** — looks like `https://abcdefg.supabase.co`
   - **anon public** key — long JWT string
   - **service_role** key — click the eye icon to reveal it

---

## Step 2 — GitHub

1. Create a **new empty repo** on github.com (no README, no .gitignore — completely empty).

2. On your computer, open a terminal in this folder (the one containing `package.json`) and run:

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git push -u origin main
```

---

## Step 3 — Vercel

1. Go to **vercel.com** → **Add New Project** → **Import Git Repository** → select your repo.

2. Vercel will detect it as a Create React App. **Do not click Deploy yet.**

3. Expand **Environment Variables** and add all five of these:

```
REACT_APP_SUPABASE_URL        →  your Supabase Project URL
REACT_APP_SUPABASE_ANON_KEY   →  your anon public key
REACT_APP_INGEST_URL          →  https://YOUR-PROJECT.vercel.app/api/ingest
SUPABASE_URL                  →  your Supabase Project URL (same as above)
SUPABASE_SERVICE_ROLE_KEY     →  your service_role key
```

> For `REACT_APP_INGEST_URL` you don't know your Vercel URL yet.
> Put a placeholder for now (e.g. `https://placeholder.vercel.app/api/ingest`),
> deploy once, then come back and update it with the real URL and redeploy.

4. Click **Deploy**.

5. Once deployed, copy your Vercel URL (e.g. `https://crohub-abc123.vercel.app`).

6. Go back to Vercel → your project → **Settings → Environment Variables** → update `REACT_APP_INGEST_URL` to `https://YOUR-REAL-URL.vercel.app/api/ingest`. Then go to **Deployments** → click the three dots on the latest deploy → **Redeploy**.

7. Go to **Supabase → Authentication → URL Configuration** → set **Site URL** to your Vercel URL.

---

## Step 4 — Verify it works

1. Open your Vercel URL in a browser. You should see the CROhub login page.

2. Sign in with the email you set up in Step 1.

3. Click **+ Add partner**, enter a name and domain (e.g. `acme.com`).

4. Click into the partner → **Tracking snippet** tab → **Copy snippet**.

5. Paste the snippet into the `<head>` of any page on that domain.

6. Visit that page, then open **DevTools → Network tab** and filter for `ingest`.
   Within 10 seconds you should see a request with a **202** response.

7. Confirm data arrived in Supabase → **SQL Editor**:
```sql
SELECT type, count(*) FROM events GROUP BY type;
```

---

## Environment variables reference

| Variable | Used by | What it is |
|---|---|---|
| `REACT_APP_SUPABASE_URL` | Browser (React) | Your Supabase project URL |
| `REACT_APP_SUPABASE_ANON_KEY` | Browser (React) | Public anon key — safe to expose |
| `REACT_APP_INGEST_URL` | Browser (React) | URL the tracker posts events to |
| `SUPABASE_URL` | Server (api/ingest.js) | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server (api/ingest.js) | Secret key — never exposed to browser |

---

## How the snippet domain lock works

The generated snippet contains a hard-coded domain check at the very top:

```js
var ALLOWED = 'acme.com';
var host = location.hostname.toLowerCase().replace(/^www\./, '');
if (host !== ALLOWED && !host.endsWith('.' + ALLOWED)) return;
```

If this check fails, the function exits immediately — no events, no network requests, nothing.

| Domain visiting the page | Fires? |
|---|---|
| `acme.com` | ✓ Yes |
| `www.acme.com` | ✓ Yes |
| `shop.acme.com` | ✓ Yes (subdomain) |
| `otheracme.com` | ✗ No |
| `evil.com` | ✗ No |
