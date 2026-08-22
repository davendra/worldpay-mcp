# Troubleshooting

The problems a first-time user actually hits, in the order they tend to hit them. Each entry says what you see, why, and what to do. File paths refer to the upstream source.

- [The client says the server failed to start](#the-client-says-the-server-failed-to-start)
- [`npx -y @worldpay/worldpay-mcp` fails inside a clone of this repo](#npx--y-worldpayworldpay-mcp-fails-inside-a-clone-of-this-repo)
- [The server starts but every tool call fails](#the-server-starts-but-every-tool-call-fails)
- [`Payment failed with status 401`](#payment-failed-with-status-401)
- [`Payment failed with status 400`](#payment-failed-with-status-400)
- [`Either sessionHref or tokenHref must be provided`](#either-sessionhref-or-tokenhref-must-be-provided)
- [`SyntaxError: Unexpected token` in an error message](#syntaxerror-unexpected-token-in-an-error-message)
- [Where is the log file?](#where-is-the-log-file)
- [The HTTP server answers `/healthz` but `/mcp` returns 400](#the-http-server-answers-healthz-but-mcp-returns-400)
- [Docker: nothing listens on 3001](#docker-nothing-listens-on-3001)
- [The HTTP server won't start, or returns 401](#the-http-server-wont-start-or-returns-401)
- [Tests: `npm test` fails with an ESM or path-alias error](#tests-npm-test-fails-with-an-esm-or-path-alias-error)
- [A tool call hangs](#a-tool-call-hangs)

---

## The client says the server failed to start

**Symptom.** Claude Code `/mcp` shows `worldpay` as failed; Cursor shows a red dot; Claude Desktop shows nothing.

**Check, in order:**

1. **Can the command run at all?** In a terminal (not inside a clone of this repo — see the next entry), pipe an MCP `initialize` into the exact command your client uses:
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}' \
   | WORLDPAY_USERNAME=x WORLDPAY_PASSWORD=x WORLDPAY_URL=https://try.access.worldpay.com MERCHANT_ENTITY=x \
     npx -y @worldpay/worldpay-mcp
   ```
   A healthy server answers on one line with `"serverInfo":{"name":"Worldpay","version":"1.1.0"}`. No output, or a shell error, means the launch itself is broken. If `npx` can't be found, the client's `PATH` differs from your shell's — give the client an absolute path to `npx` (`which npx`) or to `node` plus `dist/server-stdio.js`. (For a local build, `npx -y @modelcontextprotocol/inspector --cli node dist/server-stdio.js --method tools/list` lists the nine tools.)
2. **Node version.** `node --version` ≥ 20. Desktop clients sometimes pick up a different Node than your terminal (nvm, Homebrew vs system). Use an absolute path to the right `node`.
3. **Stdout is clean?** A stdio MCP server must write nothing but protocol to stdout. The server's logger writes to a file, so this is fine out of the box — but if you've wrapped it in a script that `echo`es, the client will reject the handshake.
4. **Read the client's own log.** Claude Code: `~/.claude/logs/` (or the `--mcp-debug` flag); Claude Desktop: `~/Library/Logs/Claude/mcp*.log` (macOS); Cursor: Output panel → MCP.

---

## `npx -y @worldpay/worldpay-mcp` fails inside a clone of this repo

**Symptom.** `sh: worldpay-mcp: command not found`, or your MCP client reports `CONNECTION_CLOSED` — but the same command works from any other directory.

**Cause.** When run from a directory whose `package.json` is itself `@worldpay/worldpay-mcp`, `npx` resolves the **local** project instead of downloading the published package, then looks for its `worldpay-mcp` bin in `node_modules/.bin`, which a project never links for itself.

**Fix.** Inside a clone, run the built entrypoint directly — `node dist/server-stdio.js` — and point your client at that. Use the `npx` form from anywhere else. (Verified: Claude Code connects with both forms from a neutral directory and fails with `npx` from inside the clone.)

---

## The server starts but every tool call fails

**Symptom.** `tools/list` works; any call returns an `isError` result.

**Cause.** In older builds the required env vars were unvalidated. This build **validates them at start-up** (`src/config.ts`) and fails fast; if a tool call still fails, credentials are wrong or a var is set but empty.

| Message | Missing |
|---|---|
| `… failed: Username and password required for Basic auth` (prefix varies by tool; **not** `create_hosted_payment`, which instead returns `Hosted Payment failed: … status 401`) | `WORLDPAY_USERNAME` or `WORLDPAY_PASSWORD` |
| Start-up error `Missing required environment variable(s): …` (exit 1) | any of `WORLDPAY_URL` / `WORLDPAY_USERNAME` / `WORLDPAY_PASSWORD` / `MERCHANT_ENTITY` |
| Start-up error `WORLDPAY_URL is not a valid URL` | malformed `WORLDPAY_URL` |
| Worldpay 401 on a call | wrong username/password for the environment |

**Fix.** Set all four. For `npx` launches, pass them in the client config's `env` block — the server does not read your shell's `.env` unless it is in the process's working directory.

---

## `Payment failed with status 401`

**Cause.** Worldpay rejected the Basic credentials. Either the username/password pair is wrong, or it is a pair for a different environment (sandbox credentials against a production `WORLDPAY_URL`, or vice versa).

**Fix.** Confirm the pair in the [Worldpay Dashboard](https://dashboard.worldpay.com/); confirm `WORLDPAY_URL` matches the environment the credentials were issued for. No trailing slash on the URL.

---

## `Payment failed with status 400`

**Cause.** Worldpay's validation rejected the request. The error string contains Worldpay's body, which usually names the field, e.g. `"errorName":"bodyDoesNotMatchSchema"` with a `validationErrors` array.

**Common specifics:**

- **`value.amount`** — amounts are **minor units**. `10.00` is invalid; `1000` is £10.
- **`merchant.entity`** — `MERCHANT_ENTITY` unset or not the entity your API user is permitted to use.
- **`sessionHref` expired or already used** — Checkout sessions are single-use and short-lived; mint a new one.
- **Date format** — payment queries want `YYYY-MM-DDTHH:MM:SSZ`; the payout query wants `YYYY-MM-DD`.
- **ACP `allowance.currency`** — lowercase (`usd`), and `max_amount` in minor units.

---

## `Either sessionHref or tokenHref must be provided`

**Cause.** `take_guest_payment` / `create_worldpay_token` were called with neither instrument. The schema marks both optional, so the SDK's validation passes and the server throws (`src/api/worldpay.ts`, `createRequest`).

**Fix.** Supply exactly one. If the model keeps omitting it, say in your prompt where the href comes from ("use the sessionHref returned by the Checkout form").

---

## `SyntaxError: Unexpected token` in an error message

**Cause.** Worldpay (or something in between — a proxy, a captive portal) returned a non-JSON body, and the server's `response.json()` threw before the status check could produce a clean message.

**Fix.** Hit `WORLDPAY_URL` directly with `curl -i` from the same machine to see what is actually answering. Corporate proxies and VPN login pages are the usual culprits.

---

## Where is the log file?

`worldpay-mcp.log` is written to the **current working directory of the server process** (`src/utils/logger.ts` uses a relative filename). That is:

| Launched by | Log lands in |
|---|---|
| `npx` in your terminal | the directory you ran it from |
| Claude Code (`claude mcp add` or `.mcp.json`) | the project directory Claude Code is open in |
| Claude Desktop | the app's working directory (often `/` or your home directory on macOS) — set `"cwd"` in the server config if your client supports it |
| Cursor | the workspace root |
| Docker | `/app` inside the container (lost on container removal unless you mount it) |

It is `.gitignore`d, so it won't be committed — but it will appear in your repo folder under Claude Code and Cursor. `find . -name worldpay-mcp.log` if in doubt. Contents are sensitive; see [security](security.md#the-log-file).

---

## The HTTP server answers `/healthz` but `/mcp` returns 400

**Cause.** Streamable HTTP requires a session. The first request must be an `initialize` **without** an `Mcp-Session-Id` header; the response carries `Mcp-Session-Id`, which every later request must send back. A `POST /mcp` with no session header and a non-initialize body is answered by the SDK with `400` and body `Bad Request: Server not initialized`. (The message `Invalid or missing session ID` comes from the GET/DELETE handler, not POST.)

**Fix.** Use an MCP client that implements Streamable HTTP rather than raw `curl`; or, for a smoke test:

```bash
curl -s -D - http://localhost:3001/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

and reuse the `mcp-session-id` header it returns. Concurrent sessions are supported (each gets its own server instance); sessions live in memory and vanish on restart. Remember every `/mcp` request also needs `Authorization: Bearer $MCP_AUTH_TOKEN`.

---

## Docker: nothing listens on 3001

**Cause.** The image's `CMD` runs the **stdio** server (`node dist/server-stdio.js`). `EXPOSE 3001` in the Dockerfile is not used by the default command. The upstream README's "available on port 3001" refers to the HTTP entrypoint, which the image doesn't start by default.

**Fix.** For stdio, run with `-i` and let your MCP client talk to the container's stdin/stdout. For HTTP, override the command:

```bash
docker run --rm -p 3001:3001 --env-file .env worldpay/mcp node dist/server-http.js
```

Note also that the original upstream README built the image as `worldpay/mcp` but ran `localhost/worldpay/mcp:latest`; use the same tag for both.

---

## The HTTP server won't start, or returns 401

**Symptom.** `node dist/server-http.js` exits immediately, or `/mcp` returns `401 Unauthorized`.

**Cause & fix.**
- **Exits with `MCP_AUTH_TOKEN is required …`** — the HTTP transport is fail-closed: set a strong token (`export MCP_AUTH_TOKEN=$(openssl rand -hex 32)`) before starting. stdio needs no token.
- **`/mcp` → 401** — send `Authorization: Bearer $MCP_AUTH_TOKEN`. `/healthz` and `/readyz` are intentionally open and need no token.
- **`/mcp` → 403** — DNS-rebinding protection rejected the `Host` header. Reach the server on its bind address (default `127.0.0.1:3001`), or add the host you use to `MCP_ALLOWED_HOSTS`.
- **`503 Server session limit reached`** — `MCP_MAX_SESSIONS` (default 100) is exhausted; idle sessions free up after `MCP_SESSION_TTL_MS`.

---

## Tests: `npm test` fails with an ESM or path-alias error

**Expected.** On a clean clone, `npm install && npm test` passes all five suites without flags (verified on Node 22; CI covers 20 and 22) (`ts-jest` with `moduleNameMapper` generated from `tsconfig` paths in `jest.config.ts`).

**If it doesn't:**

- `Cannot find module '@/…'` → you ran `jest` from a different directory; run `npm test` from the repo root so `<rootDir>` resolves.
- `SyntaxError: Cannot use import statement outside a module` → an old global `jest` is being used instead of the project's; use `npm test` or `npx jest`.
- `fetch is not defined` → Node < 18. Upgrade.

---

## A tool call hangs

**Cause.** Every outbound call now has a timeout (`WORLDPAY_TIMEOUT_MS`, default 30s), so a hung call fails with a timeout error rather than blocking forever. If calls are slow or timing out, the Worldpay endpoint is likely unreachable (wrong `WORLDPAY_URL`, firewall, DNS).

**Fix.** Check reachability with `curl -m 10 -I "$WORLDPAY_URL"`; lower or raise `WORLDPAY_TIMEOUT_MS` as needed; for autonomous agents, also set a per-call deadline in the client.
