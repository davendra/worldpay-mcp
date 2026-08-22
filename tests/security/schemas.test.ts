import {paymentSchema, delegateTokenSchema, paymentIdQuerySchema} from "@/schemas/schemas";

describe("schema validation", () => {
  const validPayment = {
    cardHolderName: "John Doe", sessionHref: "https://try.access.worldpay.com/sessions/a",
    amount: 1000, currency: "GBP", address1: "1 High St", city: "London", countryCode: "GB",
  };
  it("accepts a valid payment and applies defaults", () => {
    const r = paymentSchema.safeParse(validPayment);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.channel).toBe("moto");
  });
  it("rejects a negative / non-integer amount", () => {
    expect(paymentSchema.safeParse({...validPayment, amount: -5}).success).toBe(false);
    expect(paymentSchema.safeParse({...validPayment, amount: 10.5}).success).toBe(false);
  });
  it("rejects a non-ISO currency and a non-URL href", () => {
    expect(paymentSchema.safeParse({...validPayment, currency: "pounds"}).success).toBe(false);
    expect(paymentSchema.safeParse({...validPayment, sessionHref: "notaurl"}).success).toBe(false);
  });
  it("rejects a raw PAN (fpan) on the delegate token surface", () => {
    const bad = {
      payment_method: {type: "card", card_number_type: "fpan", number: "4111111111111111", display_card_funding_type: "credit", metadata: {}},
      allowance: {reason: "one_time", max_amount: 2000, currency: "usd", checkout_session_id: "cs", merchant_id: "m", expires_at: "2026-01-01"},
      risk_signals: [], metadata: {},
    };
    expect(delegateTokenSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a paymentId containing path separators", () => {
    expect(paymentIdQuerySchema.safeParse({paymentId: "../../admin"}).success).toBe(false);
    expect(paymentIdQuerySchema.safeParse({paymentId: "51a448e5-4430-ee11"}).success).toBe(true);
  });
});
