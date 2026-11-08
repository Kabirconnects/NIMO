// tools/shared/secrets.ts
const PATTERNS: RegExp[] = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(password|passwd|api[_ -]?key|secret|token)\s*[:=]\s*\S{6,}/i,
];

export const containsSecret = (text: string) => PATTERNS.some((r) => r.test(text));

export const redactSecrets = (text: string) =>
  PATTERNS.reduce(
    (t, r) => t.replace(new RegExp(r.source, r.flags + "g"), "[redacted]"),
    text,
  );