# Claude Desktop

Give the Claude desktop app the Worldpay tools so a non-technical colleague can ask "did the Henderson payment go through?" in a chat window.

## 1. Prerequisites

- [Claude Desktop](https://claude.ai/download) (macOS or Windows) with MCP support.
- Node 20+ installed system-wide. Desktop apps don't see shell-only installs (nvm); if in doubt, install Node from [nodejs.org](https://nodejs.org/) or `brew install node`.
- Sandbox credentials: username, password, merchant entity.

## 2. Edit the config file

Claude Desktop → **Settings → Developer → Edit Config** opens the file:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

Add a `worldpay` entry (merge into `mcpServers` if the object already exists):

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

Claude Desktop does not expand `${VAR}` placeholders, so the values go in the file. Protect the file accordingly — it is readable by your user account only, but it now contains API credentials.

**If `npx` isn't found** when the app launches the server (common on macOS), use absolute paths:

```json
{
  "mcpServers": {
    "worldpay": {
      "command": "/opt/homebrew/bin/npx",
      "args": ["-y", "@worldpay/worldpay-mcp"],
      "env": { "WORLDPAY_USERNAME": "…", "WORLDPAY_PASSWORD": "…", "WORLDPAY_URL": "https://try.access.worldpay.com", "MERCHANT_ENTITY": "…" }
    }
  }
}
```

(`which npx` in a terminal tells you the path.) Or point at a local build: `"command": "/opt/homebrew/bin/node", "args": ["/absolute/path/to/worldpay-mcp/dist/server-stdio.js"]`.

## 3. Restart and confirm

Quit and reopen Claude Desktop. In a new chat, the **tools** icon (🔧 / slider icon under the message box) should list nine Worldpay tools. Click it to see them and to toggle individual tools off.

## 4. First call — read-only

> Search my Worldpay payments from the 1st of this month and tell me how many were authorised.

Claude asks permission to use `query_payments_by_date` the first time; choose **Allow for this chat**. An empty result on a fresh sandbox is still a successful call.

## 5. Approval policy

Claude Desktop prompts per tool, per chat, with "allow once / allow for this chat" choices. Recommended habit:

- **Allow for this chat:** the four `query_*` tools.
- **Allow once, every time:** `take_guest_payment`, `manage_payment`, `create_worldpay_token`, `create_hosted_payment`, `create_delegate_token`.

Or simply disable the money-moving tools in the tools menu for users who only need to look things up.

## 6. Where things land

- **Log:** `worldpay-mcp.log` in the server's working directory, which for a desktop-launched process is typically your home directory or `/`. Check with `find ~ -maxdepth 2 -name worldpay-mcp.log`. See [security → the log file](../security.md#the-log-file).
- **App logs (for debugging a failed start):** macOS `~/Library/Logs/Claude/mcp-server-worldpay.log` and `mcp.log`.

## Remove

Delete the `worldpay` block from `claude_desktop_config.json` and restart the app.
