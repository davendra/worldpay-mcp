import request from "supertest";
import {HTTPTransport} from "@/transports/HTTPTransport";
import {WorldpayMCPServer} from "@/worldpay-mcp-server";

const CONFIG = {
  name: "Worldpay", version: "1.0.0",
  baseUrl: "https://try.access.worldpay.com",
  username: "user", password: "pass", merchantEntity: "merchant-123",
};
const factory = () => new WorldpayMCPServer(CONFIG);
const TOKEN = "test-secret-token";
const PORT = 3991;
const BASE = `http://127.0.0.1:${PORT}`;
const INIT = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: {protocolVersion: "2025-06-18", capabilities: {}, clientInfo: {name: "t", version: "0"}},
};

describe("HTTP transport — auth (C2)", () => {
  it("refuses to start without MCP_AUTH_TOKEN (fail-closed)", async () => {
    const prev = process.env.MCP_AUTH_TOKEN;
    delete process.env.MCP_AUTH_TOKEN;
    const t = new HTTPTransport(3990, factory);
    await expect(t.connect()).rejects.toThrow(/MCP_AUTH_TOKEN/);
    if (prev !== undefined) process.env.MCP_AUTH_TOKEN = prev;
  });

  describe("with a token set", () => {
    let t: HTTPTransport;
    beforeAll(async () => {
      process.env.MCP_AUTH_TOKEN = TOKEN;
      t = new HTTPTransport(PORT, factory);
      await t.connect();
    });
    afterAll(async () => {
      await t.close();
      delete process.env.MCP_AUTH_TOKEN;
    });

    it("serves /healthz without auth", async () => {
      const res = await request(BASE).get("/healthz");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({status: "up"});
    });

    it("rejects POST /mcp with no bearer (401)", async () => {
      const res = await request(BASE).post("/mcp")
        .set("Accept", "application/json, text/event-stream").send(INIT);
      expect(res.status).toBe(401);
    });

    it("rejects POST /mcp with a wrong bearer (401)", async () => {
      const res = await request(BASE).post("/mcp")
        .set("Authorization", "Bearer nope")
        .set("Accept", "application/json, text/event-stream").send(INIT);
      expect(res.status).toBe(401);
    });

    it("accepts initialize with the correct bearer (not 401/403)", async () => {
      const res = await request(BASE).post("/mcp")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("Accept", "application/json, text/event-stream").send(INIT);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      expect(res.status).toBeLessThan(500);
    });
  });
});
