// ============================================================================
// storage.js — window.storage-compatible shim
// ----------------------------------------------------------------------------
// The app is written against the spec's shared-storage contract:
//
//   await window.storage.set(key, value, shared)   -> void
//   await window.storage.get(key, shared)          -> { value } | null
//   await window.storage.list(prefix, shared)      -> { keys: [...] }
//
// If the host platform already injected a `window.storage`, we leave it alone.
// Otherwise we install this shim, which:
//   1. tries the serverless KV backend at /api/storage (real cross-device share)
//   2. falls back to namespaced localStorage on any network/backend error
//      (so `vite dev` and single-device use work with zero backend).
// ============================================================================

const LS_PREFIX = 'ai509:'; // namespace for the localStorage fallback

// ---- localStorage fallback implementation ---------------------------------
const local = {
  set(key, value) {
    localStorage.setItem(LS_PREFIX + key, String(value));
  },
  get(key) {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw === null ? null : { value: raw };
  },
  list(prefix) {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) {
        const bare = k.slice(LS_PREFIX.length);
        if (bare.startsWith(prefix)) keys.push(bare);
      }
    }
    return { keys };
  },
  del(key) {
    localStorage.removeItem(LS_PREFIX + key);
  },
};

// ---- backend helper --------------------------------------------------------
async function callBackend(action, payload, extraHeaders) {
  const res = await fetch('/api/storage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const err = new Error(`storage backend ${res.status}`);
    err.status = res.status;
    throw err;
  }
  // A 200 that isn't JSON means /api/storage was not routed to the function
  // (e.g. the SPA rewrite served index.html). Surface it clearly instead of
  // letting res.json() throw an opaque syntax error.
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const err = new Error(
      `storage backend returned non-JSON (${res.status}, "${contentType}") — /api/storage is not hitting the serverless function`,
    );
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---- the shim --------------------------------------------------------------
const shim = {
  async set(key, value, _shared = true) {
    try {
      await callBackend('set', { key, value });
    } catch {
      local.set(key, value);
    }
  },

  async get(key, _shared = true) {
    try {
      const data = await callBackend('get', { key });
      // backend returns { value } or { value: null }
      return data && data.value != null ? { value: data.value } : null;
    } catch {
      return local.get(key);
    }
  },

  async list(prefix, _shared = true) {
    try {
      const data = await callBackend('list', { prefix });
      return { keys: Array.isArray(data?.keys) ? data.keys : [] };
    } catch {
      return local.list(prefix);
    }
  },

  // opts.adminToken is sent as the x-admin-token header (required by the backend
  // for deletes). An auth failure (401/403) is surfaced, not silently fallen back
  // to localStorage — so the admin gets real feedback when a delete is rejected.
  async del(key, _shared = true, opts = {}) {
    const headers = opts.adminToken ? { 'x-admin-token': opts.adminToken } : undefined;
    try {
      await callBackend('del', { key }, headers);
    } catch (e) {
      if (e && (e.status === 401 || e.status === 403)) throw e;
      local.del(key); // backend unreachable (e.g. local dev) — fall back
    }
  },
};

if (typeof window !== 'undefined' && !window.storage) {
  window.storage = shim;
}

export default shim;
