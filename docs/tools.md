# Tool reference

Every tool the server advertises, exactly as returned by `tools/list` (verified with the MCP Inspector against the built server), with the Worldpay request it produces and what comes back. Schemas are transcribed from [`src/schemas/schemas.ts`](../src/schemas/schemas.ts); request building from [`src/api/worldpay.ts`](../src/api/worldpay.ts) and [`src/tools/hpp/CreateHPPTransaction.ts`](../src/tools/hpp/CreateHPPTransaction.ts).

**Conventions.** Amounts are **minor units** (`1000` = £10.00). `currency` defaults to `GBP` where a default exists. Every successful result is a single `text` content block containing Worldpay's JSON response as a string; failures set `isError: true` with a **sanitized** message — HTTP status + Worldpay correlation id, not the raw upstream body (see [architecture → error model](architecture.md#error-model)). All tools carry MCP **annotations** matching the **Effect** column, so a client can auto-classify them; the column is still your guide to which tools need approval.

| Tool | Effect | Worldpay call |
|---|---|---|
| [`create_hosted_payment`](#create_hosted_payment) | creates a payment page | `POST /payment_pages` |
| [`take_guest_payment`](#take_guest_payment) | **moves money** | `POST /api/payments` |
| [`create_worldpay_token`](#create_worldpay_token) | creates a token (£0 verification) | `POST /api/payments` |
| [`manage_payment`](#manage_payment) | **moves money / changes state** | `POST {action href}` |
| [`query_payments_by_date`](#query_payments_by_date) | read-only | `GET /paymentQueries/payments?…` |
| [`query_payment_by_id`](#query_payment_by_id) | read-only | `GET /paymentQueries/payments/{id}` |
| [`query_payments_by_transaction_reference`](#query_payments_by_transaction_reference) | read-only | `GET /paymentQueries/payments?…` |
| [`query_account_payouts`](#query_account_payouts) | read-only | `GET /paymentQueries/payments?…&entity=` |
| [`create_delegate_token`](#create_delegate_token) | creates a spend-limited token | `POST /sessions/agentic_commerce/delegate_payment` |

---

## `create_hosted_payment`

**Title:** Create Hosted Payment · **Description:** *Create a hosted payment page link to send to customers* · **Product:** [Hosted Payment Pages](https://developer.worldpay.com/products/access/hosted-payment-pages)

| Input | Type | Required | Notes |
|---|---|---|---|
| `amount` | number | yes | Minor units (e.g. £10 → `1000`) |
| `currency` | string | no | default `"GBP"` |

**Request the server sends** — `POST {WORLDPAY_URL}/payment_pages`, `Content-Type` and `Accept: application/vnd.worldpay.payment_pages-v1.hal+json`, Basic auth:

```json
{
  "transactionReference": "TR-3f1b2c4d-…",
  "merchant": { "entity": "<MERCHANT_ENTITY>" },
  "expiry": 3600,
  "narrative": { "line1": "MCP Payment" },
  "value": { "amount": 4500, "currency": "GBP" }
}
```

`transactionReference`, `expiry` and `narrative` are fixed by the server. **Success:** HTTP 200; the response body (containing the hosted page URL and HAL links) is returned verbatim. **Failure message prefix:** `Hosted Payment failed: …`.

**Example call**

```json
{ "name": "create_hosted_payment", "arguments": { "amount": 4500, "currency": "GBP" } }
```

---

## `take_guest_payment`

**Title:** Take Guest Payment · **Description:** *Take a guest payment using session or worldpay token* · **Product:** [Payments API](https://developer.worldpay.com/products/access/payments/card-payment)

| Input | Type | Required | Notes |
|---|---|---|---|
| `cardHolderName` | string | yes | |
| `sessionHref` | string | one of | *Optional Sessions url from Checkout SDK (provide either a sessionHref or tokenHref, never both)* |
| `tokenHref` | string | one of | *Token url from stored card (provide either a sessionHref or tokenHref, never both)* |
| `cvc` | string | no | *Provide a value in cvcSessionHref or cvc, never both* — used with `tokenHref` |
| `cvcSessionHref` | string | no | CVC session url from the Checkout SDK — *only supply if using tokenHref* |
| `amount` | number | yes | Minor units |
| `currency` | string | no | default `"GBP"` |
| `address1` | string | yes | Billing address line 1 |
| `city` | string | yes | |
| `postalCode` | string | no | |
| `countryCode` | string | yes | ISO 3166-1 alpha-2 (validated) |
| `storeCard` | boolean | no | default `false`; adds `customerAgreement: {type: "cardOnFile", storedCardUsage: "first"}` |
| `createToken` | boolean | no | default `false`; adds `tokenCreation: {type: "worldpay"}` |
| `channel` | enum | no | `moto` (default) · `ecommerce` · `recurring` |
| `narrative` | string | no | Statement narrative, ≤24 chars (default `MCP Payment`) |
| `transactionReference` | string | no | Your reference; reuse to make a retry idempotent (default generated `TR-<uuid>`) |

Validation: `amount` must be a non-negative integer (minor units); `currency` is ISO-4217 alpha-3; `sessionHref`/`tokenHref`/`cvcSessionHref` must be URLs. Supply **exactly one** of `sessionHref` / `tokenHref`: the server rejects the request if **both** are present (previously `sessionHref` silently won) and if **neither** is.

**Request the server sends** — `POST {WORLDPAY_URL}/api/payments`, `WP-Api-Version: 2024-06-01`, Basic auth. With a session:

```json
{
  "transactionReference": "TR-3f1b2c4d-…",
  "merchant": { "entity": "<MERCHANT_ENTITY>" },
  "channel": "moto",
  "instruction": {
    "method": "card",
    "paymentInstrument": {
      "type": "checkout",
      "cardHolderName": "Priya Shah",
      "sessionHref": "https://try.access.worldpay.com/sessions/…",
      "billingAddress": { "address1": "1 High St", "city": "London", "postalCode": "EC4N 8AF", "countryCode": "GB" }
    },
    "narrative": { "line1": "MCP Payment" },
    "value": { "currency": "GBP", "amount": 1000 }
  }
}
```

With a token, `paymentInstrument` becomes `{ "type": "token", "href": "<tokenHref>", "cvc": "…", "cvcSessionHref": "…" }` and the billing address is not sent.

**Success:** HTTP 201 or 202; Worldpay's payment response is returned verbatim — `outcome` (`authorized`, `refused`, …), the masked instrument, and `_links` with the follow-on actions (`settle`, `cancel`, `partialSettle`, …) to hand to [`manage_payment`](#manage_payment). The `wp-correlationid` response header is logged. **Failure message prefix:** `Payment failed: …`.

**Example call**

```json
{
  "name": "take_guest_payment",
  "arguments": {
    "cardHolderName": "Priya Shah",
    "sessionHref": "https://try.access.worldpay.com/sessions/2f1b…",
    "amount": 1000,
    "currency": "GBP",
    "address1": "1 High St",
    "city": "London",
    "postalCode": "EC4N 8AF",
    "countryCode": "GB"
  }
}
```

---

## `create_worldpay_token`

**Title:** Create Worldpay Token without Payment · **Description:** *Create a worldpay token using a session. The amount must be 0, storeCard must be true, and to avoid the PCI implications of storing card numbers set createToken to true.* · **Product:** [Verified Tokens](https://developer.worldpay.com/products/access/verified-tokens)

**Inputs:** identical to [`take_guest_payment`](#take_guest_payment) — the two tools share `paymentSchema`. The tool's description tells the model what to set; the server does **not** enforce `amount === 0`.

**Request the server sends:** the same `POST /api/payments` body as above with `value.amount: 0`, plus `customerAgreement` and `tokenCreation` when the flags are set. **Success:** 201/202; the response includes the created token's href for later `tokenHref` use. **Failure message prefix:** `Payment failed: …`.

**Example call**

```json
{
  "name": "create_worldpay_token",
  "arguments": {
    "cardHolderName": "Priya Shah",
    "sessionHref": "https://try.access.worldpay.com/sessions/2f1b…",
    "amount": 0,
    "storeCard": true,
    "createToken": true,
    "address1": "1 High St",
    "city": "London",
    "countryCode": "GB"
  }
}
```

---

## `manage_payment`

**Title:** Manage Payment · **Description:** *Perform actions on a payment after authorization such as refund, cancel and settle* · **Product:** [Manage Payments](https://developer.worldpay.com/products/access/payments/openapi/manage-payments)

| Input | Type | Required | Notes |
|---|---|---|---|
| `commandName` | string | yes | The action you're invoking — `settle`, `cancel`, `refund`, `reverse`, … Informational; not sent to Worldpay |
| `commandHref` | string | yes | The action URL from the `_links` of a prior payment response. Validated to be same-origin as `WORLDPAY_URL` before credentials are attached |

**Request the server sends** — `POST {commandHref}`, `Content-Type: application/json`, `WP-Api-Version: 2024-06-01`, Basic auth, **no body**. The server first checks `commandHref` shares the configured Worldpay origin (a safeguard against sending credentials elsewhere). **Success:** 201 or 202; the response is returned verbatim. **Failure message prefix:** `Payment command failed: …`.

Because no body is sent, use this tool for whole-payment actions (settle, cancel, refund, reverse). Partial actions that need an amount in the body are not expressible through it today.

**Example call**

```json
{
  "name": "manage_payment",
  "arguments": {
    "commandName": "settle",
    "commandHref": "https://try.access.worldpay.com/api/payments/eyJr…/settlements"
  }
}
```

---

## `query_payments_by_date`

**Title:** Query Payments made with Worldpay by date range · **Description:** *Query all payments within a given date and time range* · **Product:** [Payment Queries](https://developer.worldpay.com/products/access/payment-queries)

| Input | Type | Required | Notes |
|---|---|---|---|
| `startDate` | string | no | ISO 8601 date-time, `YYYY-MM-DDTHH:MM:SSZ` |
| `endDate` | string | no | ISO 8601 date-time |
| `pageSize` | number | no | default `20` |

**Request:** `GET {WORLDPAY_URL}/paymentQueries/payments?startDate=…&endDate=…&pageSize=…`, `Accept: application/vnd.worldpay.payment-queries-v1.hal+json`. Empty inputs are sent as empty parameters. **Success:** 200; if the body has `_embedded.payments` that array is returned, otherwise the whole body. **Failure message prefix:** `Query failed: Payment Query failed …`.

**Example call**

```json
{ "name": "query_payments_by_date", "arguments": { "startDate": "2026-08-01T00:00:00Z", "endDate": "2026-08-21T23:59:59Z", "pageSize": 50 } }
```

---

## `query_payment_by_id`

**Title:** Retrieve specific payment by payment Id · **Description:** *Retrieve specific payment by payment Id*

| Input | Type | Required | Notes |
|---|---|---|---|
| `paymentId` | string | **yes** | Worldpay payment ID. Required and validated (no URL separators); URL-encoded before use |

**Request:** `GET {WORLDPAY_URL}/paymentQueries/payments/{encoded paymentId}`. **Success:** 200; the payment object. **Failure prefix:** `Query failed: Payment Query failed …`.

**Example call**

```json
{ "name": "query_payment_by_id", "arguments": { "paymentId": "51a448e5-4430-ee11-b58a-005056b48b8e" } }
```

---

## `query_payments_by_transaction_reference`

**Title:** Query Payments made with Worldpay by transaction reference · **Description:** *Query all payments using a given transaction reference*

| Input | Type | Required | Notes |
|---|---|---|---|
| `transactionReference` | string | no | Your `transactionReference` (server-generated ones look like `TR-<uuid>`) |
| `pageSize` | number | no | default `20`, max `499`; forwarded to Worldpay |

**Request:** `GET {WORLDPAY_URL}/paymentQueries/payments?transactionReference=…&pageSize=…`. **Success:** 200; `_embedded.payments` array or whole body. **Failure prefix:** `Query failed: Payment Query failed …`.

**Example call**

```json
{ "name": "query_payments_by_transaction_reference", "arguments": { "transactionReference": "TR-3f1b2c4d-…" } }
```

---

## `query_account_payouts`

**Title:** Query Account Payouts · **Description:** *Query for payouts made through Worldpay*

All inputs optional except where a default is shown. Descriptions are the schema's own.

| Input | Type | Notes |
|---|---|---|
| `narrative` | string | Reference that may appear on beneficiary statements |
| `transactionReference` | string | Unique reference for the payout |
| `accountNumber` | string | Beneficiary bank account number |
| `payoutInstrumentId` | string | Worldpay-generated ID holding the beneficiary bank details (from the Parties API) |
| `payoutInstrumentReference` | string | Your reference for the payout instrument |
| `pageSize` | number | default `20`, max `499` |
| `countryCode` | string | ISO 3166-1 alpha-2 of the payout destination |
| `pageNumber` | number | default `1` |
| `paymentState` | enum | `AWAITING_EXECUTION` · `NEW` · `VALID` · `REJECTED` · `EXECUTED` · `COMPLETED` · `REVERSED` · `FAILED` · `INVALID` |
| `startDate`, `endDate` | string | Gregorian dates, `YYYY-MM-DD` (note: plain dates, unlike the payment queries) |
| `payeeName` | string | Full payee name or company name |
| `sourceCurrency`, `targetCurrency` | string | ISO 4217 alpha-3 |
| `sourceAmount`, `targetAmount` | number | 18-digit precision including 2 decimal places |

**Request:** `GET {WORLDPAY_URL}/paymentQueries/payments?{every non-empty input}&entity={MERCHANT_ENTITY}`, `Accept: application/vnd.worldpay.payment-queries-v1.hal+json`. **Success:** 200; the tool returns the whole response, and returns the string `"No payouts found for the given criteria."` when the body has an empty `items` array. Note the code inspects `response.items`, so a response shaped as an `_embedded.payments` array (the shape the shared query helper unwraps to) makes it throw, surfacing as `Payment failed: Cannot read properties of undefined (reading 'length')` — see [architecture → error model](architecture.md#error-model). Payout records include beneficiary bank details (IBAN, account number, SWIFT/BIC, payee name) — these reach the model. **Failure prefix:** `Payment failed: …`.

**Example call**

```json
{ "name": "query_account_payouts", "arguments": { "paymentState": "EXECUTED", "startDate": "2026-08-01", "endDate": "2026-08-21", "pageSize": 50 } }
```

---

## `create_delegate_token`

**Title:** Create Delegate Token · **Description:** *Create a ACP delegate payment token for use in ACP checkout sessions* · **Product:** Access Worldpay Agentic Commerce Protocol sessions

ACP-shaped, `snake_case` schema. Required top-level objects: `payment_method`, `allowance`, `risk_signals`, `metadata`; `billing_address` optional.

**`payment_method`** (required)

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | enum | yes | `card` |
| `card_number_type` | enum | yes | `network_token` **only** — raw PANs (`fpan`) are rejected |
| `number` | string | yes | Network token value (never a raw card number) |
| `exp_month`, `exp_year` | string | no | |
| `name` | string | no | Cardholder name |
| `cryptogram`, `eci_value` | string | no | Network-token authentication values |
| `checks_performed` | array of enum | no | `avs` · `cvv` · `ani` · `auth0` |
| `iin` | string | no | Issuer identification number |
| `display_card_funding_type` | enum | yes | `credit` · `debit` · `prepaid` |
| `display_wallet_type`, `display_brand`, `display_last4` | string | no | Display-only |
| `metadata` | object | yes | Empty-object schema |

**`allowance`** (required)

| Field | Type | Notes |
|---|---|---|
| `reason` | enum | `one_time` |
| `max_amount` | number | Minor units (e.g. $20 → `2000`) |
| `currency` | string | **lowercase** ISO-4217, e.g. `usd` |
| `checkout_session_id` | string | ACP checkout session identifier |
| `merchant_id` | string | Identifier of the merchant who will process the payment |
| `expires_at` | string | Expiration timestamp |

**`billing_address`** (optional): `line_one`, `line_two?`, `city`, `state`, `country` (ISO 3166-1 alpha-2), `postal_code`.
**`risk_signals`** (required): array of `{ score: number, action: "blocked" | "manual_review" | "authorized" }`.
**`metadata`** (required): empty-object schema.

**Request:** `POST {WORLDPAY_URL}/sessions/agentic_commerce/delegate_payment`, `API-Version: 2025-09-29`, `Content-Type`/`Accept: application/json`, Basic auth; the arguments are sent **as the body, unchanged**. **Success:** 201; response returned verbatim. **Failure prefix:** `Delegate token failed: Creating a Delegate Token failed …`.

**Example call** (network token — the path that keeps card numbers out of the agent)

```json
{
  "name": "create_delegate_token",
  "arguments": {
    "payment_method": {
      "type": "card",
      "card_number_type": "network_token",
      "number": "4895…",
      "exp_month": "12",
      "exp_year": "2028",
      "cryptogram": "AgAAAAAA…",
      "eci_value": "05",
      "display_card_funding_type": "credit",
      "display_brand": "visa",
      "display_last4": "4242",
      "metadata": {}
    },
    "allowance": {
      "reason": "one_time",
      "max_amount": 2000,
      "currency": "usd",
      "checkout_session_id": "cs_7f3a…",
      "merchant_id": "merchant_123",
      "expires_at": "2026-08-22T12:00:00Z"
    },
    "risk_signals": [ { "score": 12, "action": "authorized" } ],
    "metadata": {}
  }
}
```

---

## Quick decision table

| I want to… | Call |
|---|---|
| Send someone a link to pay | `create_hosted_payment` |
| Charge a card my Checkout form just captured | `take_guest_payment` with `sessionHref` |
| Store a card for later without charging it | `create_worldpay_token` (`amount: 0`, `storeCard`, `createToken`) |
| Charge a stored card | `take_guest_payment` with `tokenHref` (+ `cvc` or `cvcSessionHref`) |
| Settle / cancel / refund / reverse | `manage_payment` with the `_links` href from the payment response |
| Find a payment | `query_payment_by_id` › `query_payments_by_transaction_reference` › `query_payments_by_date` |
| Check a supplier payout | `query_account_payouts` |
| Get a spend-limited token for an ACP checkout | `create_delegate_token` |
