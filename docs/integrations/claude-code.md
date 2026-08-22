# Claude Code

Five minutes from nothing to an agent that can query and take sandbox payments from your terminal.

## 1. Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed (`claude --version`).
- Node 20+ on your `PATH` (`node --version`).
- Sandbox credentials from the [Worldpay Dashboard](https://dashboard.worldpay.com/): username, password, merchant entity.

## 2. Add the server

One command — `-e` passes environment variables to the server process; everything after `--` is the command Claude Code will launch:

```bash
claude mcp add worldpay \
  -e WORLDPAY_USERNAME=your-username \
  -e WORLDPAY_PASSWORD=your-password \
  -e WORLDPAY_URL=https://try.access.worldpay.com \
  -e MERCHANT_ENTITY=your-merchant-entity \
  -- npx -y @worldpay/worldpay-mcp
```

Scope defaults to `local` (this project, this user). Use `-s user` to make it available in every project. Run it from your own project, not from inside a clone of the worldpay-mcp repo — see the [troubleshooting note](../troubleshooting.md#npx--y-worldpayworldpay-mcp-fails-inside-a-clone-of-this-repo).

**Prefer a checked-in config for a team?** Add `-s project` and Claude Code writes `.mcp.json` in the repo root. Keep secrets out of it by referencing variables that each developer sets in their shell:

```json
{
  "mcpServers": {
    "worldpay": {
      "command": "npx",
      "args": ["-y", "@worldpay/worldpay-mcp"],
      "env": {
        "WORLDPAY_USERNAME": "${WORLDPAY_USERNAME}",
        "WORLDPAY_PASSWORD": "${WORLDPAY_PASSWORD}",
        "WORLDPAY_URL": "https://try.access.worldpay.com",
        "MERCHANT_ENTITY": "${MERCHANT_ENTITY}"
      }
    }
  }
}
```

Claude Code expands `${VAR}` from the environment when it launches the server.

**Running from a local clone instead of npm?** Replace the command with the built entrypoint:

```bash
claude mcp add worldpay -e … -- node /absolute/path/to/worldpay-mcp/dist/server-stdio.js
```

## 3. Confirm it connected

Inside Claude Code:

```
/mcp
```

`worldpay` should show as **connected** with **9 tools**. If it shows failed, see [troubleshooting](../troubleshooting.md#the-client-says-the-server-failed-to-start).

Or from the shell, without Claude Code at all:

```bash
claude mcp get worldpay
```

## 4. First call — read-only

Ask, in plain English:

> Using the worldpay tools, list payments between 2026-08-01T00:00:00Z and today, page size 10, and summarise outcome, amount and last four digits.

Claude will call `query_payments_by_date` and summarise the JSON. On a fresh sandbox you may get an empty array — that is a successful call.

## 5. Approval policy

Claude Code asks before each tool call unless you allow it. Keep that default for the money-moving tools and pre-approve the read-only ones. In `.claude/settings.json` (project) or `~/.claude/settings.json` (user):

```json
{
  "permissions": {
    "allow": [
      "mcp__worldpay__query_payments_by_date",
      "mcp__worldpay__query_payment_by_id",
      "mcp__worldpay__query_payments_by_transaction_reference",
      "mcp__worldpay__query_account_payouts"
    ]
  }
}
```

Everything not listed — `take_guest_payment`, `manage_payment`, `create_worldpay_token`, `create_hosted_payment`, `create_delegate_token` — continues to prompt. See [security → tool approval policy](../security.md#tool-approval-policy) for why.

## 6. A complete sandbox flow

> Create a hosted payment link for £12.50.

→ `create_hosted_payment {amount: 1250}` → Claude returns the URL. Open it, pay with a [Worldpay test card](https://developer.worldpay.com/products/access/testing), then:

> Find that payment by date and tell me its outcome.

→ `query_payments_by_date` → `authorized`.

## 7. Where things land

- **Log:** `worldpay-mcp.log` in the directory Claude Code was started in (your project root). It's gitignored by this repo but not by yours — add `worldpay-mcp.log` to your project's `.gitignore`.
- **Server config:** `~/.claude.json` (local/user scope) or `.mcp.json` (project scope).

## Remove

```bash
claude mcp remove worldpay
```
