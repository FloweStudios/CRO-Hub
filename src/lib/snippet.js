// Generates the short, clean embed tag shown in the dashboard.
// The actual tracker code is served by api/track/[token].js on Vercel.

export function generateSnippet({ clientId, ingestUrl }) {
  const base = ingestUrl.replace(/\/api\/ingest$/, '');
  return `<script src="${base}/api/${clientId}.js" defer></script>`;
}
