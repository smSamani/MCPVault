import { closeSync, chmodSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { VaultError } from "./errors.js";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

/** Create a directory (recursively) and force mode 700. */
export function ensurePrivateDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  chmodSync(dir, DIR_MODE);
}

/**
 * Atomically replace `path` with `data`: write a 600 temp file in the same
 * directory, fsync, then rename over the target. Readers never observe a
 * partially written file.
 */
export function writeFileAtomic(path: string, data: string | Buffer): void {
  const dir = dirname(path);
  ensurePrivateDir(dir);
  const tmp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
  const fd = openSync(tmp, "wx", FILE_MODE);
  try {
    writeSync(fd, typeof data === "string" ? Buffer.from(data, "utf8") : data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync(tmp, FILE_MODE);
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

export function readFileIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function modeOf(path: string): number | null {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return null;
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Cross-process exclusive lock using an O_EXCL lock file. Several MCP server
 * processes (stdio clients, HTTP) may share one vault, so every
 * read-modify-write runs under this lock. Stale locks (dead pid or older than
 * 30 s) are broken.
 */
export function withFileLock<T>(lockPath: string, fn: () => T, timeoutMs = 10_000): T {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx", FILE_MODE);
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        const st = statSync(lockPath);
        const pid = Number.parseInt(readFileSync(lockPath, "utf8"), 10);
        const stale = Date.now() - st.mtimeMs > 30_000 || (Number.isInteger(pid) && pid > 0 && !pidAlive(pid));
        if (stale) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue; // lock vanished between calls; retry
      }
      if (Date.now() > deadline) throw new VaultError("vault is locked by another process; try again");
      sleepSync(25);
    }
  }
  try {
    return fn();
  } finally {
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  }
}
