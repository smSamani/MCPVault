import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Principal } from "./access.js";
import type { AuditLog } from "./audit.js";
import { callTool, toolsFor } from "./tools.js";
import type { Vault } from "./vault.js";

/**
 * Builds an MCP server (official TypeScript SDK) scoped to one authenticated
 * principal. Only tools the principal is permitted to use are registered, so
 * the rest are invisible in tools/list and unknown on tools/call. The server
 * offers tools only: no resources, prompts or sampling.
 */

export const SERVER_INFO = { name: "mcp-vault", version: "2.0.0" };

const INSTRUCTIONS =
  "Local password vault. Use generate_password for throwaway passwords, create_entry to generate+store a credential for a signup, " +
  "get_login_for_site to fill a login, list_entries to browse (no secrets). Never repeat passwords back to the user unless they ask; " +
  'prefer deliver="clipboard" when the user will paste the password themselves.';

export interface Session {
  vault: Vault;
  audit: AuditLog;
  principal: Principal;
}

export function createMcpServer(session: Session): McpServer {
  const server = new McpServer(SERVER_INFO, { capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS });
  for (const tool of toolsFor(session.principal)) {
    server.registerTool(
      tool.name,
      { title: tool.annotations.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      // callTool re-checks permission, validates, executes and audits.
      async (args) => callTool({ ...session, config: session.vault.loadConfig() }, tool.name, args),
    );
  }
  return server;
}
