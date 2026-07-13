# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A mobile-first React SPA (Vite) to evaluate Train-the-Trainer participants for the AI509 × HSF
workshop in Haiti. Three hash-routed views: **Quiz** (`#quiz`), **Results** (`#results`),
and **Dashboard** — admin (`#dashboard`, PIN) and HSF read-only (`#dashboard-hsf`). All
participant-facing text is Haitian Creole.

## Commands

Node is installed via Homebrew but is **not on the default PATH** — prefix commands with it:

```bash
export PATH="/opt/homebrew/bin:$PATH"
npm install
npm run dev       # Vite dev server on http://localhost:5173
npm run build     # production build to dist/
npm run preview   # serve the production build
```

There is **no test runner or linter configured**. The serverless backend
(`api/storage.js`) is a pure function and can be unit-tested by importing its default export
and calling it with a mock `req`/`res` while stubbing `global.fetch` (Upstash) and
`process.env` — see how it was exercised previously (stub `fetch` to record Redis command
arrays and return `{ result }`).

Browser verification uses the **Claude Preview MCP** (`preview_start` with `.claude/launch.json`
→ the `quiz-dev` config), not raw `npm run dev` in Bash. Note: a backgrounded preview tab
throttles `setTimeout`, so driving a full 20-question run via `preview_eval` must be done in
short batches (the quiz auto-advances on a ~1.2s timer).

## Architecture

**Single-file app.** `src/App.jsx` contains everything — all three views, hash routing, quiz
logic, and dashboards — organized with section comments. `src/main.jsx` is the entry and
imports `src/storage.js` for its side effect before rendering.

**Storage abstraction is the spine.** The entire app is written against a
`window.storage.{set,get,list,del}(key, value, shared)` contract. `src/storage.js` installs a
shim on `window.storage` (only if the host hasn't provided one) that:
1. calls the serverless backend at `POST /api/storage`, and
2. **falls back to namespaced `localStorage`** on any network/backend error.

This is why the app runs fully under `vite dev` with no backend — but in that mode the
dashboards only see results saved in that same browser. Real cross-device sharing requires the
deployed backend (or `vercel dev`). When changing persistence, preserve this `window.storage`
contract rather than calling `fetch`/`localStorage` directly from components.

**Backend.** `api/storage.js` is a Vercel serverless function over Upstash Redis (REST).
Keys are namespaced `quiz:shared:<key>` and tracked in a Redis SET `quiz:shared:__index__` so
`list` avoids `KEYS` scans. It enforces: result-key format `^results:\d+(-[a-z0-9]+)?$` on
set/get/del (this also blocks clobbering the index), a value-size cap, generic error responses
(details logged server-side only), and an `x-admin-token` header (constant-time compared to
`ADMIN_TOKEN`) required for `del`. `del` from the client (`storage.del(key, true, { adminToken })`)
does **not** fall back to localStorage on 401/403 — auth failures surface to the admin.

**Config is hardcoded, not read from data.** `CONFIG` in `src/App.jsx`
(`perQuiz: 20, timerSeconds: 45, passThreshold: 14, pin: '5090'`) is authoritative. The quiz
JSON's `meta` block (`perQuiz`, `passThreshold`) is intentionally **ignored** — only
`questions` and `meta.sections` (section display names) are used.

**Quiz selection** (`buildQuiz`): take ≥1 question from each of the 10 sections A–J, fill the
rest to 20 at random, then shuffle. **Timer** uses `Date.now()` deltas (not interval counts)
so it survives tab blur; the countdown clock is anchored when the timer becomes active, per
question.

**Participant gating.** A hidden whitelist (`PARTICIPANTS`, 12 names) validates the name field
via `normalizeName` (lowercase, collapse spaces, strip accents via NFD). On match the
**official spelling** is saved, not what was typed. Attempt policy (`attemptBlockMessage`):
pass once → done; fail first attempt → one more try; a prior pass or two attempts → blocked.
This is enforced against the shared store, so it's only reliable once the backend is deployed.

**Date gate.** `isQuizClosed()` compares calendar date only against `QUIZ_DEADLINE_NUM`
(`YYYY*10000 + M*100 + D`, month 0-indexed). Applies to `#quiz` only — dashboards and results
stay open after the deadline. To change the deadline edit `QUIZ_DEADLINE_NUM` /
`QUIZ_DEADLINE_LABEL`.

**Styling.** Tailwind is loaded via the **Play CDN** in `index.html` (no PostCSS/build step);
brand colors are CSS variables in `:root` there (`--near-black`, `--gold`, `--red`, `--paper`,
`--paper-dark`, `--white`, `--green`), referenced from JSX as `bg-[var(--gold)]` etc.

## Deployment

Vercel (Vite preset). `vercel.json` rewrites everything except `/api/*` to `index.html` for
hash routing. Env vars: `KV_REST_API_URL`, `KV_REST_API_TOKEN`, and `ADMIN_TOKEN` (a long
random secret; without it deletes are disabled server-side). HSF share link is
`<url>/#dashboard-hsf`.

## Conventions

- All user-facing strings are Haitian Creole. The workshop test is referred to as **"Tès"**
  (an earlier "Kèz" spelling was fully renamed — keep new copy consistent).
- Assets live in `src/assets/` (`logo.png`, `questions.json`) and are ES-imported. The logo is
  intentionally downscaled (~50 KB) for mobile; don't reintroduce the multi-MB original.
