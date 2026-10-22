/**
 * Per-source lockout for failed authentication. A source that fails
 * MAX_FAILS times within WINDOW_MS is locked out (429, even with a valid
 * token) for an escalating period: 1 min, 5 min, 30 min, then 1 h.
 * One noisy source therefore cannot lock out the legitimate clients.
 * State is in memory (reset on restart) and bounded in size.
 */
const WINDOW_MS = 60_000;
const MAX_FAILS = 10;
const LOCK_STEPS_MS = [60_000, 5 * 60_000, 30 * 60_000, 60 * 60_000];
const STRIKE_DECAY_MS = 60 * 60_000;
const MAX_SOURCES = 10_000;

interface SourceState {
  fails: number[];
  strikes: number;
  lockedUntil: number;
  lastSeen: number;
}

export class AuthLockout {
  private readonly sources = new Map<string, SourceState>();

  /** Seconds remaining if `source` is locked out, else 0. */
  lockedFor(source: string, now = Date.now()): number {
    const s = this.sources.get(source);
    return s && s.lockedUntil > now ? Math.ceil((s.lockedUntil - now) / 1000) : 0;
  }

  /** Record a failed attempt. Returns true if this failure triggered a new lockout. */
  fail(source: string, now = Date.now()): boolean {
    this.prune(now);
    const s = this.sources.get(source) ?? { fails: [], strikes: 0, lockedUntil: 0, lastSeen: now };
    if (now - s.lastSeen > STRIKE_DECAY_MS && s.lockedUntil <= now) s.strikes = 0;
    s.lastSeen = now;
    s.fails = s.fails.filter((t) => now - t < WINDOW_MS);
    s.fails.push(now);
    let locked = false;
    if (s.fails.length >= MAX_FAILS) {
      s.lockedUntil = now + LOCK_STEPS_MS[Math.min(s.strikes, LOCK_STEPS_MS.length - 1)]!;
      s.strikes++;
      s.fails = [];
      locked = true;
    }
    this.sources.set(source, s);
    return locked;
  }

  private prune(now: number): void {
    if (this.sources.size < MAX_SOURCES) return;
    for (const [k, s] of this.sources) if (s.lockedUntil <= now && now - s.lastSeen > WINDOW_MS) this.sources.delete(k);
    if (this.sources.size >= MAX_SOURCES) this.sources.clear();
  }
}
