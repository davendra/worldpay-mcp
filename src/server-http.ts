#!/usr/bin/env node
import {HTTPTransport} from "@/transports/HTTPTransport";
import {WorldpayMCPServer} from "@/worldpay-mcp-server";
import {logger} from "@/utils/logger";
import {loadWorldpayConfig} from "@/config";

try {
  const config = loadWorldpayConfig();
  const port = Number.parseInt(process.env.PORT ?? "", 10) || 3001;
  // A fresh server instance is built per session by the transport.
  const transport = new HTTPTransport(port, () => new WorldpayMCPServer(config));
  await transport.connect();
} catch (error) {
  logger.error('Failed to start Worldpay MCP HTTP server:', error);
  // Also surface fatal boot errors to stderr (the logger only writes to a file).
  console.error(`Failed to start Worldpay MCP HTTP server: ${(error as Error).message}`);
  process.exit(1);
}
