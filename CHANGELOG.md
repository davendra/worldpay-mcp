# Changelog

Reconstructed from the upstream commit history and tags. Dates are commit dates. The server's advertised MCP version has been `1.0.3` throughout; see [docs/architecture.md](docs/architecture.md#design-properties-worth-knowing).

## 1.1.0 — 2026-02-18 (git tag; not published to npm)

- Bump version; update dependencies (#22).
- Fix SCA-reported vulnerabilities via dependency overrides (#20).
- Describe all `amount` inputs as minor units in tool schemas (#19).

## 1.0.3 — 2026-02-09 (npm `latest`)

- Release 1.0.3 — first npm publish as `@worldpay/worldpay-mcp`.
- Update `@modelcontextprotocol/sdk` to 1.26.0.
- `npx` support: package `bin` points to the stdio server; shebang added (#14, #16).
- Fix SCA vulnerabilities (2026-01-29).

## Unreleased history before 1.0.3

### 2025-12

- Add `SECURITY.md` pointing to Worldpay's HackerOne programme (#12).
- Docker image runs the stdio server (registry support) (#11); build the project before building the image (#10).
- Fix SCA vulnerabilities (#9).
- Add `/healthz` and `/readyz` endpoints to the HTTP transport (#7).

### 2025-11

- Add `create_delegate_token` — Agentic Commerce Protocol delegate payment token (#8).
- Refactor: separate transports, server and tools; introduce `MCPTool` base class and `WorldpayAPI` (#6).
- Rename package to `@worldpay/worldpay-mcp` (#4); amend `.gitignore`.
- Harden HTTP responses: Content-Security-Policy, disable `x-powered-by` (#3).
- Add `create_worldpay_token` tool; clean-up.

### 2025-09

- Add `bin` for `npx`.
- Initial version: hosted payment, guest payment, manage payment, payment queries (by date / reference / id), payout queries; stdio and HTTP transports.
- Initial commit (2025-09-24).
