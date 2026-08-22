#!/usr/bin/env node

import {WorldpayMCPServer} from "@/worldpay-mcp-server";
import {StdioTransport} from "@/transports/StdioTransport";
import {logger} from "@/utils/logger";
import {loadWorldpayConfig} from "@/config";

try {
  const server = new WorldpayMCPServer(loadWorldpayConfig());
  const transport = new StdioTransport(server);
  await transport.connect();
} catch (error) {
  logger.error('Failed to start Worldpay MCP STDIO server:', error);
  // Also surface fatal boot errors to stderr (the logger only writes to a file).
  console.error(`Failed to start Worldpay MCP STDIO server: ${(error as Error).message}`);
  process.exit(1);
}
