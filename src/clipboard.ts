import { spawn, spawnSync } from "node:child_process";

const OSASCRIPT = "/usr/bin/osascript";

// Writes stdin to the general pasteboard and marks it with the nspasteboard.org
// "concealed" type so clipboard-history managers skip it. Prints changeCount.
const COPY_JXA = `
ObjC.import('AppKit');
ObjC.import('Foundation');
var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
var s = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
var pb = $.NSPasteboard.generalPasteboard;
pb.clearContents;
pb.setStringForType(s, 'public.utf8-plain-text');
pb.setStringForType($(''), 'org.nspasteboard.ConcealedType');
pb.changeCount;
`;

// Clears the pasteboard only if nothing new was copied since (changeCount
// unchanged), so we never wipe something the user copied afterwards.
const CLEAR_JXA = `
function run(argv) {
  ObjC.import('AppKit');
  var pb = $.NSPasteboard.generalPasteboard;
  if (String(pb.changeCount) === argv[0]) { pb.clearContents; return 'cleared'; }
  return 'skipped';
}
`;

/**
 * Copy a secret to the macOS clipboard (via stdin, never argv) and schedule
 * a detached job that clears it after `clearSeconds`. The job outlives this
 * process, so the clear still happens if the MCP server exits.
 */
export function copyToClipboard(secret: string, clearSeconds: number): void {
  if (process.platform !== "darwin") throw new Error("clipboard copy is only supported on macOS");
  const r = spawnSync(OSASCRIPT, ["-l", "JavaScript", "-e", COPY_JXA], { input: secret, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], timeout: 10_000 });
  const changeCount = (r.stdout ?? "").trim();
  if (r.status !== 0 || !/^\d+$/.test(changeCount)) throw new Error("failed to copy to clipboard");
  const secs = Math.max(5, Math.min(600, Math.floor(clearSeconds)));
  const child = spawn("/bin/sh", ["-c", `sleep ${secs}; exec ${OSASCRIPT} -l JavaScript -e "$0" "$1"`, CLEAR_JXA, changeCount], {
    detached: true,
    stdio: "ignore",
    env: { PATH: "/usr/bin:/bin" },
  });
  child.unref();
}
