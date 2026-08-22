import "dotenv/config";
import * as winston from 'winston';
import {redact} from "@/utils/redact";

const {combine, timestamp, prettyPrint} = winston.format;

// Defense in depth: even if a call site forgets to redact, this format masks
// sensitive keys (PAN, CVC, billing PII) in any logged metadata before it hits disk.
const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (key === "level" || key === "message" || key === "timestamp") continue;
    (info as Record<string, unknown>)[key] = redact((info as Record<string, unknown>)[key]);
  }
  return info;
});

const level = process.env.LOG_LEVEL || "info";

export const logger = winston.createLogger({
  level,
  format: combine(
    redactFormat(),
    timestamp(),
    prettyPrint()
  ),
  transports: [
    new winston.transports.File({
      filename: process.env.LOG_FILE || 'worldpay-mcp.log',
      level,
    })
  ],
});
