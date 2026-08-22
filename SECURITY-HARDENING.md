# Worldpay MCP Server — Security Hardening & Standards Update

**Branch:** `fix/security-hardening` · **Base:** `main` (upstream commit `e674e2a`)
**Work dates:** 21–22 August 2026 · **Prepared by:** Davendra Patel

This document records an independent security review of the Worldpay MCP server, the defects it found ("the floors"), the fixes applied, and an update bringing the server in line with the current Model Context Protocol (MCP) standard. It is written to be shared with reviewers and stakeholders.

> **Scope note.** These are changes to the **server code**. They are kept on a separate branch from the documentation set (`docs/comprehensive-guide`), which contains no code changes. Nothing here has been merged upstream or published without review.

---

## 1. Why this work was done

The server had never had a security review. It handles real money (payments, refunds, tokenisation, payouts, agentic-commerce tokens) and holds a merchant's Worldpay API credentials, so the bar is high. Two independent AI review passes (21 Aug) plus a focused security audit (22 Aug) found **22 issues: 2 critical, 4 high, 10 medium, 6 low.** Separately, the MCP specification had advanced two revisions (2025-11-25, then 2026-07-28) and the SDK four minor versions (1.26 → 1.30) since the server was last touched (18 Feb 2026), so the server was behind the current standard on transport security, authentication, and tool metadata.

Timeline:

| Date | Activity |
|---|---|
| 2026-02-18 | Last upstream commit (`e674e2a`, v1.1.0). Repo dormant thereafter. |
| 2026-08-21 | Documentation set authored; two independent review passes over the code surfaced the first defects. |
| 2026-08-22 | Focused security audit (22 findings); this hardening branch created, fixes applied, MCP standards update, full verification. |

---

## 2. The critical and high-severity defects ("the floors")

Each was confirmed against the source and, where possible, reproduced.

### CRITICAL

**C1 — Credential exfiltration / SSRF via `manage_payment`.**
`manage_payment` accepted a caller-supplied URL (`commandHref`) and sent the merchant's Worldpay Basic-auth credentials to it, unvalidated. Because that URL is produced by a language model — which routinely reads untrusted content — a prompt-injection or a hallucinated link would POST the merchant's credentials (`Authorization: Basic …`) to an attacker's host, giving them full, persistent access to the Worldpay account. Also a server-side request forgery primitive against internal/cloud-metadata endpoints.
**Fix:** the URL is now validated to share the exact origin of the configured Worldpay base URL (and to be HTTPS) before any credential is attached; anything else is rejected.

**C2 — HTTP transport exposed every payment operation with no authentication.**
The Streamable HTTP transport had no auth on `/mcp`, defaulted CORS to `*` with credentials, and kept an unbounded in-memory session map. Anyone who could reach the port — or a web page the operator merely visited (drive-by/CSRF) — could take payments, issue refunds, and mint tokens using the server's credentials, or exhaust its memory.
**Fix:** bearer-token authentication is now required on `/mcp` (the server refuses to start the HTTP transport without one); CORS is same-origin by default and never `*`-with-credentials; sessions are capped and idle-expired; the server binds to `127.0.0.1` by default; and DNS-rebinding protection (Host/Origin validation) is enabled.

### HIGH

**H1 — One shared server instance across all HTTP sessions.**
A single MCP server object was connected to every session's transport. A second concurrent client received a 500, and in the worst case one session's payment-data response could be delivered to a different session.
**Fix:** a fresh server instance is created per session.

**H2 — Raw card number (PAN) and CVC accepted as tool arguments.**
The agentic-commerce token tool accepted a full PAN and CVC as tool inputs, which would carry cardholder data through the model's context and any transcript or log — pulling the whole pipeline into PCI-DSS scope.
**Fix:** the tool now accepts network tokens only (raw PANs rejected); the plain-CVC field was removed from that surface.

**H3 — CVC and billing data written to the log file in clear text.**
Payment calls logged their full arguments, including CVC and billing address, to an unredacted, unrotated log file. Storing CVC post-authorisation violates PCI-DSS.
**Fix:** a redaction layer masks card and billing fields everywhere before logging (belt-and-braces: at the call sites and again in the logger).

**H4 — Production HTTP server could not start (`cors` mis-declared).**
`cors` was imported at runtime but declared as a dev-only dependency, so a production install would crash the HTTP server on startup.
**Fix:** moved to runtime dependencies.

---

## 3. Medium / low defects fixed

