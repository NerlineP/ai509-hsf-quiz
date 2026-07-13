// ============================================================================
// api/test.js — TEMPORARY diagnostic endpoint.
// Visit https://<your-app>/api/test in a browser.
//   - Returns JSON  -> serverless functions are deployed & /api/* is routed.
//   - Returns app HTML or 404 -> /api is NOT reaching functions (routing issue),
//     which is why the client silently falls back to localStorage.
// The has* flags report whether each env var is visible to the function WITHOUT
// exposing any secret value. Delete this file once KV is confirmed working.
// ============================================================================

export default function handler(req, res) {
  res.status(200).json({
    status: 'ok',
    node: process.version,
    // Vercel KV naming
    hasKvUrl: !!process.env.KV_REST_API_URL,
    hasKvToken: !!process.env.KV_REST_API_TOKEN,
    // Upstash native-integration naming (the backend accepts either)
    hasUpstashUrl: !!process.env.UPSTASH_REDIS_REST_URL,
    hasUpstashToken: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    hasAdminToken: !!process.env.ADMIN_TOKEN,
  });
}
