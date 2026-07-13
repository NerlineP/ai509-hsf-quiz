// ============================================================================
// api/storage.js — Vercel serverless function backing window.storage
// ----------------------------------------------------------------------------
// Shared cross-device KV store on top of Upstash Redis (REST API).
// Set these env vars in Vercel (Vercel KV / Upstash both expose the first two):
//   KV_REST_API_URL    e.g. https://xxxx.upstash.io
//   KV_REST_API_TOKEN  the REST bearer token
//   ADMIN_TOKEN        secret required in the `x-admin-token` header to delete
//
// Contract (mirrors window.storage):
//   POST { action:"set",  key, value }  -> { ok:true }
//   POST { action:"get",  key }         -> { value: <string|null> }
//   POST { action:"list", prefix }      -> { keys: [<string>, ...] }
//   POST { action:"del",  key }         -> { ok:true }   (needs x-admin-token)
//
// Keys are namespaced under `quiz:shared:` and tracked in a Redis SET
// (`quiz:shared:__index__`) so list() stays O(index) without KEYS scans.
// ============================================================================

import crypto from 'node:crypto';

const NS = 'quiz:shared:';
const INDEX = NS + '__index__';

// Only result keys are writable/deletable. This also blocks a crafted
// key like "__index__" from clobbering the index SET (WRONGTYPE brick).
const KEY_RE = /^results:\d+(-[a-z0-9]+)?$/;
const MAX_VALUE_LEN = 10000; // a result JSON is ~1 KB; this is generous headroom

function isValidKey(k) {
  return typeof k === 'string' && KEY_RE.test(k);
}

// Constant-time string compare for the admin token.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function config() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV env vars not configured');
  return { url: url.replace(/\/$/, ''), token };
}

// Run a single Redis command via the Upstash REST endpoint.
async function redis(command) {
  const { url, token } = config();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`upstash ${res.status}: ${text}`);
  }
  const data = await res.json(); // { result: ... }
  return data.result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  // Guarded body parse — malformed input must not throw an unhandled 500.
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'invalid json' });
  }
  const { action, key, value, prefix } = body;

  try {
    switch (action) {
      case 'set': {
        if (!isValidKey(key)) return res.status(400).json({ error: 'invalid key' });
        const str = String(value ?? '');
        if (str.length > MAX_VALUE_LEN) return res.status(413).json({ error: 'value too large' });
        await redis(['SET', NS + key, str]);
        await redis(['SADD', INDEX, key]);
        return res.status(200).json({ ok: true });
      }
      case 'get': {
        if (!isValidKey(key)) return res.status(400).json({ error: 'invalid key' });
        const result = await redis(['GET', NS + key]);
        return res.status(200).json({ value: result ?? null });
      }
      case 'list': {
        if (prefix != null && typeof prefix !== 'string') {
          return res.status(400).json({ error: 'invalid prefix' });
        }
        const members = (await redis(['SMEMBERS', INDEX])) || [];
        const p = typeof prefix === 'string' ? prefix : '';
        return res.status(200).json({ keys: members.filter((k) => k.startsWith(p)) });
      }
      case 'del': {
        const expected = process.env.ADMIN_TOKEN;
        if (!expected) {
          return res.status(403).json({ error: 'delete disabled: ADMIN_TOKEN not configured' });
        }
        if (!safeEqual(req.headers['x-admin-token'] || '', expected)) {
          return res.status(403).json({ error: 'unauthorized' });
        }
        if (!isValidKey(key)) return res.status(400).json({ error: 'invalid key' });
        await redis(['DEL', NS + key]);
        await redis(['SREM', INDEX, key]);
        return res.status(200).json({ ok: true });
      }
      default:
        return res.status(400).json({ error: 'unknown action' });
    }
  } catch (err) {
    // Log details server-side; return a generic message to the client.
    console.error('storage error:', err);
    return res.status(500).json({ error: 'server error' });
  }
}
