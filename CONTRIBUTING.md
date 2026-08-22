# Contributing

Thanks for your interest. This page covers how to build, test and propose changes. The licence in [`LICENSE`](LICENSE) is Worldpay's own — read it before modifying or redistributing the software; contributions to the upstream repository are made under its terms.

## Build and run

```bash
git clone https://github.com/Worldpay/worldpay-mcp.git
cd worldpay-mcp
cp .env.example .env          # fill in sandbox credentials
npm install
npm run build                 # tsc --build && tsc-alias → dist/
node dist/server-stdio.js     # stdio transport
npm start                     # Streamable HTTP on :3001
```

Requires Node 20 or later. `npm run dev` rebuilds and starts the HTTP server.

## Test

```bash
npm test
```

Jest + `ts-jest` + `@fetch-mock/jest`. Tests live in `tests/` mirroring `src/tools/`, mock the Worldpay endpoint with `fetchMock.mockGlobal()`, and need no credentials or network. Add a test alongside any tool you change; assert on the returned `content[0].text`, not only on the absence of `isError`.

Smoke-test the built server without touching Worldpay:

```bash
WORLDPAY_USERNAME=x WORLDPAY_PASSWORD=x WORLDPAY_URL=https://try.access.worldpay.com MERCHANT_ENTITY=x \
npx -y @modelcontextprotocol/inspector --cli node dist/server-stdio.js --method tools/list
```

## Project conventions

- **TypeScript strict**, ES2022 modules, path alias `@/` → `src/`.
- **One tool, one class** in `src/tools/<area>/`, extending `MCPTool`; its Zod schema lives in `src/schemas/schemas.ts`; register it in `src/worldpay-mcp-server.ts`.
- **Worldpay calls go through `WorldpayAPI`** (`src/api/worldpay.ts`), which owns auth and request building.
- **Never write to stdout** from server code — stdio is the protocol channel. Use `logger` (writes to `worldpay-mcp.log`).
- **Tool results** are `ToolCallResponse` / `ToolCallResponseError` from `src/utils/mcp-response.ts`.
- Amounts are minor units; say so in every `.describe()`.

## Proposing a change

Worldpay has not published a formal contribution process; the suggestions below are conventions that keep a PR easy to review, not house rules.

1. Consider opening an issue first for anything beyond a typo — the cheapest place to agree on scope.
2. Branch from `main`; keep the PR to one concern.
3. `npm run build && npm test` should pass; the CI workflow added in this docs set runs both on Node 20 and 22.
4. Update the docs that describe the behaviour you changed (`README.md`, `docs/tools.md`, `docs/architecture.md`). Docs describe what the code does; if they disagree with the code, fix one or the other in the same PR.
5. The commit history is mixed but leans on conventional-style prefixes (`feat:`, `fix:`, `chore:`, `docs:`).

## Reporting

- **Bugs and questions:** [GitHub issues](https://github.com/Worldpay/worldpay-mcp/issues).
- **Security vulnerabilities:** Worldpay's [HackerOne programme](https://hackerone.com/worldpay), per [`SECURITY.md`](SECURITY.md) — not the public tracker.
