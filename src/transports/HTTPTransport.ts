import express, {Application, NextFunction, Request, Response, Router} from "express";
import {randomUUID, timingSafeEqual} from "node:crypto";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {logger} from "@/utils/logger";
import {ConnectableServerTransport} from "@/transports/ServerTransport";
import {WorldpayMCPServer} from "@/worldpay-mcp-server";
import cors from 'cors';

interface Session {
  transport: StreamableHTTPServerTransport;
  server: WorldpayMCPServer;
  lastActivity: number;
}

const clampPositive = (raw: string | undefined, fallback: number): number => {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const MAX_SESSIONS = clampPositive(process.env.MCP_MAX_SESSIONS, 100);
const SESSION_TTL_MS = clampPositive(process.env.MCP_SESSION_TTL_MS, 30 * 60 * 1000);

/**
 * Streamable HTTP transport, hardened per the MCP security best practices:
 * - bearer-token authentication on /mcp (required; fail-closed if unset)
 * - DNS-rebinding protection (Host/Origin validation) via the SDK transport
 * - binds to 127.0.0.1 by default
 * - a fresh MCP server per session (no shared-instance cross-session bleed)
 * - session count cap + idle TTL eviction
 */
export class HTTPTransport implements ConnectableServerTransport {
  private app: Application;
  private sessions: Map<string, Session>;
  private readonly port: number;
  private readonly host: string;
  private readonly serverFactory: () => WorldpayMCPServer;
  private sweepTimer?: NodeJS.Timeout;
  private httpServer?: import("node:http").Server;

  constructor(port: number, serverFactory: () => WorldpayMCPServer, host = process.env.HOST || "127.0.0.1") {
    this.app = express();
    this.sessions = new Map<string, Session>();
    this.port = port;
    this.host = host;
    this.serverFactory = serverFactory;
  }

  private get authToken(): string | undefined {
    return process.env.MCP_AUTH_TOKEN;
  }

  private get allowedHosts(): string[] {
    const base = [`${this.host}:${this.port}`, `localhost:${this.port}`, `127.0.0.1:${this.port}`];
    const extra = (process.env.MCP_ALLOWED_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return [...new Set([...base, ...extra])];
  }

  private get allowedOrigins(): string[] {
    return (process.env.CORS_ORIGIN ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  }

  public async connect(): Promise<void> {
    if (!this.authToken) {
      throw new Error(
        "MCP_AUTH_TOKEN is required to run the HTTP transport (it authenticates inbound /mcp requests). " +
          "Set a strong random token, or use the stdio transport for local single-client use.",
      );
    }

    this.configureApp();
    this.registerRoutes();
    this.registerErrorHandler();
    this.startSessionSweeper();

    this.httpServer = this.app.listen(this.port, this.host, () => {
      logger.info(`Worldpay MCP HTTP server listening on ${this.host}:${this.port}`);
    });

    this.httpServer.on('error', (err) => {
      logger.error(`HTTP server failed: ${err.message}`);
    });
  }

  /** Stop the HTTP server and the session sweeper (used by tests and shutdown). */
  public async close(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const s of this.sessions.values()) {
      await s.transport.close().catch(() => undefined);
    }
    this.sessions.clear();
    await new Promise<void>((resolve) => {
      if (!this.httpServer) return resolve();
      this.httpServer.close(() => resolve());
    });
  }

  private configureApp(): void {
    // CORS: never `*` with credentials. Cross-origin is allowed only when an
    // explicit CORS_ORIGIN allowlist is configured; otherwise same-origin only.
    const origins = this.allowedOrigins;
    this.app.use(cors({
      origin: origins.length > 0 ? origins : false,
      exposedHeaders: ["Mcp-Session-Id"],
      credentials: origins.length > 0,
      allowedHeaders: ['Content-Type', 'Authorization', 'mcp-session-id', 'last-event-id', 'mcp-protocol-version'],
    }));
    this.app.disable("x-powered-by");
    this.app.use(express.json({limit: "256kb"}));
    this.app.use(this.securityHeadersMiddleware());
  }

  private securityHeadersMiddleware() {
    return (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader(
        "Content-Security-Policy",
        [
          "default-src 'none'",
          "script-src 'none'",
          "style-src 'none'",
          "img-src 'none'",
          "font-src 'none'",
          "connect-src 'none'",
          "media-src 'none'",
          "object-src 'none'",
          "child-src 'none'",
          "frame-ancestors 'none'",
          "form-action 'none'",
          "base-uri 'none'",
        ].join("; ")
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("X-XSS-Protection", "1; mode=block");
      res.setHeader("Referrer-Policy", "no-referrer");
      next();
    };
  }

  // Bearer-token auth. Independent of the session id (sessions MUST NOT be used
  // for authentication per the MCP security spec). Constant-time comparison.
  private authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const expected = this.authToken!;
    const header = req.headers.authorization ?? "";
    const match = /^Bearer\s+(.+)$/.exec(header);
    const unauthorized = (desc?: string) => {
      res.setHeader("WWW-Authenticate", `Bearer${desc ? ` error="${desc}"` : ""}`);
      res.status(401).json({jsonrpc: "2.0", error: {code: -32001, message: "Unauthorized"}, id: null});
    };
    if (!match) return unauthorized();
    const provided = Buffer.from(match[1]);
    const expectedBuf = Buffer.from(expected);
    if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) {
      return unauthorized("invalid_token");
    }
    next();
  };

  private registerRoutes(): void {
    const router = Router();
    router.post("/mcp", this.authMiddleware, this.handlePost.bind(this));
    router.get("/mcp", this.authMiddleware, this.handleSessionRequest.bind(this));
    router.delete("/mcp", this.authMiddleware, this.handleSessionRequest.bind(this));
    // Health/readiness — intentionally unauthenticated so orchestrators can probe.
    router.get("/healthz", (_req, res) => res.status(200).json({ status: "up" }));
    router.get("/readyz", (_req, res) => res.status(200).json({ status: "ready" }));

    this.app.use(router);
  }

  private async handlePost(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      const existing = sessionId ? this.sessions.get(sessionId) : undefined;
      if (existing) {
        existing.lastActivity = Date.now();
        transport = existing.transport;
      } else {
        if (this.sessions.size >= MAX_SESSIONS) {
          res.status(503).json({jsonrpc: "2.0", error: {code: -32000, message: "Server session limit reached"}, id: null});
          return;
        }

        // A fresh MCP server per session — never share one instance across
        // transports (that caused 2nd-session 500s and risked cross-session leaks).
        const mcpServer = this.serverFactory();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableDnsRebindingProtection: true,
          allowedHosts: this.allowedHosts,
          allowedOrigins: this.allowedOrigins.length > 0 ? this.allowedOrigins : undefined,
          onsessioninitialized: (sid) => {
            this.sessions.set(sid, {transport, server: mcpServer, lastActivity: Date.now()});
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            this.sessions.delete(transport.sessionId);
          }
        };

        await mcpServer.connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error("POST /mcp error", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {code: -32603, message: "Internal Server Error"},
          id: null,
        });
      }
    }
  }

  handleSessionRequest = async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    session.lastActivity = Date.now();
    await session.transport.handleRequest(req, res);
  };

  private startSessionSweeper(): void {
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, s] of this.sessions) {
        if (now - s.lastActivity > SESSION_TTL_MS) {
          logger.info(`Evicting idle session ${id}`);
          void s.transport.close().catch(() => undefined);
          this.sessions.delete(id);
        }
      }
    }, 60_000);
    // Don't keep the process alive solely for the sweeper.
    this.sweepTimer.unref?.();
  }

  private registerErrorHandler(): void {
    this.app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      logger.error("Unhandled error", err);
      if (!res.headersSent) {
        res.status(500).send("Unhandled Server Error");
      }
    });
  }
}
