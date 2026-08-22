import {redact, redactedJson} from "@/utils/redact";

describe("redact", () => {
  it("masks card and billing fields at any depth", () => {
    const input = {
      cardHolderName: "John Doe",
      cvc: "123",
      amount: 1000,
      payment_method: {number: "4111111111111111", display_last4: "1111"},
      billing: [{postalCode: "EC4N 8AF", city: "London"}],
      iban: "GB29NWBK60161331926819",
    };
    const out = redact(input) as any;
    expect(out.cardHolderName).toBe("[REDACTED]");
    expect(out.cvc).toBe("[REDACTED]");
    expect(out.payment_method.number).toBe("[REDACTED]");
    expect(out.billing[0].postalCode).toBe("[REDACTED]");
    expect(out.iban).toBe("[REDACTED]");
    // non-sensitive fields survive
    expect(out.amount).toBe(1000);
    expect(out.payment_method.display_last4).toBe("1111");
  });

  it("redactedJson never emits a raw PAN or CVC", () => {
    const s = redactedJson({number: "4111111111111111", cvc: "999", ok: "x"});
    expect(s).not.toContain("4111111111111111");
    expect(s).not.toContain("999");
    expect(s).toContain("x");
  });
});
