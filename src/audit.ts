import { appendFileSync, chmodSync } from "node:fs";
import { ensurePrivateDir, FILE_MODE } from "./fsutil.js";
import { dirname } from "node:path";

export interface AuditEvent {
  client: string;
  transport: string;
  action: string;
  ok: boolean;
  entryId?: string;
  site?: string;
  detail?: string;
}

/**
 * Append-only JSON-lines audit log. Callers pass only whitelisted,
 * non-secret fields; passwords, notes, tokens and keys are never logged.
 */
export class AuditLog {
  constructor(readonly path: string) {}

  record(ev: AuditEvent): void {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      client: ev.client,
      transport: ev.transport,
      action: ev.action,
      ok: ev.ok,
      ...(ev.entryId ? { entryId: ev.entryId } : {}),
      ...(ev.site ? { site: ev.site } : {}),
      ...(ev.detail ? { detail: ev.detail.slice(0, 200) } : {}),
    });
    try {
      ensurePrivateDir(dirname(this.path));
      appendFileSync(this.path, line + "\n", { mode: FILE_MODE });
      chmodSync(this.path, FILE_MODE);
    } catch {
      process.stderr.write("mcp-vault: warning: could not write audit log\n");
    }
  }
}
