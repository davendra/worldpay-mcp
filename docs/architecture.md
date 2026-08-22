# Architecture

How the Worldpay MCP Server is put together, traced from the code at upstream commit `e674e2a`. Read this before extending it, wrapping it, or deciding how to deploy it.

![Architecture overview](assets/architecture.jpg)

- [Components](#components)
- [Transports](#transports)
- [Server and tool registration](#server-and-tool-registration)
- [The API client](#the-api-client)
- [Request lifecycle](#request-lifecycle)
- [Error model](#error-model)
- [Logging](#logging)
- [Configuration](#configuration)
- [Build and packaging](#build-and-packaging)
- [Design properties worth knowing](#design-properties-worth-knowing)

---

## Components

```mermaid
classDiagram
    direction LR
    class McpServer {
        <<@modelcontextprotocol/sdk 1.26>>
        +registerTool(name, definition, handler)
        +connect(transport)
    }
    class WorldpayMCPServer {
        -api: WorldpayAPI
        +constructor(config: WorldpayMCPConfig)
        -registerTools()
    }
    class MCPTool {
        <<abstract>>
        #name: string
        #title: string
        #description: string
        #inputSchema: ZodRawShape
        #api: WorldpayAPI
        +getName()
        +getDefinition()
        +execute(args)* CallToolResult
    }
    class WorldpayAPI {
        -config: WorldpayMCPConfig
        -getBasicAuth()
        +takeGuestPayment(params)
        +createRequest(params)
        +managePayment(params)
        +queryPaymentsByDate(params)
        +queryPaymentsByTxRefHandler(params)
        +queryPaymentsByIdHandler(id)
        +queryAccountPayouts(params)
        +createDelegateToken(args)
    }
    class CreateHPPTransaction {
        +execute(args)
    }
    note for CreateHPPTransaction "Builds and sends its own fetch;\nreads process.env directly"
    class TakeGuestPayment
    class CreateWorldpayToken
    class ManagePayment
    class QueryPaymentByDate
    class QueryPaymentById
    class QueryPaymentByTxnRef
    class QueryAccountPayouts
    class CreateDelegateToken
    class ConnectableServerTransport {
        <<interface>>
        +connect() Promise
    }
    class StdioTransport
    class HTTPTransport {
        -port: number
        -sessions: Map~string, StreamableHTTPServerTransport~
    }

    McpServer <|-- WorldpayMCPServer
    WorldpayMCPServer o-- WorldpayAPI
    WorldpayMCPServer o-- MCPTool : registers 9
    MCPTool <|-- CreateHPPTransaction
    MCPTool <|-- TakeGuestPayment
    MCPTool <|-- CreateWorldpayToken
    MCPTool <|-- ManagePayment
    MCPTool <|-- QueryPaymentByDate
    MCPTool <|-- QueryPaymentById
    MCPTool <|-- QueryPaymentByTxnRef
    MCPTool <|-- QueryAccountPayouts
    MCPTool <|-- CreateDelegateToken
    MCPTool --> WorldpayAPI
    ConnectableServerTransport <|.. StdioTransport
    ConnectableServerTransport <|.. HTTPTransport
    StdioTransport --> WorldpayMCPServer
    HTTPTransport --> WorldpayMCPServer
```

| Layer | Files | Responsibility |
|---|---|---|
| **Entrypoints** | `src/server-stdio.ts`, `src/server-http.ts`, `src/server-sse.ts` | Read config from `process.env`, construct `WorldpayMCPServer`, connect a transport |
| **Transports** | `src/transports/StdioTransport.ts`, `HTTPTransport.ts`, `SSETransport.ts`, `ServerTransport.ts` | Move JSON-RPC between client and server |
| **Server** | `src/worldpay-mcp-server.ts` | Extend the SDK's `McpServer`; own one `WorldpayAPI`; register the tools |
| **Tools** | `src/tools/mcp-tool.ts` + `src/tools/{hpp,payments,payouts,sessions}/*.ts` | One class per tool: name, title, description, Zod shape, `execute()` |
| **Schemas** | `src/schemas/schemas.ts` | Eight Zod objects shared by the nine tools (the two payment tools share `paymentSchema`) |
| **API client** | `src/api/worldpay.ts` | Build Worldpay requests, attach Basic auth, `fetch`, raise on non-success |
| **Types** | `src/types/*.d.ts` | Generated typings for Worldpay's Payments, Payment Pages, Queries, Payouts and Sessions APIs |
| **Utilities** | `src/utils/logger.ts`, `src/utils/mcp-response.ts` | Winston file logger; `ToolCallResponse` / `ToolCallResponseError` wrappers |

---

## Transports

### stdio — `src/server-stdio.ts`

The default. The package's `bin` points here, the Docker image's `CMD` runs it, and every desktop MCP client launches it as a child process. `StdioTransport` wraps the SDK's `StdioServerTransport` and calls `server.connect()`. The process reads JSON-RPC from stdin and writes it to stdout; **nothing else may be written to stdout**, which is why the logger writes to a file and not the console.

### Streamable HTTP — `src/server-http.ts` → `src/transports/HTTPTransport.ts`

An Express 5 app on port **3001** (hard-coded in the entrypoint) exposing:

| Route | Purpose |
|---|---|
| `POST /mcp` | JSON-RPC requests. A request without an `Mcp-Session-Id` header constructs a transport and connects it (a new session id is minted); subsequent requests carry the header. **The body is not inspected** to decide this, and the server binds only one session at a time — see the note below |
| `GET /mcp` | Server-to-client event stream for an existing session |
| `DELETE /mcp` | Ends a session |
| `GET /healthz` | `{"status":"up"}` — liveness |
| `GET /readyz` | `{"status":"ready"}` — readiness (no dependency check; always ready once listening) |

Response hardening middleware sets a locked-down `Content-Security-Policy` (`default-src 'none'` …), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: no-referrer`, and disables `x-powered-by`. CORS is enabled with `origin: process.env.CORS_ORIGIN || "*"` and exposes the `Mcp-Session-Id` header so browser clients can read it.

Sessions are held in an in-memory `Map` and removed when the SDK transport fires `onclose`; there is no TTL. **Single session per process:** the transport calls `this.server.connect(transport)` against one shared `WorldpayMCPServer` instance, and the SDK permits a server to be connected to only one transport at a time. A second concurrent `initialize` therefore fails — verified: the second call returns HTTP 500 `Internal Server Error`. Run one process per client; a stray non-initialize POST also consumes the single connection. This is an upstream limitation, not a deployment mistake.

### "SSE" — `src/server-sse.ts`

The upstream README describes this as the legacy SSE transport. In the current code `SSETransport` constructs a `StdioServerTransport` and starts it without connecting a `WorldpayMCPServer`, so running `node dist/server-sse.js` yields a process with no tools registered. Use `server-stdio.js` or `server-http.js`; this entrypoint is documented here only so you know not to reach for it.

```mermaid
flowchart TB
    subgraph choose["Which transport?"]
        Q1{"Client launches the server<br/>as a local process?"}
        Q1 -- yes --> S["stdio<br/>npx -y @worldpay/worldpay-mcp<br/>or node dist/server-stdio.js"]
        Q1 -- no --> Q2{"Client connects<br/>over the network?"}
        Q2 -- yes --> H["Streamable HTTP<br/>npm start → :3001/mcp<br/>behind an authenticating proxy"]
        Q2 -- no --> S
    end
```

---

## Server and tool registration

`WorldpayMCPServer` (`src/worldpay-mcp-server.ts`) extends `McpServer`. Its constructor passes `{name, version}` to the SDK, builds a single `WorldpayAPI` from the config, then instantiates the nine tool classes and loops:

```ts
tools.forEach(tool => {
  this.registerTool(tool.getName(), tool.getDefinition(), (args, extra) => tool.execute(args));
});
```

`getDefinition()` returns `{title, description, inputSchema}` where `inputSchema` is the Zod object's `.shape`. The SDK turns that into JSON Schema for `tools/list` and validates incoming `tools/call` arguments against it — so a call with a missing required field or wrong type never reaches `execute()`.

Two consequences of this shape:

- **The `extra` argument is not used.** Request metadata the SDK offers (auth info, session id, progress token, abort signal) is discarded at the dispatch closure. Tools therefore cannot be cancelled mid-flight and see no caller identity.
- **No annotations.** `ToolDefinition` declares optional `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`, but `getDefinition()` doesn't populate them, so `tools/list` advertises every tool identically. Approval policy has to be set on the client side by name — see [security.md](security.md#tool-approval-policy).

Server identity as seen by clients on `initialize`: `{ name: "Worldpay", version: "1.0.3" }` (hard-coded in both entrypoints). Capabilities: `tools` only.

---

## The API client

`WorldpayAPI` (`src/api/worldpay.ts`) is a thin wrapper over the global `fetch`. Each method builds one request:

| Method | Call | Headers of note | Success |
|---|---|---|---|
| `takeGuestPayment` | `POST {WORLDPAY_URL}/api/payments` | `Content-Type: application/json`, `WP-Api-Version: 2024-06-01` | 201 or 202 |
| `managePayment` | `POST {commandHref}` (the HAL action link from a prior payment response) | `Content-Type: application/json`, `WP-Api-Version: 2024-06-01`; no body | 201 or 202 |
| `callQueryAPI` / `callQueryAPIWithParams` | `GET {WORLDPAY_URL}/paymentQueries/payments[?…]` or `/paymentQueries/payments/{id}` | `Accept: application/vnd.worldpay.payment-queries-v1.hal+json` | 200 |
| `queryAccountPayouts` | `GET {WORLDPAY_URL}/paymentQueries/payments?…&entity={MERCHANT_ENTITY}` | as above | 200 |
| `createDelegateToken` | `POST {WORLDPAY_URL}/sessions/agentic_commerce/delegate_payment` | `Content-Type: application/json`, `API-Version: 2025-09-29`, `Accept: application/json` | 201 |

`create_hosted_payment` is the exception: `CreateHPPTransaction` builds and sends its own request (`POST {WORLDPAY_URL}/payment_pages`, `Content-Type`/`Accept: application/vnd.worldpay.payment_pages-v1.hal+json`, success 200) reading `process.env` directly rather than going through `WorldpayAPI` — the two `TODO` comments in that file say it should move.

**Authentication** is HTTP Basic, computed per call from `config.username:config.password`. There is no OAuth, no API-key header, no token refresh.

**Query responses** are lightly unwrapped: if the body has `_embedded`, `callQueryAPI` returns `_embedded.payments` (an array); otherwise it returns the body as-is. Payment and ACP responses are returned untouched.

### Request building for payments

`createRequest()` turns the flat `paymentSchema` arguments into Worldpay's nested Payments API body:

```mermaid
flowchart LR
    A["Tool args<br/>cardHolderName · amount · currency<br/>address1 · city · postalCode · countryCode<br/>sessionHref | tokenHref (+cvc | cvcSessionHref)<br/>storeCard · createToken"]
    A --> B{"sessionHref?"}
    B -- yes --> C["paymentInstrument<br/>type: checkout<br/>cardHolderName · sessionHref · billingAddress"]
    B -- no --> D{"tokenHref?"}
    D -- yes --> E["paymentInstrument<br/>type: token<br/>href · cvc · cvcSessionHref"]
    D -- no --> F["throw<br/>'Either sessionHref or tokenHref must be provided'"]
    C --> G
    E --> G
    G["PaymentRequest<br/>transactionReference: TR{Date.now()}<br/>merchant.entity: MERCHANT_ENTITY<br/>channel: moto<br/>instruction.method: card<br/>instruction.narrative.line1: 'MCP Payment'<br/>instruction.value: {currency, amount}"]
    G --> H{"storeCard?"}
    H -- yes --> I["+ customerAgreement<br/>type: cardOnFile · storedCardUsage: first"]
    G --> J{"createToken?"}
    J -- yes --> K["+ tokenCreation<br/>type: worldpay"]
```

Three values are fixed by the server and not exposed as tool inputs: the **channel** (`moto`), the **statement narrative** (`MCP Payment`) and the **transaction reference** (`TR` + millisecond timestamp). If any of those matter for your interchange, statements or reconciliation, you will need to change the server, not the call.

---

## Request lifecycle

The sequence diagram in the [README](../README.md#request-lifecycle) shows `take_guest_payment` end to end. The same shape applies to every tool:

1. Transport delivers `tools/call` to the SDK.
2. SDK validates `arguments` against the tool's Zod shape, applying defaults.
3. `execute(args)` runs inside a `try`.
4. The API method builds the request, logs it, fetches, checks the status code, parses JSON.
5. Success → `new ToolCallResponse(MCPResponse.text(result))`, i.e. `{ content: [{ type: "text", text: JSON.stringify(result) }] }`.
6. Failure → caught; logged at `error`; `new ToolCallResponseError(MCPResponse.text("<Tool> failed: <message>"))`, i.e. the same shape plus `isError: true`.

There is no `structuredContent`, no resource links, and no streaming — one text block per call.

---

## Error model

Errors reach the model as prose inside an `isError` result, built from the thrown `Error.message`. The messages are consistent per tool:

| Tool | Message | When |
|---|---|---|
| `take_guest_payment`, `create_worldpay_token` | `Payment failed: Payment failed with status {code}: {body}` | non-201/202 |
| `manage_payment` | `Payment command failed: Payment failed with status {code}: {body}` | non-201/202 |
| `query_payments_by_date`, `query_payment_by_id`, `query_payments_by_transaction_reference` | `Query failed: Payment Query failed with status {code}: {body}` | non-200 |
| `query_account_payouts` | `Payment failed: Payment Query failed with status {code}: {body}` | non-200, or an unexpected response shape |
| `create_hosted_payment` | `Hosted Payment failed: Hosted payment transaction failed with status {code}: {body}` | non-200 |
| `create_delegate_token` | `Delegate token failed: Creating a Delegate Token failed with status {code}: {body}` | non-201 |
| any tool except `create_hosted_payment` | `{prefix} Username and password required for Basic auth` | credentials missing from env (the eight tools routed through `WorldpayAPI`; `create_hosted_payment` builds auth inline and instead surfaces a Worldpay 401) |
| `take_guest_payment`, `create_worldpay_token` | `Payment failed: Either sessionHref or tokenHref must be provided` | neither instrument supplied |

`{body}` is Worldpay's error JSON, serialised. That is useful — it carries Worldpay's `errorName`, `message` and validation detail — but note that it is passed unfiltered into the model's context. A non-JSON error body (an HTML gateway page, for instance) makes `response.json()` throw, and the resulting `SyntaxError` text becomes the message instead.

The HTTP status is embedded in the string rather than returned as a field, so a client that wants to branch on 401 vs 400 vs 5xx has to parse it.

---

## Logging

`src/utils/logger.ts` configures Winston with one transport: a file named `worldpay-mcp.log` in the **current working directory**, level `info`, format `timestamp` + `prettyPrint`. There is no console transport (correct for stdio) and no rotation or size cap.

What gets logged:

- every outbound request line (`Calling GET …`, `Calling POST …`);
- for `take_guest_payment` / `create_worldpay_token` / `create_hosted_payment`, the **full tool arguments** as JSON;
- the `wp-correlationid` response header on payments (quote this when talking to Worldpay support);
- outcomes and counts on success;
- the full error message, including Worldpay's response body, on failure.

Because the working directory is wherever the MCP client launched the process, the log can land somewhere surprising — your project root under Claude Code, the app's directory under a desktop client. See [troubleshooting.md](troubleshooting.md#where-is-the-log-file) and [security.md](security.md#the-log-file).

---

## Configuration

Read once at start-up in the entrypoints via `process.env` (with `dotenv/config` loaded as a side-effect of importing the logger, so a `.env` in the working directory is honoured):

| Variable | Used by | Notes |
|---|---|---|
| `WORLDPAY_URL` | `WorldpayAPI` (as `baseUrl`), `CreateHPPTransaction` | no trailing slash |
| `WORLDPAY_USERNAME`, `WORLDPAY_PASSWORD` | Basic auth | |
| `MERCHANT_ENTITY` | `merchant.entity` on payments/HPP; `entity` query param on payouts | |
| `CORS_ORIGIN` | `HTTPTransport` only | defaults to `*` |

None are validated at start-up; the entrypoints use non-null assertions. A missing `WORLDPAY_URL` produces a request to `undefined/api/payments` on first use.

---

## Build and packaging

- **TypeScript 5.9**, `target`/`module` ES2022, `strict`, `noUnusedLocals`, path alias `@/* → src/*` rewritten at build time by `tsc-alias`. Output in `dist/`, which is what the npm package ships (`files: ["dist/**/*"]`).
- `npm run build` = `tsc --build && tsc-alias`. `npm start` runs the HTTP server; the npm `bin` runs the stdio server.
- **Runtime dependencies:** `@modelcontextprotocol/sdk` 1.26, `express` 5, `winston` 3, `dotenv` 16, `node-fetch` 3 (declared; the code uses global `fetch`). `zod` arrives transitively via the SDK. `cors` is imported by the HTTP transport but declared under `devDependencies`; in practice it still resolves after `npm prune --production` because it is also a production transitive dependency of the MCP SDK — worth tidying to a direct dependency nonetheless.
- **Docker:** single-stage `node:20-alpine`; installs, copies, builds, strips `src/` and dev dependencies, `EXPOSE 3001`, `CMD ["node","dist/server-stdio.js"]`.
- **Tests:** Jest 29 + `ts-jest` + `@fetch-mock/jest`; `testMatch: **/*.test.ts`; path alias mapped from `tsconfig`. `npm test` passes on Node 20 and 22 without extra flags.

---

## Design properties worth knowing

Stated neutrally — these are the facts you design around.

| Property | Current behaviour | Implication |
|---|---|---|
| Statelessness | No DB, no cache; HTTP sessions only in memory | Horizontally trivial; HTTP sessions don't survive a restart |
| Idempotency | No idempotency key header; `transactionReference` is a millisecond timestamp the caller can't set | Retrying a failed `take_guest_payment` can create a second payment; two calls in the same millisecond share a reference |
| Timeouts / retries | None; one `fetch`, no `AbortSignal` | A slow upstream call blocks the tool call until the client gives up |
| Rate limiting | None on either side | Put limits in the client or a proxy if agents will loop |
| Response fidelity | Raw Worldpay JSON in a text block | Models see everything Worldpay returns, including `_links`; you get no summarisation for free |
| Tool annotations | None | Clients can't auto-classify read vs write tools |
| Pagination | `pageSize` honoured on date and payout queries; accepted but not forwarded on the transaction-reference query | Reference searches return Worldpay's default page |
| Versioning | Package `1.1.0`; server reports `1.0.3`; npm latest `1.0.3` | Don't rely on the advertised server version to detect the build |

These are the natural next engineering items for anyone extending the server; they are listed as observations, not as a roadmap.
