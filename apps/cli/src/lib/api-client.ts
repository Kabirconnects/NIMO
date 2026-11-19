import {
  DEFAULT_API_URLS,
  getApiUrl,
  getConfig,
  isApiUrlExplicit,
  updateConfig,
} from "./config";

/** Name of the httpOnly session cookie issued by the server. */
export const SESSION_COOKIE_NAME = "jwt";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status = 0, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function authHeaders(): Record<string, string> {
  const cookie = getConfig().cookie;
  return cookie ? { Cookie: cookie } : {};
}

function mergeHeaders(init?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...authHeaders(),
  };

  if (init instanceof Headers) {
    init.forEach((value, key) => {
      headers[key] = value;
    });
  } else if (Array.isArray(init)) {
    for (const [key, value] of init) headers[key] = value;
  } else if (init) {
    Object.assign(headers, init);
  }

  return headers;
}

/** Bun and Node expose `getSetCookie`; fall back to the combined header. */
function readSetCookie(headers: Headers): string[] {
  const withCookies = headers as Headers & { getSetCookie?: () => string[] };

  if (typeof withCookies.getSetCookie === "function") {
    return withCookies.getSetCookie();
  }

  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

/** Persist the session cookie (or clear it when the server expires it). */
function captureSessionCookie(response: Response): void {
  for (const raw of readSetCookie(response.headers)) {
    const pair = raw.split(";")[0]?.trim();
    if (!pair) continue;

    const separator = pair.indexOf("=");
    if (separator === -1) continue;

    const name = pair.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;

    const value = pair.slice(separator + 1).trim();
    updateConfig({
      cookie: value ? `${SESSION_COOKIE_NAME}=${value}` : undefined,
    });
  }
}

function errorMessageFromBody(body: unknown, status: number): string {
  if (body && typeof body === "object" && "error" in body) {
    const message = (body as { error?: unknown }).error;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return `Request failed (${status})`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const explicit = isApiUrlExplicit();
  const bases = explicit
    ? [getApiUrl()]
    : [...new Set([getApiUrl(), ...DEFAULT_API_URLS])];

  const headers = mergeHeaders(init.headers);
  const replayable = init.body == null || typeof init.body === "string";
  let lastError: unknown;

  for (const base of bases) {
    try {
      const response = await fetch(`${base}${suffix}`, { ...init, headers });

      // Remember a working fallback so later runs skip the probe.
      if (!explicit && base !== getApiUrl()) updateConfig({ apiUrl: base });

      captureSessionCookie(response);
      return response;
    } catch (cause) {
      // An aborted request is intentional — never retry or rewrite it.
      if (
        cause instanceof Error &&
        (cause.name === "AbortError" || cause.name === "TimeoutError")
      ) {
        throw cause;
      }

      lastError = cause;
      if (!replayable) break;
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  const hint = explicit
    ? `Cannot reach the Nimo API at ${getApiUrl()}. Is the server running?`
    : "Cannot reach the Nimo API on port 5000 or 4000. Start the server, or set NIMO_API_URL.";

  throw new ApiError(`${hint} (${reason})`);
}

/** JSON request helper used by the auth and catalog endpoints. */
export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await request(path, init);
  const body = await readJson(response);

  if (!response.ok) {
    throw new ApiError(
      errorMessageFromBody(body, response.status),
      response.status,
      body,
    );
  }

  return body as T;
}

/**
 * Start a streaming request and return the raw response.
 *
 * Errors before the stream begins still carry the server's JSON body, so the
 * caller can surface a readable message instead of "stream failed".
 */
export async function apiStream(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await request(path, init);

  if (!response.ok) {
    const body = await readJson(response);

    throw new ApiError(
      errorMessageFromBody(body, response.status),
      response.status,
      body,
    );
  }

  return response;
}
