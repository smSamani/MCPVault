import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { authenticate } from "./access.js";
import { AuditLog } from "./audit.js";
import { createMcpServer } from "./server.js";
import type { Vault } from "./vault.js";

/**
 * stdio transport for local clients (any MCP client). The client
 * token arrives via the MCP_VAULT_TOKEN env var set in the client's MCP
 * config. It is verified before any MCP traffic is processed and removed from
 * process.env immediately, so child processes (osascript, security) never
 * inherit it.
 */
export async function serveStdio(vault: Vault): Promise<void> {
  const token = process.env.MCP_VAULT_TOKEN;
  delete process.env.MCP_VAULT_TOKEN;
  const audit = new AuditLog(vault.auditPath);
  const principal = authenticate(vault.loadClients(), token, "stdio");
  if (!principal) {
    audit.record({ client: "unknown", transport: "stdio", action: "auth", ok: false, detail: "invalid or missing MCP_VAULT_TOKEN" });
    process.stderr.write("mcp-vault: authentication failed: MCP_VAULT_TOKEN is missing or not valid for stdio\n");
    process.exit(1);
  }
  audit.record({ client: principal.name, transport: "stdio", action: "connect", ok: true });
  const server = createMcpServer({ vault, audit, principal });
  const transport = new StdioServerTransport();
  transport.onclose = () => process.exit(0);
  process.stdin.on("end", () => process.exit(0));
  await server.connect(transport);
}
