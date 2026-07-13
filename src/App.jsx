// ============================================================================
// AI509 × HSF — Tès Evalyasyon Atelye
// Single-file React SPA. Three views: Quiz, Results, Dashboard (admin + HSF).
// Hash routing, no router lib. All participant-facing text in Haitian Creole.
// ============================================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Clock, Lock, RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown,
  CheckCircle2, XCircle, Award, Users, TrendingUp, Trash2,
} from 'lucide-react';
import logo from './assets/logo.png';
import quizData from './assets/questions.json';

// ---------------------------------------------------------------------------
// CONFIG — hardcoded literals. NEVER read quiz size / threshold from the JSON
// meta block; only the `questions` array and `meta.sections` names are used.
// ---------------------------------------------------------------------------
const CONFIG = {
  perQuiz: 20,
  timerSeconds: 45,
  passThreshold: 14, // 14/20 = 70%
  totalQuestions: 75,
  pin: '5090',
};

const QUESTIONS = quizData.questions;
const SECTION_NAMES = quizData.meta.sections; // { A: "Kisa AI ye...", ... } — display names only
const SECTION_KEYS = Object.keys(SECTION_NAMES).sort(); // A..J

// ---------------------------------------------------------------------------
// Official participant whitelist (12). The name field validates against this
// via accent/case/space-insensitive matching; it is never shown to the user.
// ---------------------------------------------------------------------------
const PARTICIPANTS = [
  'Participant 1',
  'Participant 2',
  'Participant 3',
  'Participant 4',
  'Participant 5',
  'Participant 6',
  'Participant 7',
  'Participant 8',
  'Participant 9',
  'Participant 10',
  'Participant 11',
  'Participant 12',
];

// lowercase, trim, collapse inner whitespace, strip accents (è→e, ç→c, ...).
function normalizeName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const PARTICIPANT_LOOKUP = new Map(PARTICIPANTS.map((n) => [normalizeName(n), n]));

// Returns the official spelling if the input matches a whitelist name, else null.
function matchParticipant(input) {
  return PARTICIPANT_LOOKUP.get(normalizeName(input)) || null;
}

