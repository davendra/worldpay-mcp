# Codex CLI

OpenAI's Codex CLI reads MCP servers from `~/.codex/config.toml` and supports **per-tool approval modes** in the same file — which makes it the easiest client on which to encode the "queries free, money-moving tools need a human" policy.

## 1. Prerequisites

- [Codex CLI](https://github.com/openai/codex) installed (`codex --version`).
- Node 20+ on the `PATH` Codex sees (it runs with a sanitised environment — see step 2).
- Sandbox credentials: username, password, merchant entity.

## 2. Add the server

Either the CLI:

```bash
codex mcp add worldpay \
  --env WORLDPAY_USERNAME=your-username \
  --env WORLDPAY_PASSWORD=your-password \
  --env WORLDPAY_URL=https://try.access.worldpay.com \
  --env MERCHANT_ENTITY=your-merchant-entity \
  -- npx -y @worldpay/worldpay-mcp
```

or edit `~/.codex/config.toml` directly:

```toml
[mcp_servers.worldpay]
command = "npx"
args = ["-y", "@worldpay/worldpay-mcp"]
startup_timeout_sec = 30.0

[mcp_servers.worldpay.env]
WORLDPAY_USERNAME = "your-username"
WORLDPAY_PASSWORD = "your-password"
WORLDPAY_URL = "https://try.access.worldpay.com"
MERCHANT_ENTITY = "your-merchant-entity"
```

`startup_timeout_sec` is raised from the default because the first `npx -y` run downloads the package.

**If Codex can't find `npx` or `node`:** Codex launches MCP servers with a minimal environment. Add your Node bin directory to the server's `PATH` in the same `env` table, e.g. `PATH = "/opt/homebrew/bin:/usr/bin:/bin"` (or your nvm path), or use an absolute `command`.

**Local clone:** `command = "node"`, `args = ["/absolute/path/to/worldpay-mcp/dist/server-stdio.js"]`.

## 3. Confirm it connected

```bash
codex mcp list
codex mcp get worldpay
```

Inside a `codex` session, `/mcp` lists connected servers and their tools. Tools are exposed as `worldpay.<tool_name>`.

## 4. First call — read-only

```bash
codex "Using the worldpay MCP tools, query payments for the last 30 days and summarise count by outcome."
```

Codex calls `worldpay.query_payments_by_date` and prints the summary. Empty on a fresh sandbox is fine.

## 5. Approval policy — per tool, in config

This is the recommended configuration. Read-only tools run without prompting; anything that creates or moves money requires approval every time:

```toml
[mcp_servers.worldpay.tools.take_guest_payment]
approval_mode = "approve"

[mcp_servers.worldpay.tools.manage_payment]
approval_mode = "approve"

[mcp_servers.worldpay.tools.create_worldpay_token]
approval_mode = "approve"

[mcp_servers.worldpay.tools.create_hosted_payment]
approval_mode = "approve"

[mcp_servers.worldpay.tools.create_delegate_token]
approval_mode = "approve"
```

The four `query_*` tools inherit the server default. Pair this with a Codex sandbox/approval policy that doesn't bypass MCP approvals (avoid `--yolo` / `approval_policy = "never"` for any session that has this server loaded). Rationale in [security → tool approval policy](../security.md#tool-approval-policy).

## 6. Where things land

- **Log:** `worldpay-mcp.log` in the directory you ran `codex` from.
- **Config:** `~/.codex/config.toml`. It now contains credentials; keep permissions tight (`chmod 600`).

## Remove

```bash
codex mcp remove worldpay
```
