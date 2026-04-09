// Generates the short, clean embed tag shown in the dashboard.
// The actual tracker code is served by api/track/[token].js on Vercel.

export function generateSnippet({ clientId, ingestUrl }) {
  // Derive the base URL from the ingest URL
  // e.g. https://cro-hub-orpin.vercel.app/api/ingest → https://cro-hub-orpin.vercel.app
  const base = ingestUrl.replace(/\/api\/ingest$/, '');

  return `<script src="${base}/track/${clientId}.js" defer></script>`;
}
