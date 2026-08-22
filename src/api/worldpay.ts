import {randomUUID} from "node:crypto";
import {logger} from "@/utils/logger";
import {redactedJson} from "@/utils/redact";
import {
  accountPayoutQuerySchema,
  delegateTokenSchema,
  hppSchema,
  manageSchema,
  paymentDateQuerySchema,
  paymentSchema,
  paymentTxnRefQuerySchema
} from "@/schemas/schemas";

import {z} from "zod";
import {
  BillingAddress,
  CardPaymentsInstruction,
  PaymentRequest,
  PaymentsCardOnFileCustomerAgreement,
  PaymentsResponse201,
  SessionPaymentInstrument,
  TokenCreation,
  TokenPaymentInstrument
} from "@/types/payments";
import {WorldpayMCPConfig} from "@/worldpay-mcp-server";

const QUERY_API_PATH = "/paymentQueries/payments";
const PAYMENTS_API_PATH = '/api/payments';
const DELEGATE_TOKEN_PATH = "/sessions/agentic_commerce/delegate_payment";
const HOSTED_PAYMENTS_PATH = "/payment_pages";
// Outbound request timeout (ms). Configurable via WORLDPAY_TIMEOUT_MS.
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.WORLDPAY_TIMEOUT_MS ?? "", 10) || 30_000;
const PAYMENTS_API_VERSION = "2024-06-01";
const ACP_API_VERSION = "2025-09-29";

export class WorldpayAPI {
  private config: WorldpayMCPConfig;

  constructor(config: WorldpayMCPConfig) {
    this.config = config
  }

  private getBasicAuth(): string {
    if (!this.config.username || !this.config.password) {
      throw new Error("Username and password required for Basic auth");
    }
    const token = Buffer.from(`${this.config.username}:${this.config.password}`, "utf8").toString("base64");
    return `Basic ${token}`;
  }

  /** All outbound calls go through here so every request gets a timeout. */
  private fetchWorldpay(url: string, init: RequestInit): Promise<Response> {
    // redirect:"error" so a same-origin URL that 302s cannot bounce a credentialed
    // request to another host (belt-and-braces alongside assertWorldpayUrl).
    return fetch(url, {...init, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
  }

  /**
   * Guard against credential exfiltration / SSRF: refuse to send the merchant's
   * Basic-auth header to any host other than the configured Worldpay base URL.
   * `manage_payment` takes a caller-supplied `commandHref`; without this a
   * prompt-injected or hallucinated href would leak credentials to an attacker.
   */
  private assertWorldpayUrl(candidate: string): void {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error("Provided URL is not a valid absolute URL");
    }
    const base = new URL(this.config.baseUrl);
    if (parsed.origin !== base.origin) {
      throw new Error(
        `Refusing to send credentials to a non-Worldpay host (${parsed.origin}); expected ${base.origin}`,
      );
    }
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new Error("Worldpay requests must use https");
    }
  }

