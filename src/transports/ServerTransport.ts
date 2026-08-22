// A transport that can connect an MCP server to a client channel.
export interface ConnectableServerTransport {
  connect(): Promise<void>;
}
