/**
 * Redaction for logging. Cardholder data (PAN, CVC) and billing PII must never
 * be written to disk (PCI-DSS). This masks sensitive keys anywhere in an object
 * graph before it reaches the logger.
 */
const SENSITIVE_KEYS = new Set(
  [
    "cvc",
    "cvcSessionHref",
    "number",
    "cardNumber",
    "pan",
    "cardHolderName",
    "name",
    "address1",
    "address2",
    "city",
    "postalCode",
    "postal_code",
    "line_one",
    "line_two",
    "accountNumber",
    "iban",
    "swiftBic",
    "payeeName",
    "cryptogram",
  ].map((k) => k.toLowerCase()),
);

const REDACTED = "[REDACTED]";

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Redact then JSON-stringify, for safe interpolation into a log line. */
export function redactedJson(value: unknown): string {
  try {
    return JSON.stringify(redact(value));
  } catch {
    return "[unserializable]";
  }
}