// ---------------------------------------------------------------------------
// Quiz deadline gate. Open through 15 Jiyè 2026 (all day); closed from the 16th.
// Compares calendar date only (year/month/day), not time.
// ---------------------------------------------------------------------------
const QUIZ_DEADLINE_NUM = 2026 * 10000 + 6 * 100 + 15; // July = month index 6
const QUIZ_DEADLINE_LABEL = '15 Jiyè 2026';
function isQuizClosed(now = new Date()) {
  const today = now.getFullYear() * 10000 + now.getMonth() * 100 + now.getDate();
  return today > QUIZ_DEADLINE_NUM;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build one participant's quiz: >=1 from each section A-J, fill to perQuiz
// randomly from the rest of the bank (no repeats), then shuffle the order.
function buildQuiz() {
  const bySection = {};
  for (const q of QUESTIONS) {
    (bySection[q.section] ||= []).push(q);
  }
  const chosen = [];
  const usedIds = new Set();

  // 1 guaranteed question from each section
  for (const key of SECTION_KEYS) {
    const pool = bySection[key];
    if (pool && pool.length) {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      chosen.push(pick);
      usedIds.add(pick.id);
    }
  }

  // Fill remaining slots from the whole bank at random
  const remaining = shuffle(QUESTIONS.filter((q) => !usedIds.has(q.id)));
  for (const q of remaining) {
    if (chosen.length >= CONFIG.perQuiz) break;
    chosen.push(q);
    usedIds.add(q.id);
  }

  return shuffle(chosen).slice(0, CONFIG.perQuiz);
}

// Fetch all prior results for a given participant name (case-insensitive, trimmed).
// Used to enforce the attempt policy: one attempt if passed, two if failed first.
async function findResultsByName(name) {
  const norm = normalizeName(name);
  try {
    const { keys } = await window.storage.list('results:', true);
    const items = await Promise.all(
      keys.map(async (k) => {
        try {
          const it = await window.storage.get(k, true);
          return it ? JSON.parse(it.value) : null;
        } catch {
          return null;
        }
      }),
    );
    return items.filter(
      (r) => r && typeof r.name === 'string' && normalizeName(r.name) === norm,
    );
  } catch {
    return [];
  }
}

// Attempt policy: one attempt if the participant passes; if they fail the first
// time they get a second (and final) attempt. Returns a block message, or null
// if the participant may (re)take the test given their prior results.
function attemptBlockMessage(prior) {
  if (prior.some((r) => r.passed)) {
    return 'Ou deja pase tès la. Ou pa ka reprann li ankò.';
  }
  if (prior.length >= 2) {
    return 'Ou deja itilize 2 esè ou yo. Ou pa ka reprann tès la ankò.';
  }
  return null;
}

function formatDateTime(iso) {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Shared UI
// ---------------------------------------------------------------------------
function LogoBlock() {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <img src={logo} alt="AI509" className="h-10 w-10 rounded-md object-cover shrink-0" />
      <div className="leading-tight min-w-0">
        <div className="font-bold text-[var(--gold)] text-lg">AI509</div>
        <div className="italic text-[var(--paper)] text-xs truncate">Aprann AI An Kreyòl</div>
      </div>
    </div>
  );
}

function Header({ children }) {
  return (
    <header className="bg-[var(--near-black)] text-[var(--white)] px-4 py-3 shadow-md">
      <div className="max-w-3xl mx-auto flex items-center gap-3">
        <LogoBlock />
        {children}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Countdown hook — uses Date.now() delta so it keeps running if the tab blurs.
// `runKey` restarts the timer; `paused` freezes it (during answer reveal).
// ---------------------------------------------------------------------------
function useCountdown(seconds, runKey, paused, onExpire) {
  const [remaining, setRemaining] = useState(seconds);
  const startRef = useRef(0);
  const firedRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    // Reset the displayed value to full whenever a new question loads.
    setRemaining(seconds);
  }, [runKey, seconds]);

  useEffect(() => {
    if (paused) return;
    // Anchor the clock at the moment the timer actually becomes active, so
    // elapsed is measured from question start — not from initial mount.
    startRef.current = Date.now();
    firedRef.current = false;
    let raf;
    const tick = () => {
      const elapsed = (Date.now() - startRef.current) / 1000;
      const rem = Math.max(0, seconds - elapsed);
      setRemaining(rem);
      if (rem <= 0) {
        if (!firedRef.current) {
          firedRef.current = true;
          onExpireRef.current && onExpireRef.current();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [runKey, paused, seconds]);

  return remaining;
}

// Circular timer. Gold fill draining to red in the last 10 seconds.
function CircularTimer({ remaining, total }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, remaining / total));
  const danger = remaining <= 10;
  const color = danger ? 'var(--red)' : 'var(--gold)';
  return (
    <div className="relative" style={{ width: 96, height: 96 }}>
      <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90">
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--paper-dark)" strokeWidth="8" />
        <circle
          cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: 'stroke 0.3s linear' }}
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center font-bold text-2xl"
        style={{ color }}
      >
        {Math.ceil(remaining)}
      </div>
    </div>
  );
}

