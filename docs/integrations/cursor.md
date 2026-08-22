# Cursor

Put the Worldpay tools inside Cursor's agent so a developer can build and test a checkout integration — "take a £1 test payment with this session href and show me the `_links`" — without leaving the editor.

## 1. Prerequisites

- Cursor with MCP support (Settings → MCP exists).
- Node 20+ on your `PATH`.
- Sandbox credentials: username, password, merchant entity.

## 2. Add the server

Cursor reads `mcpServers` from either:

- **Project:** `.cursor/mcp.json` in the workspace root — shared with the team if committed.
- **Global:** `~/.cursor/mcp.json` — every workspace.

```json
{
  "mcpServers": {
    "worldpay": {
      "command": "npx",
      "args": ["-y", "@worldpay/worldpay-mcp"],
      "env": {
        "WORLDPAY_USERNAME": "your-username",
        "WORLDPAY_PASSWORD": "your-password",
        "WORLDPAY_URL": "https://try.access.worldpay.com",
        "MERCHANT_ENTITY": "your-merchant-entity"
      }
    }
  }
}
```

For a committed project file, don't put real credentials in it. Two options:

1. Keep `.cursor/mcp.json` credential-free and have each developer add a global `~/.cursor/mcp.json` entry with their own sandbox pair (same server name — the global entry supplies the env).
2. Point `command` at a tiny wrapper script that reads from your secret store and `exec`s the server.

**Local clone instead of npm:** `"command": "node", "args": ["/absolute/path/to/worldpay-mcp/dist/server-stdio.js"]`.

## 3. Confirm it connected

**Cursor Settings → MCP.** `worldpay` appears with a green dot and, expanded, the nine tool names. Amber means it's still starting (first `npx` run downloads the package); red means it failed — click it for the error, then see [troubleshooting](../troubleshooting.md#the-client-says-the-server-failed-to-start).

## 4. First call — read-only

Open the agent chat (⌘I / Ctrl+I) in **Agent** mode and ask:

> Use the worldpay MCP to fetch payments for the last 7 days and give me a table of outcome, amount and transaction reference.

Cursor shows the `query_payments_by_date` call and its raw JSON result in a collapsible block before the summary.

## 5. Approval policy

Cursor asks before running each MCP tool unless the tool is allow-listed. In **Settings → MCP → worldpay**, toggle the four `query_*` tools to run without confirmation if you want, and leave the rest on confirm. Do **not** enable "auto-run" globally for this server — `take_guest_payment` and `manage_payment` move money. See [security → tool approval policy](../security.md#tool-approval-policy).

## 6. A developer loop worth trying

1. Build a Checkout form with the [Worldpay Checkout SDK](https://developer.worldpay.com/products/access/checkout/web/card-only) in your app and log the `sessionHref` it returns.
2. In Cursor's agent: *"Take a £1.00 guest payment with this sessionHref for Jane Doe at 1 High St, London, GB, then settle it using the settle link from the response."*
3. Watch the two calls (`take_guest_payment` → `manage_payment`) and the `_links` chain between them — this is the exact sequence your backend will implement.

## 7. Where things land

- **Log:** `worldpay-mcp.log` in the workspace root. Add it to the project's `.gitignore`.
- **Config:** `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global).

## Remove

Delete the `worldpay` entry from the relevant `mcp.json`; Cursor picks up the change on save.