| ID | Defect | Fix |
|---|---|---|
| M1 | Payouts query read a field that never exists → crashed on every call | Defensive parsing; no longer throws |
| M2 | Path/query injection via un-encoded `paymentId` | `encodeURIComponent` + strict format validation |
| M3 | Upstream Worldpay error bodies echoed verbatim to the model (info disclosure) | Errors now return status + correlation id only; full detail logged server-side |
| M4 | No timeout on any outbound call (hang / DoS amplifier) | Every request has a configurable timeout (default 30s) |
| M5 | Loose financial validation (negative/huge amounts; both card instruments accepted → wrong instrument charged) | Amounts constrained to non-negative integers; currency/country enforced; supplying both instruments now rejected |
| M6 | Millisecond-collision transaction reference | UUID-based reference; caller may supply their own for idempotent retries |
| M8 | Payment channel hard-coded to MOTO | Configurable channel (defaults to MOTO) |
| M9 | Dockerfile ran as root, non-reproducible install | Multi-stage build, `npm ci`, non-root `node` user |
| M10 | `zod` (the validation layer) only present transitively | Declared as a direct dependency |
| L1 | Dead "SSE" entrypoint that registered no tools | Removed |
| L2 | Non-JSON error bodies masked the real HTTP status | Parse defensively |
| L3 | No startup validation of required config | Fails fast with a clear message; also printed to stderr |
| L4 | Hosted-payment tool bypassed the shared API/credential path | Routed through the API client |
| L5 | Unused `node-fetch` dependency; wrong `main` path | Removed / corrected |
| L6 | Hard-coded statement narrative | Configurable |
| — | Advertised server version hard-coded (1.0.3) and diverging from the package | Version now read from `package.json` |
| — | `pageSize` silently dropped on the transaction-reference query | Now forwarded |

---

## 4. MCP standards update

Brought the server up to the current MCP standard:

- **SDK 1.26 → 1.30.** Protocol-version negotiation is handled by the SDK, so the server now interoperates with the current spec revision instead of the older 2025-06-18 default.
- **Tool annotations** (spec 2025-03-26+). All nine tools now declare `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`, so a client can tell the four read-only query tools apart from the money-moving ones in its approval UI. None were declared before.
- **Transport security best practices** (spec 2025-11-25). Localhost binding, DNS-rebinding protection (Host/Origin validation), bearer-token authentication that is independent of the session id (the spec forbids using sessions for authentication), non-`*` CORS, and secure random session ids with a cap and TTL.

Full-OAuth 2.1 resource-server authorization was considered and deliberately not adopted: this server authenticates to Worldpay with its own single credential set and has no per-user identity, so a bearer-token gate plus the transport hardening above is the standards-aligned fit. A note to that effect is included for the maintainers.

---

## 5. Verification

All checks run on 2026-08-22. The change set also went through an **independent adversarial security review** of the diff (a separate reviewer that tried to break the new guards); its verdict was *ship after fixes*, with no critical or high issues in the new code. The one medium (an over-strict `paymentId` character rule that risked rejecting legitimate ids) and the low-severity items it raised — credentialed-request redirect handling, error-body truncation, a bounded JSON body limit, session-limit clamping, and redacting the session/token href references — were applied and are included here.

- `npm run build` — clean (TypeScript strict).
- `npm test` — **17/17 tests pass** (the original 5, plus 12 new tests covering the SSRF/credential guard, log redaction, and schema rejection of bad amounts, non-ISO currencies, raw PANs, and path-traversal ids).
- MCP Inspector `tools/list` — exactly 9 tools, each carrying the new annotations; server version reports `1.1.0` (from `package.json`).
- HTTP transport, live: refuses to start without `MCP_AUTH_TOKEN`; `/healthz` open; `/mcp` returns 401 without/with a wrong bearer and 200 with the correct one; a spoofed `Host` header is rejected with 403 (DNS-rebinding protection).
- Missing required environment variables → fails fast with a clear message and exit code 1.
- Docker image builds (multi-stage), runs as the non-root `node` user, and serves MCP over stdio.
- `git diff main` touches only `src/`, `Dockerfile`, `.env.example`, `package.json`, and this document — verified.

---

## 6. What is intentionally left

- **`query_account_payouts` endpoint.** The tool queries the payments endpoint rather than a dedicated payouts endpoint. The crash it caused is fixed, but pointing it at the correct Worldpay payouts resource needs the payouts API contract and is left for the maintainers.
- **Full OAuth 2.1 authorization.** Not implemented, by design (see §4). The bearer-token gate is the appropriate control for a self-hosted, single-credential server.
- **Per-operation `Idempotency-Key` header.** Worldpay uses the transaction reference for idempotency; that is now caller-supplyable and collision-free. A dedicated header can be added if Worldpay's API expects one.

---

*Read-only findings were produced without running any exploit against Worldpay infrastructure. The two credential-affecting issues (C1, C2) and the two card-data issues (H2, H3) are also captured in a private report for submission to Worldpay's HackerOne programme.*
