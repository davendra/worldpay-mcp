# Changelog

Reconstructed from the commit history and tags. Dates are commit dates.

## 1.2.0 — 2026-08-22 (this fork: security hardening & MCP standards)

Independent security audit found 22 issues (2 critical, 4 high, 10 medium, 6 low); all fixed on this fork. Full writeup in [SECURITY-HARDENING.md](SECURITY-HARDENING.md). No public tool was removed except the dead SSE entrypoint.

- **Security:** validate `manage_payment` `commandHref` is same-origin before attaching credentials (SSRF/credential-leak); require bearer auth on the HTTP `/mcp` transport (fail-closed) with DNS-rebinding protection, localhost bind, non-`*` CORS, session cap + TTL; a fresh MCP server instance per session; `create_delegate_token` accepts network tokens only (no raw PAN/CVC); redact CVC/PAN/billing/hrefs in logs; sanitize upstream error bodies.
- **Correctness/robustness:** per-call timeouts; `encodeURIComponent` on `paymentId` (now required); tighter Zod validation (amounts, currency, URLs) and rejection of both card instruments; UUID / caller-supplyable `transactionReference`; configurable `channel` and `narrative`; `pageSize` forwarded on the transaction-reference query; defensive payouts parsing; start-up env validation; version read from `package.json`.
- **Standards:** `@modelcontextprotocol/sdk` 1.26 → 1.30; MCP tool annotations on all 9 tools; transport security best practices (MCP spec 2025-11-25).
- **Packaging:** `cors` and `zod` promoted to direct dependencies; `node-fetch` removed; `main` path fixed; multi-stage, non-root Dockerfile. Tests 5 → 22.

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
