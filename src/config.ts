import {createRequire} from "node:module";

const nodeRequire = createRequire(import.meta.url);
// package.json ships with the npm package automatically (npm always includes it),
// so the advertised MCP server version tracks the release instead of a hard-coded string.
const pkg = nodeRequire("../package.json") as {version: string};

/** Version reported to MCP clients on initialize. Sourced from package.json. */
export const VERSION: string = pkg.version;

/** Server display name reported to MCP clients. */
export const SERVER_NAME = "Worldpay";

export interface WorldpayConfig {
  name: string;
  version: string;
  baseUrl: string;
  username: string;
  password: string;
  merchantEntity: string;
}

const REQUIRED_ENV = [
  "WORLDPAY_URL",
  "WORLDPAY_USERNAME",
  "WORLDPAY_PASSWORD",
  "MERCHANT_ENTITY",
] as const;

/**
 * Load and validate the Worldpay configuration from the environment.
 * Fails fast with a clear message when a required variable is missing or the
 * base URL is malformed, instead of surfacing `fetch("undefined/...")` at the
 * first tool call.
 */
export function loadWorldpayConfig(): WorldpayConfig {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Copy .env.example to .env and fill them in.`,
    );
  }

  const baseUrl = process.env.WORLDPAY_URL!.replace(/\/+$/, "");
  try {
     
    new URL(baseUrl);
  } catch {
    throw new Error(`WORLDPAY_URL is not a valid URL: "${baseUrl}"`);
  }

  return {
    name: SERVER_NAME,
    version: VERSION,
    baseUrl,
    username: process.env.WORLDPAY_USERNAME!,
    password: process.env.WORLDPAY_PASSWORD!,
    merchantEntity: process.env.MERCHANT_ENTITY!,
  };
}
