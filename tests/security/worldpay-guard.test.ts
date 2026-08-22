import {WorldpayAPI} from "@/api/worldpay";

const api = new WorldpayAPI({
  name: "Worldpay", version: "1.0.0",
  baseUrl: "https://try.access.worldpay.com",
  username: "user", password: "pass", merchantEntity: "merchant-123",
});

describe("SSRF / credential-leak guard on manage_payment", () => {
  it("rejects an off-origin commandHref before any request is made", async () => {
    await expect(
      api.managePayment({commandName: "settle", commandHref: "https://evil.com/steal"} as any),
    ).rejects.toThrow(/non-Worldpay host/);
  });

  it("rejects a userinfo-smuggled host (origin excludes userinfo)", async () => {
    await expect(
      api.managePayment({commandName: "settle", commandHref: "https://try.access.worldpay.com@evil.com/x"} as any),
    ).rejects.toThrow(/non-Worldpay host/);
  });
});

describe("createRequest instrument selection", () => {
  const base = {
    cardHolderName: "John Doe", amount: 1000, currency: "GBP",
    address1: "1 High St", city: "London", countryCode: "GB",
    storeCard: false, createToken: false, channel: "moto" as const,
  };
  it("rejects supplying both sessionHref and tokenHref", () => {
    expect(() => api.createRequest({
      ...base,
      sessionHref: "https://try.access.worldpay.com/sessions/a",
      tokenHref: "https://try.access.worldpay.com/tokens/b",
    } as any)).toThrow(/not both/);
  });
  it("rejects supplying neither instrument", () => {
    expect(() => api.createRequest({...base} as any)).toThrow(/must be provided/);
  });
  it("generates a unique transactionReference when none supplied", () => {
    const a = api.createRequest({...base, sessionHref: "https://try.access.worldpay.com/sessions/a"} as any);
    const b = api.createRequest({...base, sessionHref: "https://try.access.worldpay.com/sessions/a"} as any);
    expect(a.transactionReference).not.toEqual(b.transactionReference);
    expect(a.transactionReference).toMatch(/^TR-/);
  });
});