// ===========================================================================
// VIEW 1 — QUIZ
// ===========================================================================
function QuizFlow({ onComplete }) {
  const [name, setName] = useState('');
  const [checking, setChecking] = useState(false);
  const [blockMsg, setBlockMsg] = useState(null); // set when prior results bar another attempt
  const [started, setStarted] = useState(false);
  const startedNameRef = useRef(''); // official whitelist spelling used for the result
  const [quiz, setQuiz] = useState([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [locked, setLocked] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const answersRef = useRef([]); // [{ section, correct }]
  const timers = useRef([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => () => clearTimers(), []);

  // The official whitelist spelling if the typed name matches, else null.
  const matched = matchParticipant(name);

  const beginQuiz = (officialName) => {
    startedNameRef.current = officialName;
    setQuiz(buildQuiz());
    answersRef.current = [];
    setIndex(0);
    setSelected(null);
    setLocked(false);
    setRevealed(false);
    setStarted(true);
  };

  // Proactively check a matched participant's prior results so we can replace the
  // start button with the appropriate block message (already passed / used both tries).
  useEffect(() => {
    if (!matched) { setBlockMsg(null); return; }
    let cancelled = false;
    setChecking(true);
    (async () => {
      const prior = await findResultsByName(matched);
      if (!cancelled) { setBlockMsg(attemptBlockMessage(prior)); setChecking(false); }
    })();
    return () => { cancelled = true; };
  }, [matched]);

  // Re-verify at click time to guard against a result saved in another tab meanwhile.
  const startQuiz = async () => {
    if (!matched || checking) return;
    setChecking(true);
    const prior = await findResultsByName(matched);
    setChecking(false);
    const msg = attemptBlockMessage(prior);
    if (msg) { setBlockMsg(msg); return; }
    beginQuiz(matched);
  };

  const q = quiz[index];

  const advance = useCallback((correct) => {
    answersRef.current.push({ section: q.section, correct });
    clearTimers();
    if (index + 1 < quiz.length) {
      setIndex((i) => i + 1);
      setSelected(null);
      setLocked(false);
      setRevealed(false);
    } else {
      // Compute final result
      const answers = answersRef.current;
      const score = answers.filter((a) => a.correct).length;
      const sectionBreakdown = {};
      for (const a of answers) {
        const b = (sectionBreakdown[a.section] ||= { shown: 0, correct: 0 });
        b.shown += 1;
        if (a.correct) b.correct += 1;
      }
      onComplete({
        name: startedNameRef.current,
        score,
        total: quiz.length,
        passed: score >= CONFIG.passThreshold,
        timestamp: new Date().toISOString(),
        sectionBreakdown,
      });
    }
  }, [index, quiz, q, name, onComplete]);

  const resolve = useCallback((optionIndex) => {
    if (locked || !q) return;
    setLocked(true);
    setSelected(optionIndex); // null = timed out
    const correct = optionIndex === q.correctIndex;
    timers.current.push(setTimeout(() => setRevealed(true), 600));
    timers.current.push(setTimeout(() => advance(correct), 1200));
  }, [locked, q, advance]);

  const handleTimeout = useCallback(() => resolve(null), [resolve]);

  const remaining = useCountdown(CONFIG.timerSeconds, index, !started || locked, handleTimeout);

  // ---- Step 1: name entry ----
  if (!started) {
    const showNotInList = name.trim().length > 0 && !matched;
    const canStart = !!matched && !checking && !blockMsg;
    return (
      <div className="min-h-full flex flex-col">
        <Header />
        <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8">
          <div className="bg-[var(--white)] rounded-2xl shadow-lg p-6 sm:p-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--near-black)]">
              Tès Evalyasyon Atelye AI509
            </h1>
            <p className="mt-1 text-[var(--near-black)]/70 font-medium">
              Haitian Sports Foundation — Jiyè 2026
            </p>

            <label className="block mt-8 text-sm font-semibold text-[var(--near-black)]/80">
              Antre non konplè ou
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canStart) startQuiz(); }}
              placeholder="Non ak siyati"
              className="mt-2 w-full rounded-xl border-2 border-[var(--paper-dark)] bg-[var(--paper)] px-4 py-3 text-lg outline-none focus:border-[var(--gold)]"
            />

            {showNotInList && !blockMsg && (
              <p className="mt-3 text-sm font-semibold text-[var(--red)]">
                Non sa a pa nan lis patisipan yo. Eseye ankò oswa kontakte fasilitatè a.
              </p>
            )}

            {blockMsg ? (
              <div className="mt-6 rounded-xl border-2 border-[var(--red)] bg-[var(--red)]/10 px-4 py-4 text-sm font-semibold text-[var(--red)]">
                {blockMsg}
              </div>
            ) : (
              <button
                onClick={startQuiz}
                disabled={!canStart}
                className="mt-6 w-full rounded-xl bg-[var(--gold)] px-6 py-4 text-lg font-bold text-[var(--near-black)] transition disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99]"
              >
                {checking ? 'Ap verifye...' : 'Kòmanse tès la'}
              </button>
            )}

            <p className="mt-6 text-sm leading-relaxed text-[var(--near-black)]/60">
              Tès la gen {CONFIG.perQuiz} kesyon. Ou gen {CONFIG.timerSeconds} sègonn pou chak
              kesyon. Ou pa ka tounen dèyè.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // ---- Step 2: question screen ----
  const optionClass = (i) => {
    const base =
      'w-full text-left rounded-xl border-2 px-4 py-4 flex items-center gap-3 transition font-medium';
    if (!locked) {
      return `${base} bg-[var(--white)] border-[var(--paper-dark)] text-[var(--near-black)] hover:border-[var(--gold)] active:scale-[0.99]`;
    }
    if (!revealed) {
      return i === selected
        ? `${base} bg-[var(--gold)] border-[var(--gold)] text-[var(--near-black)]`
        : `${base} bg-[var(--paper-dark)]/40 border-transparent text-[var(--near-black)]/40`;
    }
    // revealed
    if (i === q.correctIndex) {
      return `${base} bg-[var(--green)] border-[var(--green)] text-white`;
    }
    if (i === selected) {
      return `${base} bg-[var(--red)] border-[var(--red)] text-white`;
    }
    return `${base} bg-[var(--paper-dark)]/40 border-transparent text-[var(--near-black)]/40`;
  };

  return (
    <div className="min-h-full flex flex-col">
      {/* Question header: logo · Kesyon N / 20 · Section badge */}
      <Header>
        <div className="flex-1 text-center font-semibold text-sm sm:text-base">
          Kesyon {index + 1} / {quiz.length}
        </div>
        <span className="shrink-0 rounded-full bg-[var(--red)] px-3 py-1 text-xs font-bold text-white">
          Seksyon {q.section}
        </span>
      </Header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 flex flex-col">
        <div className="flex justify-center py-2">
          <CircularTimer remaining={remaining} total={CONFIG.timerSeconds} />
        </div>

        <h2 className="mt-4 text-xl sm:text-2xl font-bold text-center leading-relaxed text-[var(--near-black)]">
          {q.question}
        </h2>

        <div className="mt-6 space-y-3">
          {q.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => resolve(i)}
              disabled={locked}
              className={optionClass(i)}
            >
              <span className="grid place-items-center h-8 w-8 shrink-0 rounded-full border-2 border-current text-sm font-bold">
                {'ABCD'[i]}
              </span>
              <span className="flex-1">{opt}</span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}

// ===========================================================================
// VIEW 2 — RESULTS
// ===========================================================================

// Reusable score detail: badge + score + greeting + motivational + section
// breakdown. Shared by the participant results page and the dashboard modal.
function ScoreDetail({ result }) {
  const passed = result.passed;
  const firstName = result.name.split(/\s+/)[0] || result.name;
  return (
    <>
      <div className="bg-[var(--white)] rounded-2xl shadow-lg p-6 sm:p-8 text-center">
        <div
          className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-lg font-extrabold text-white"
          style={{ background: passed ? 'var(--green)' : 'var(--red)' }}
        >
          {passed ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
          {passed ? 'PASE' : 'PA PASE'}
        </div>

        <div className="mt-6 text-6xl sm:text-7xl font-black text-[var(--near-black)]">
          {result.score} <span className="text-[var(--near-black)]/40">/ {result.total}</span>
        </div>

        <p className="mt-4 text-xl font-bold text-[var(--near-black)]">
          {passed ? `Bòn travay, ${firstName}!` : `Kontinye pratike, ${firstName}.`}
        </p>

        <p className="mt-3 text-[var(--near-black)]/70 leading-relaxed max-w-xl mx-auto">
          {passed
            ? 'Ou demontre yon konpreyansyon solid nan kontni atelye a. Sètifika ou ap jwenn nan men HSF pandan seremoni gradyasyon an nan mwa Out 2026.'
            : 'Pa dekouraje. Kontakte AI509 si ou gen kesyon. Kontinye pratike ak zouti yo chak jou.'}
        </p>
      </div>

      {/* Section breakdown */}
      <div className="mt-6 bg-[var(--white)] rounded-2xl shadow-lg p-4 sm:p-6">
        <h3 className="font-bold text-[var(--near-black)] mb-3">Rezilta pa seksyon</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--near-black)]/60 border-b border-[var(--paper-dark)]">
              <th className="py-2">Seksyon</th>
              <th className="py-2 text-right">Kòrèk</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(result.sectionBreakdown).sort().map((key) => {
              const b = result.sectionBreakdown[key];
              return (
                <tr key={key} className="border-b border-[var(--paper-dark)]/50">
                  <td className="py-2 pr-2">
                    <span className="font-bold">{key}</span>
                    <span className="text-[var(--near-black)]/60"> — {SECTION_NAMES[key]}</span>
                  </td>
                  <td className="py-2 text-right font-semibold whitespace-nowrap">
                    {b.correct} / {b.shown}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Modal overlay showing a participant's full score detail (dashboards).
function ResultDetailModal({ result, onClose }) {
  if (!result) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div className="w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-white font-bold text-lg truncate pr-3">{result.name}</div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full bg-[var(--gold)] px-4 py-1.5 text-sm font-bold text-[var(--near-black)]"
          >
            Fèmen
          </button>
        </div>
        <ScoreDetail result={result} />
        <p className="mt-4 text-center text-sm text-white/70">
          {formatDateTime(result.timestamp)}
        </p>
      </div>
    </div>
  );
}

// Presentational. The save itself happens in App's handleComplete (so it fires
// the instant the quiz ends, independent of this view rendering); saveStatus and
// onRetry are passed in.
function ResultsView({ result, saveStatus, onRetry }) {
  // Direct navigation to #results with no attempt → go to name entry. This runs
  // as an effect (not during render) so a transient null can't bounce a real
  // result back to the name screen.
  useEffect(() => {
    if (!result) window.location.hash = '#quiz';
  }, [result]);

  if (!result) return null;

  return (
    <div className="min-h-full flex flex-col">
      <Header />
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8">
        <ScoreDetail result={result} />

        {saveStatus === 'error' && (
          <div className="mt-6 rounded-xl border-2 border-[var(--red)] bg-[var(--red)]/10 p-4 text-center">
            <p className="text-sm font-semibold text-[var(--red)]">
              Nou pa t ka anrejistre rezilta ou a. Tcheke koneksyon entènèt ou epi eseye ankò.
            </p>
            <button
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--red)] px-5 py-2.5 text-sm font-bold text-white active:scale-[0.99]"
            >
              <RefreshCw size={16} /> Reeseye anrejistreman
            </button>
          </div>
        )}
        {saveStatus === 'saving' && (
          <p className="mt-6 text-center text-sm text-[var(--near-black)]/50">
            Ap anrejistre rezilta ou...
          </p>
        )}
        {saveStatus === 'saved' && (
          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-sm font-semibold text-[var(--green)]">
            <CheckCircle2 size={16} /> Rezilta ou anrejistre
          </p>
        )}

        <button
          onClick={() => { window.location.hash = '#quiz'; }}
          className="mt-6 w-full rounded-xl bg-[var(--gold)] px-6 py-4 text-lg font-bold text-[var(--near-black)] active:scale-[0.99]"
        >
          Tounen nan Paj Akèy
        </button>

        <p className="mt-6 text-center text-sm text-[var(--near-black)]/50">
          contact@ai-509.com · ai-509.com
        </p>
      </main>
    </div>
  );
}

// ===========================================================================
// VIEW 3 — DASHBOARD (shared data hook + admin / HSF variants)
// ===========================================================================
function useResults() {
  const [results, setResults] = useState(null); // null = loading
  const load = useCallback(async () => {
    try {
      const { keys } = await window.storage.list('results:', true);
      const items = await Promise.all(
        keys.map(async (key) => {
          try {
            const item = await window.storage.get(key, true);
            return item ? JSON.parse(item.value) : null;
          } catch {
            return null;
          }
        }),
      );
      setResults(items.filter(Boolean));
    } catch {
      setResults([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { results, reload: load };
}

function summarize(results) {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  const avg = total ? results.reduce((s, r) => s + r.score, 0) / total : 0;
  return { total, passed, failed, avg };
}

function SummaryCards({ results }) {
  const { total, passed, failed, avg } = summarize(results);
  const cards = [
    { label: 'Total patisipan', value: total, icon: Users, color: 'var(--near-black)' },
    { label: 'Pase (≥14)', value: passed, icon: CheckCircle2, color: 'var(--green)' },
    { label: 'Pa pase (<14)', value: failed, icon: XCircle, color: 'var(--red)' },
    { label: 'Mwayèn skò', value: `${avg.toFixed(1)} / 20`, icon: TrendingUp, color: 'var(--gold)' },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-[var(--white)] rounded-2xl shadow p-4">
          <div className="flex items-center gap-2 text-[var(--near-black)]/60 text-xs font-semibold">
            <c.icon size={16} style={{ color: c.color }} />
            {c.label}
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-black" style={{ color: c.color }}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultsTable({ results }) {
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const [detail, setDetail] = useState(null); // participant clicked for detail view

  const sorted = useMemo(() => {
    const arr = results.slice();
    arr.sort((a, b) => {
      let cmp = 0;
      if (sort.key === 'name') cmp = a.name.localeCompare(b.name);
      else if (sort.key === 'score') cmp = a.score - b.score;
      else cmp = new Date(a.timestamp) - new Date(b.timestamp);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [results, sort]);

  const toggle = (key) =>
    setSort((s) => (s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' }));

  const SortIcon = ({ col }) => {
    if (sort.key !== col) return <ChevronsUpDown size={14} className="opacity-40" />;
    return sort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  if (results.length === 0) {
    return (
      <div className="bg-[var(--white)] rounded-2xl shadow p-10 text-center text-[var(--near-black)]/60">
        Pa gen rezilta ankò. Patisipan yo poko pran tès la.
      </div>
    );
  }

  const Th = ({ col, children, align = 'left' }) => (
    <th className={`py-3 px-3 text-${align}`}>
      <button
        onClick={() => toggle(col)}
        className={`inline-flex items-center gap-1 font-semibold hover:text-[var(--near-black)] ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {children} <SortIcon col={col} />
      </button>
    </th>
  );

  return (
    <div className="bg-[var(--white)] rounded-2xl shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[var(--near-black)]/60 border-b border-[var(--paper-dark)] bg-[var(--paper)]">
            <tr>
              <th className="py-3 px-3 text-left">#</th>
              <Th col="name">Non Patisipan</Th>
              <Th col="score" align="right">Skò</Th>
              <th className="py-3 px-3 text-left">Rezilta</th>
              <Th col="date">Dat &amp; Lè</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr
                key={i}
                className="border-b border-[var(--paper-dark)]/40"
                style={{ borderLeft: `4px solid ${r.passed ? 'var(--green)' : 'var(--red)'}` }}
              >
                <td className="py-3 px-3 text-[var(--near-black)]/50">{i + 1}</td>
                <td className="py-3 px-3 font-medium">
                  <button
                    onClick={() => setDetail(r)}
                    className="text-left font-semibold text-[var(--near-black)] underline decoration-[var(--gold)] decoration-2 underline-offset-2 hover:text-[var(--gold)]"
                  >
                    {r.name}
                  </button>
                </td>
                <td className="py-3 px-3 text-right font-bold whitespace-nowrap">{r.score} / {r.total}</td>
                <td className="py-3 px-3">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-bold text-white"
                    style={{ background: r.passed ? 'var(--green)' : 'var(--red)' }}
                  >
                    {r.passed ? 'Pase' : 'Pa pase'}
                  </span>
                </td>
                <td className="py-3 px-3 whitespace-nowrap text-[var(--near-black)]/70">
                  {formatDateTime(r.timestamp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ResultDetailModal result={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

// Admin-only: average % correct per section across the whole cohort.
function SectionPerformance({ results }) {
  const rows = SECTION_KEYS.map((key) => {
    let shown = 0, correct = 0;
    for (const r of results) {
      const b = r.sectionBreakdown && r.sectionBreakdown[key];
      if (b) { shown += b.shown; correct += b.correct; }
    }
    const pct = shown ? (correct / shown) * 100 : 0;
    return { key, pct, shown };
  });

  return (
    <div className="bg-[var(--white)] rounded-2xl shadow p-4 sm:p-6">
      <h3 className="font-bold text-[var(--near-black)] mb-4">Pèfòmans pa seksyon (tout patisipan)</h3>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.key}>
            <div className="flex justify-between text-sm mb-1">
              <span>
                <span className="font-bold">{row.key}</span>
                <span className="text-[var(--near-black)]/60"> — {SECTION_NAMES[row.key]}</span>
              </span>
              <span className="font-semibold whitespace-nowrap ml-2">
                {row.shown ? `${Math.round(row.pct)}%` : '—'}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-[var(--paper-dark)]/60 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${row.pct}%`, background: 'var(--green)' }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Admin-only: whitelist participants who have not yet submitted a result.
function PendingParticipants({ results }) {
  const done = new Set(results.map((r) => normalizeName(r.name)));
  const pending = PARTICIPANTS.filter((n) => !done.has(normalizeName(n)));
  return (
    <div className="bg-[var(--white)] rounded-2xl shadow p-4 sm:p-6">
      <h3 className="font-bold text-[var(--near-black)] mb-3">
        Patisipan ki poko pran tès la ({pending.length})
      </h3>
      {pending.length === 0 ? (
        <p className="text-sm text-[var(--near-black)]/60">
          Tout {PARTICIPANTS.length} patisipan yo pran tès la.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {pending.map((n) => (
            <li key={n} className="flex items-center gap-2 text-sm text-[var(--near-black)]/80">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--red)] shrink-0" />
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- 3A: Admin dashboard (PIN protected) ----
function PinGate({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (lockUntil <= now) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [lockUntil, now]);

  const locked = lockUntil > now;
  const secondsLeft = Math.ceil((lockUntil - now) / 1000);

  const submit = () => {
    if (locked) return;
    if (pin === CONFIG.pin) {
      onUnlock();
      return;
    }
    const next = attempts + 1;
    setAttempts(next);
    setPin('');
    if (next >= 3) {
      const t = Date.now();
      setNow(t);
      setLockUntil(t + 60000);
      setAttempts(0);
    }
  };

  return (
    <div className="min-h-full flex flex-col">
      <Header />
      <main className="flex-1 max-w-md w-full mx-auto px-4 py-12">
        <div className="bg-[var(--white)] rounded-2xl shadow-lg p-8 text-center">
          <div className="inline-grid place-items-center h-14 w-14 rounded-full bg-[var(--near-black)] text-[var(--gold)]">
            <Lock size={26} />
          </div>
          <h1 className="mt-4 text-xl font-bold">Tableau de Bò — Aksè Admin</h1>
          <p className="mt-1 text-sm text-[var(--near-black)]/60">Antre kòd PIN 4 chif la</p>

          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            disabled={locked}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            className="mt-6 w-full text-center tracking-[0.6em] text-2xl rounded-xl border-2 border-[var(--paper-dark)] bg-[var(--paper)] px-4 py-3 outline-none focus:border-[var(--gold)] disabled:opacity-50"
            placeholder="••••"
          />

          {locked ? (
            <p className="mt-3 text-sm font-semibold text-[var(--red)]">
              Twòp esè. Tann {secondsLeft} sègonn.
            </p>
          ) : attempts > 0 ? (
            <p className="mt-3 text-sm font-semibold text-[var(--red)]">
              Kòd pa kòrèk. {3 - attempts} esè ki rete.
            </p>
          ) : null}

          <button
            onClick={submit}
            disabled={locked || pin.length !== 4}
            className="mt-6 w-full rounded-xl bg-[var(--gold)] px-6 py-3 font-bold text-[var(--near-black)] disabled:opacity-40"
          >
            Antre
          </button>
        </div>
      </main>
    </div>
  );
}

function AdminDashboard() {
  const [unlocked, setUnlocked] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [clearError, setClearError] = useState(null);
  const { results, reload } = useResults();

  if (!unlocked) return <PinGate onUnlock={() => setUnlocked(true)} />;

  const openConfirm = () => { setClearError(null); setConfirmClear(true); };
  const closeConfirm = () => { if (!clearing) { setConfirmClear(false); setClearError(null); } };

  const clearAllResults = async () => {
    setClearing(true);
    setClearError(null);
    try {
      const { keys } = await window.storage.list('results:', true);
      // If the backend rejects the token, every del throws 403 and nothing is
      // deleted (fail-closed) — surface that rather than silently "succeeding".
      await Promise.all(keys.map((k) => window.storage.del(k, true, { adminToken })));
      setClearing(false);
      setConfirmClear(false);
      setAdminToken('');
      reload();
    } catch (err) {
      setClearing(false);
      if (err && (err.status === 401 || err.status === 403)) {
        setClearError('Token admin an pa kòrèk oswa efasman dezaktive sou sèvè a.');
      } else {
        setClearError('Yon erè rive pandan efasman an. Eseye ankò.');
      }
    }
  };

  return (
    <div className="min-h-full flex flex-col">
      <Header>
        <div className="flex-1 text-right leading-tight">
          <div className="font-bold text-sm sm:text-base">Tableau de Bò — Rezilta Tès</div>
          <div className="text-[var(--paper)]/70 text-xs">Atelye HSF · Jiyè 2026</div>
          <div className="text-[var(--paper-dark)] text-xs">Dat Limit Tès: {QUIZ_DEADLINE_LABEL}</div>
        </div>
      </Header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 space-y-5">
        <div className="flex justify-end">
          <button
            onClick={reload}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--near-black)] px-4 py-2 text-sm font-semibold text-[var(--gold)]"
          >
            <RefreshCw size={16} /> Aktyalize
          </button>
        </div>

        {results === null ? (
          <div className="text-center py-10 text-[var(--near-black)]/50">Chajman...</div>
        ) : (
          <>
            <SummaryCards results={results} />
            <ResultsTable results={results} />
            <SectionPerformance results={results} />
            <PendingParticipants results={results} />

            {/* Danger zone */}
            <div className="bg-[var(--white)] rounded-2xl shadow p-4 sm:p-6 border-2 border-[var(--red)]/30">
              <h3 className="font-bold text-[var(--red)] mb-1">Zòn danje</h3>
              <p className="text-sm text-[var(--near-black)]/60 mb-3">
                Efase tout rezilta yo pou tout tan. Aksyon sa a pa ka defèt.
              </p>
              <button
                onClick={openConfirm}
                disabled={results.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--red)] px-4 py-2 text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 size={16} /> Efase tout rezilta
              </button>
            </div>
          </>
        )}
      </main>

      {/* Confirmation modal */}
      {confirmClear && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={closeConfirm}
        >
          <div
            className="w-full max-w-md bg-[var(--white)] rounded-2xl shadow-lg p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="inline-grid place-items-center h-14 w-14 rounded-full bg-[var(--red)]/10 text-[var(--red)]">
              <Trash2 size={26} />
            </div>
            <h3 className="mt-4 text-lg font-bold text-[var(--near-black)]">Efase tout rezilta?</h3>
            <p className="mt-2 text-sm text-[var(--near-black)]/60">
              W ap efase {results ? results.length : 0} rezilta pou tout tan. Aksyon sa a pa ka defèt.
            </p>

            <label className="block mt-5 text-left text-xs font-semibold text-[var(--near-black)]/70">
              Token admin (ADMIN_TOKEN)
            </label>
            <input
              type="password"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              placeholder="Token sekrè sèvè a"
              className="mt-1 w-full rounded-xl border-2 border-[var(--paper-dark)] bg-[var(--paper)] px-4 py-2.5 outline-none focus:border-[var(--red)]"
            />

            {clearError && (
              <p className="mt-3 text-sm font-semibold text-[var(--red)]">{clearError}</p>
            )}

            <div className="mt-6 flex gap-3">
              <button
                onClick={closeConfirm}
                disabled={clearing}
                className="flex-1 rounded-xl bg-[var(--paper-dark)] px-4 py-3 font-bold text-[var(--near-black)] disabled:opacity-50"
              >
                Anile
              </button>
              <button
                onClick={clearAllResults}
                disabled={clearing}
                className="flex-1 rounded-xl bg-[var(--red)] px-4 py-3 font-bold text-white disabled:opacity-50"
              >
                {clearing ? 'Ap efase...' : 'Wi, efase tout'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- 3B: HSF read-only dashboard (no PIN, auto-refresh 60s) ----
function HsfDashboard() {
  const { results, reload } = useResults();

  useEffect(() => {
    const id = setInterval(reload, 60000);
    return () => clearInterval(id);
  }, [reload]);

  return (
    <div className="min-h-full flex flex-col">
      <Header>
        <div className="flex-1 text-right leading-tight">
          <div className="font-bold text-sm sm:text-base">Tableau Ofisyèl — Haitian Sports Foundation</div>
          <div className="text-[var(--paper)]/70 text-xs">Atelye Fòmasyon Fòmatè · Jiyè 2026</div>
        </div>
      </Header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 space-y-5">
        {results === null ? (
          <div className="text-center py-10 text-[var(--near-black)]/50">Chajman...</div>
        ) : (
          <>
            <SummaryCards results={results} />
            <ResultsTable results={results} />
          </>
        )}
        <p className="text-center text-xs text-[var(--near-black)]/50 pt-2">
          Done sa yo aktyalize otomatikman. Pwodwi pa AI509 · ai-509.com
        </p>
      </main>
    </div>
  );
}

// ===========================================================================
// Quiz-closed screen (shown for #quiz after the deadline). Dashboards stay open.
// ===========================================================================
function QuizClosed() {
  return (
    <div className="min-h-full flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="bg-[var(--paper)] rounded-2xl shadow-lg p-8 sm:p-10 max-w-xl w-full text-center border border-[var(--paper-dark)]">
          <h1 className="text-2xl sm:text-3xl font-black text-[var(--red)]">Tès la Fèmen</h1>
          <p className="mt-4 text-[var(--near-black)]/80 leading-relaxed">
            Peryòd evalyasyon atelye AI509 × HSF a fini. Dat limit pou pran tès la te{' '}
            {QUIZ_DEADLINE_LABEL}. Si ou panse gen yon erè, kontakte AI509 dirèkteman nan{' '}
            <a href="mailto:contact@ai-509.com" className="font-bold text-[var(--gold)] underline">
              contact@ai-509.com
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  );
}

// ===========================================================================
// ROOT — hash routing
// ===========================================================================
function getRoute() {
  const h = window.location.hash.replace(/^#/, '');
  if (h === 'results') return 'results';
  if (h === 'dashboard') return 'dashboard';
  if (h === 'dashboard-hsf') return 'dashboard-hsf';
  return 'quiz';
}

export default function App() {
  const [route, setRoute] = useState(getRoute());
  const [result, setResult] = useState(null);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle'|'saving'|'saved'|'error'
  const saveKeyRef = useRef(null); // collision-proof key, reused across retries

  useEffect(() => {
    const onHash = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const persist = useCallback(async (res) => {
    setSaveStatus('saving');
    try {
      await window.storage.set(saveKeyRef.current, JSON.stringify(res), true);
      setSaveStatus('saved');
    } catch (err) {
      console.warn('Storage save failed:', err);
      setSaveStatus('error');
    }
  }, []);

  const handleComplete = (res) => {
    // Persist immediately on completion — independent of ResultsView rendering —
    // and set the route directly (don't rely on the async hashchange) so the
    // results screen always mounts with the result present.
    saveKeyRef.current = `results:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setResult(res);
    setRoute('results');
    window.location.hash = '#results';
    persist(res);
  };

  const retrySave = () => { if (result) persist(result); };

  switch (route) {
    case 'results':
      return <ResultsView result={result} saveStatus={saveStatus} onRetry={retrySave} />;
    case 'dashboard':
      return <AdminDashboard />;
    case 'dashboard-hsf':
      return <HsfDashboard />;
    default:
      // Date gate applies only to the quiz view; dashboards/results stay open.
      return isQuizClosed()
        ? <QuizClosed />
        : <QuizFlow key="quiz" onComplete={handleComplete} />;
  }
}