  /**
   * Log the full upstream failure server-side (redacted) and throw a generic,
   * status-only error. The raw Worldpay error body is NOT propagated to the
   * model/client, which would otherwise be an info-disclosure channel.
   */
  private async failure(kind: string, response: Response): Promise<never> {
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      body = (await response.text().catch(() => "")).slice(0, 500);
    }
    const correlationId =
      response.headers.get("wp-correlationid") ?? response.headers.get("wp-CorrelationId") ?? undefined;
    logger.error(`${kind} failed`, {status: response.status, correlationId, body});
    throw new Error(
      `${kind} failed with status ${response.status}` +
        (correlationId ? ` (correlationId ${correlationId})` : "") +
        `. See server logs for detail.`,
    );
  }

  async callQueryAPIWithParams(queryParams: URLSearchParams): Promise<any> {
    return this.callQueryAPI(
      `${this.config.baseUrl}${QUERY_API_PATH}?${queryParams}`
    );
  }

  async callQueryAPI(path: string): Promise<any> {
    logger.info(`Calling GET ${path}`);

    const basicAuth = this.getBasicAuth()
    const response = await this.fetchWorldpay(path, {
      method: "GET",
      headers: {
        Accept: "application/vnd.worldpay.payment-queries-v1.hal+json",
        Authorization: basicAuth,
      },
    });

    if (response.status != 200) {
      return this.failure("Payment query", response);
    }

    const result: any = await response.json();
    if (result && result._embedded) {
      const payments = result._embedded.payments ?? [];
      logger.info(`Query successful: ${payments.length} payment(s) found.`);
      return payments;
    } else {
      logger.info("Query successful, payment found.");
      return result
    }
  }

  // Add SDK methods here
  async queryPaymentsByIdHandler(paymentId: string) {
    // Encode to prevent path/query injection via the caller-supplied id.
    return this.callQueryAPI(
      `${this.config.baseUrl}${QUERY_API_PATH}/${encodeURIComponent(paymentId)}`
    );
  }

  async queryPaymentsByDate(
    params: z.infer<typeof paymentDateQuerySchema>
  ): Promise<any> {
    const queryParams = new URLSearchParams({
      startDate: params.startDate ? params.startDate : "",
      endDate: params.endDate ? params.endDate : "",
      pageSize: params.pageSize ? params.pageSize.toString() : "",
    });
    return this.callQueryAPIWithParams(queryParams);
  }

  async queryPaymentsByTxRefHandler(
    params: z.infer<typeof paymentTxnRefQuerySchema>
  ) {
    const queryParams = new URLSearchParams({
      transactionReference: params.transactionReference
        ? params.transactionReference
        : ""
    });
    // Forward pageSize (previously accepted by the schema but silently dropped).
    if (params.pageSize) {
      queryParams.set("pageSize", params.pageSize.toString());
    }
    return this.callQueryAPIWithParams(queryParams);
  }

  async managePayment(params: z.infer<typeof manageSchema>) {
    this.assertWorldpayUrl(params.commandHref);
    logger.info(`Calling POST ${params.commandHref} (${params.commandName})`);
    const basicAuth = this.getBasicAuth()
    const response = await this.fetchWorldpay(params.commandHref, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuth,
        "WP-Api-Version": PAYMENTS_API_VERSION,
      },
    });

    if (response.status != 201 && response.status != 202) {
      return this.failure("Payment command", response);
    }

    logger.info('Payment command successful');
    return response.json();
  }

  async takeGuestPayment(params: z.infer<typeof paymentSchema>) {
    const paymentRequest: PaymentRequest = this.createRequest(params);

    logger.info(
      `Calling POST ${this.config.baseUrl}${PAYMENTS_API_PATH} (ref ${paymentRequest.transactionReference}) params: ${redactedJson(params)}`
    );

    const basicAuth = this.getBasicAuth()

    const response = await this.fetchWorldpay(
      `${this.config.baseUrl}${PAYMENTS_API_PATH}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: basicAuth,
          "WP-Api-Version": PAYMENTS_API_VERSION,
        },
        body: JSON.stringify(paymentRequest),
      }
    );

    logger.info(`Response CorrelationId: ${response.headers.get("wp-correlationid")}`);

    if (response.status != 201 && response.status != 202) {
      return this.failure("Payment", response);
    }

    const result = (await response.json()) as PaymentsResponse201;

    logger.info(`Payment outcome: ${result.outcome}`);
    return result
  }


  createRequest(params: z.infer<typeof paymentSchema>): PaymentRequest {
    const billingAddress: BillingAddress = {
      address1: params.address1,
      city: params.city,
      postalCode: params.postalCode,
      countryCode: params.countryCode,
    } as BillingAddress;

    // Exactly one instrument. Supplying both used to silently prefer sessionHref
    // and could charge the wrong instrument.
    if (params.sessionHref && params.tokenHref) {
      throw new Error("Provide either sessionHref or tokenHref, not both");
    }

    let paymentInstrument: TokenPaymentInstrument | SessionPaymentInstrument;
    if (params.sessionHref) {
      paymentInstrument = {
        type: "checkout",
        cardHolderName: params.cardHolderName,
        sessionHref: params.sessionHref,
        billingAddress: billingAddress,
      } as SessionPaymentInstrument;
    } else if (params.tokenHref) {
      paymentInstrument = {
        type: "token",
        href: params.tokenHref,
        cvc: params.cvc,
        cvcSessionHref: params.cvcSessionHref
      } as TokenPaymentInstrument;
    } else {
      throw new Error("Either sessionHref or tokenHref must be provided");
    }

    const instruction: CardPaymentsInstruction = {
      method: "card",
      paymentInstrument: paymentInstrument,
      narrative: {line1: params.narrative ?? "MCP Payment"},
      value: {
        currency: params.currency,
        amount: params.amount,
      },
    } as CardPaymentsInstruction;

    const paymentRequest: PaymentRequest = {
      // Caller-supplied reference makes retries idempotent; UUID default avoids
      // the millisecond-collision the old `TR${Date.now()}` scheme had.
      transactionReference: params.transactionReference ?? `TR-${randomUUID()}`,
      merchant: {entity: `${this.config.merchantEntity}`},
      channel: params.channel ?? "moto",
      instruction: instruction,
    } as PaymentRequest;

    if (params.storeCard) {
      const cit: PaymentsCardOnFileCustomerAgreement = {
        type: "cardOnFile",
        storedCardUsage: "first",
      };
      paymentRequest.instruction.customerAgreement = cit;
    }

    if (params.createToken) {
      const token: TokenCreation = {
        type: "worldpay",
      };
      paymentRequest.instruction.tokenCreation = token;
    }
    return paymentRequest;
  }

  async createHostedPayment(params: z.infer<typeof hppSchema>) {
    const transaction = {
      transactionReference: `TR-${randomUUID()}`,
      merchant: {entity: this.config.merchantEntity},
      expiry: 3600,
      narrative: {line1: params.narrative ?? "MCP Payment"},
      value: {amount: params.amount, currency: params.currency},
    };

    logger.info(
      `Calling POST ${this.config.baseUrl}${HOSTED_PAYMENTS_PATH} (ref ${transaction.transactionReference})`
    );

    const response = await this.fetchWorldpay(`${this.config.baseUrl}${HOSTED_PAYMENTS_PATH}`, {
      method: "POST",
      headers: {
        Authorization: this.getBasicAuth(),
        "Content-Type": "application/vnd.worldpay.payment_pages-v1.hal+json",
        Accept: "application/vnd.worldpay.payment_pages-v1.hal+json",
      },
      body: JSON.stringify(transaction),
    });

    if (response.status != 200) {
      return this.failure("Hosted payment", response);
    }

    logger.info("Hosted payment transaction created successfully");
    return response.json();
  }

  async queryAccountPayouts(params: z.infer<typeof accountPayoutQuerySchema>) {
    const entries: [string, string][] = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => [key, String(value)]);

    if (this.config.merchantEntity) {
      entries.push(["entity", this.config.merchantEntity]);
    }
    const queryParams = new URLSearchParams(entries);

    return this.callQueryAPIWithParams(queryParams);
  }

  async createDelegateToken(args: z.infer<typeof delegateTokenSchema>) {
    logger.info(
      `Calling POST ${this.config.baseUrl}${DELEGATE_TOKEN_PATH} params: ${redactedJson(args)}`
    );
    const basicAuth = this.getBasicAuth()

    const response = await this.fetchWorldpay(
      `${this.config.baseUrl}${DELEGATE_TOKEN_PATH}`,
      {
        method: "POST",
        headers: {
          Authorization: basicAuth,
          "Content-Type": "application/json",
          "API-Version": ACP_API_VERSION,
          Accept: "application/json",
        },
        body: JSON.stringify(args),
      }
    );

    if (response.status != 201) {
      return this.failure("Delegate token creation", response);
    }

    logger.info(`Created a Delegate Token successfully`);
    return response.json();
  }
}
