import { tool, type Tool } from "ai";
import { z } from "zod";

import { clip } from "../shared/workspace.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DateSource =
  | "header"
  | "meta"
  | "json-ld"
  | "time-tag"
  | "xml"
  | "body";

export interface FoundDate {
  raw: string;
  iso?: string;
  source: DateSource;
  context?: string;
}

export interface FetchResult {
  success: true;
  url: string;
  finalUrl: string;
  redirected: boolean;
  status: number;
  statusText: string;
  fetchedAt: string;
  contentType?: string;
  charset?: string;
  bytes: number;
  textLength: number;
  truncated: boolean;
  binarySkipped: boolean;
  title?: string;
  description?: string;
  author?: string;
  canonical?: string;
  language?: string;
  publishedDate?: string;
  modifiedDate?: string;
  lastModified?: string;
  dates: string[];
  datesDetailed: FoundDate[];
  links: string[];
  images: string[];
  headers: Record<string, string>;
  meta: Record<string, string>;
  jsonLd: unknown[];
  selectorResults?: string[];
  wordCount: number;
  readingTimeMinutes: number;
  body: string;
}

export interface FetchError {
  success: false;
  url?: string;
  error: string;
}

// ---------------------------------------------------------------------------
// SSRF / safety guards
// ---------------------------------------------------------------------------

const BLOCKED_HOST_EXACT = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return true;
  if (BLOCKED_HOST_EXACT.has(h)) return true;
  if (h === "::1" || h === "0.0.0.0" || h.startsWith("fe80:") || /^f[cd]/.test(h)) return true;
  if (/\.(local|internal|lan|home|corp)$/.test(h)) return true;
  // IPv4 private / loopback / link-local / documentation ranges
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if ((a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))) return true;
  }
  return false;
}

function assertFetchableUrl(raw: string): URL {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol))
    throw new Error("Only http/https URLs allowed");
  if (u.username || u.password) throw new Error("URLs with credentials are not allowed");
  if (isBlockedHost(u.hostname))
    throw new Error(`Blocked host (SSRF guard): ${u.hostname}`);
  return u;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (m, n) =>
      NAMED_ENTITIES[n.toLowerCase()] ?? m,
    );
}

function getAttr(tag: string, name: string): string | undefined {
  const re = new RegExp(
    `${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const m = tag.match(re);
  if (!m) return undefined;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? "").trim();
}

function stripInner(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Convert HTML into readable plain text, preserving line structure. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|main|nav|aside|figure|figcaption|blockquote|pre|ul|ol|table|form|fieldset|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<tr[^>]*>/gi, "\n")
    .replace(/<t[dh][^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Convert HTML into lightweight Markdown. */
export function htmlToMarkdown(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => `\n\`\`\`\n${stripInner(c)}\n\`\`\`\n`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => `\`${stripInner(c)}\``)
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl, c) => `\n${"#".repeat(Number(lvl))} ${stripInner(c)}\n`)
    .replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, c) => `**${stripInner(c)}**`)
    .replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, c) => `*${stripInner(c)}*`)
    .replace(/<a\s[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi,
      (_, href, href2, c) => {
        const t = stripInner(c);
        const h = href ?? href2 ?? "";
        return t ? `[${t}](${h})` : h;
      })
    .replace(/<img\s[^>]*>/gi, (tag) => {
      const alt = getAttr(tag, "alt") ?? "";
      const src = getAttr(tag, "src") ?? "";
      return src ? `![${alt}](${src})` : "";
    })
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `\n- ${stripInner(c)}`)
    .replace(/<hr\s*\/?>/gi, "\n---\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|main|nav|aside|figure|blockquote|ul|ol|table|form)>/gi, "\n")
    .replace(/<tr[^>]*>/gi, "\n")
    .replace(/<t[dh][^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Date extraction
// ---------------------------------------------------------------------------

const MON =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

export function tryParseDate(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const ts = Date.parse(t);
  if (Number.isNaN(ts)) return undefined;
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  if (year < 1900 || year > 2200) return undefined;
  return d.toISOString();
}

export function extractDatesFromText(
  text: string,
  limit = 100,
): FoundDate[] {
  const patterns: RegExp[] = [
    // "January 5, 2024" / "Jan 5 2024" / "Jan. 5th, 2024"
    new RegExp(`\\b${MON}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, "gi"),
    // "5 January 2024" / "5th Jan, 2024"
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MON}\\.?,?\\s+\\d{4}\\b`, "gi"),
    // ISO 8601: 2024-01-05 / 2024-01-05T12:30:00Z / with offset
    /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/gi,
    // RFC 2822 / HTTP date: Mon, 05 Jan 2024 12:30:00 GMT
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}(?::\d{2})?\s*(?:GMT|UTC|[+-]\d{4})\b/gi,
    // Numeric: 01/02/2024, 1-2-24, 01.02.2024
    /\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/g,
    // Year-month: 2024-01 / 2024/01
    /\b\d{4}[\/\-]\d{2}\b/g,
  ];

  const found: FoundDate[] = [];
  const seen = new Set<string>();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const raw = m[0].trim();
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const iso = tryParseDate(raw);
      const idx = m.index ?? 0;
      const context = text
        .slice(Math.max(0, idx - 40), idx + raw.length + 40)
        .replace(/\s+/g, " ")
        .trim();
      found.push({ raw, iso, source: "body", context });
      if (found.length >= limit) return found;
    }
  }
  return found;
}

function pushDate(
  out: FoundDate[],
  raw: string | undefined | null,
  source: DateSource,
  context?: string,
) {
  if (!raw) return;
  const r = String(raw).trim();
  if (!r) return;
  const key = `${r.toLowerCase()}|${source}`;
  if (out.some((d) => `${d.raw.toLowerCase()}|${d.source}` === key)) return;
  out.push({ raw: r, iso: tryParseDate(r), source, context });
}

function sortDates(dates: FoundDate[]): FoundDate[] {
  return [...dates].sort((a, b) => {
    if (a.iso && b.iso) return a.iso.localeCompare(b.iso);
    if (a.iso) return -1;
    if (b.iso) return 1;
    return a.raw.localeCompare(b.raw);
  });
}

// ---------------------------------------------------------------------------
// HTML metadata extraction
// ---------------------------------------------------------------------------

export interface ParsedMeta {
  title?: string;
  meta: Record<string, string>;
  jsonLd: unknown[];
  timeDates: FoundDate[];
  links: string[];
  images: string[];
  canonical?: string;
  language?: string;
}

export function parseHtmlMeta(html: string, baseUrl: string): ParsedMeta {
  const meta: Record<string, string> = {};
  for (const chunk of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name =
      getAttr(chunk, "property") ??
      getAttr(chunk, "name") ??
      getAttr(chunk, "http-equiv");
    const content = getAttr(chunk, "content");
    if (name && content != null) meta[name.toLowerCase()] = content;
  }

  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM?.[1] ? stripInner(titleM[1]) : undefined;

  const langM = html.match(/<html\b[^>]*\blang\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const language = langM ? (langM[1] ?? langM[2]) : undefined;

  let canonical: string | undefined;
  for (const chunk of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (getAttr(chunk, "rel") ?? "").toLowerCase();
    if (rel.split(/\s+/).includes("canonical")) {
      const href = getAttr(chunk, "href");
      if (href) {
        try {
          canonical = new URL(href, baseUrl).href;
        } catch {
          canonical = href;
        }
      }
    }
  }

  // Links (anchors) — resolved, de-duplicated
  const linkSet = new Set<string>();
  for (const chunk of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = getAttr(chunk, "href");
    if (!href || href.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(href)) continue;
    try {
      linkSet.add(new URL(href, baseUrl).href);
    } catch {
      /* skip unresolvable */
    }
  }

  // Images
  const imgSet = new Set<string>();
  for (const chunk of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = getAttr(chunk, "src") ?? getAttr(chunk, "data-src");
    if (!src || src.startsWith("data:")) continue;
    try {
      imgSet.add(new URL(src, baseUrl).href);
    } catch {
      /* skip */
    }
  }

  // <time datetime="...">text</time>
  const timeDates: FoundDate[] = [];
  for (const m of html.matchAll(/<time\b[^>]*datetime\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/time>/gi)) {
    const raw = m[1] ?? m[2];
    const ctx = stripInner(m[3] ?? "");
    pushDate(timeDates, raw, "time-tag", ctx || undefined);
  }

  // JSON-LD blocks
  const jsonLd: unknown[] = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse((m[1] ?? "").trim());
      jsonLd.push(parsed);
    } catch {
      /* malformed JSON-LD: ignore */
    }
  }

  return {
    title,
    meta,
    jsonLd,
    timeDates,
    links: [...linkSet],
    images: [...imgSet],
    canonical,
    language,
  };
}

const JSONLD_DATE_KEYS =
  /^(datePublished|dateModified|dateCreated|uploadDate|datePosted|publishedDate|modifiedDate|startDate|endDate|date|created|updated|published|modified)$/i;

function collectJsonLdDates(node: unknown, out: FoundDate[], depth = 0) {
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdDates(item, out, depth + 1);
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (typeof v === "string" && JSONLD_DATE_KEYS.test(k)) {
        pushDate(out, v, "json-ld", k);
      }
      collectJsonLdDates(v, out, depth + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Simple CSS-selector extraction (tag / #id / .class / [attr=value])
// ---------------------------------------------------------------------------

export function extractBySelector(html: string, selector: string): string[] {
  const sel = selector.trim();
  if (!sel) return [];
  const tagM = sel.match(/^([a-zA-Z][\w-]*)/);
  const idM = sel.match(/#([\w-]+)/);
  const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const attrM = sel.match(/\[([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/);

  let open = "";
  if (idM) open += `\\bid\\s*=\\s*(?:"${idM[1]}"|'${idM[1]}')`;
  for (const cls of classes)
    open += `\\bclass\\s*=\\s*(?:"[^"]*\\b${cls}\\b[^"]*"|'[^']*\\b${cls}\\b[^']*')`;
  if (attrM) {
    const val = attrM[2] ?? attrM[3] ?? attrM[4]?.trim();
    open += val
      ? `\\b${attrM[1]}\\s*=\\s*(?:"${val}"|'${val}'|${val}\\b)`
      : `\\b${attrM[1]}\\b`;
  }

  const tag = tagM ? tagM[1] : "([a-zA-Z][\\w-]*)";
  const re = new RegExp(
    `<${tag}\\b[^>]*${open}[^>]*>([\\s\\S]*?)<\\/${tagM ? tagM[1] : "\\1"}>`,
    "gi",
  );
  const out: string[] = [];
  for (const m of html.matchAll(re)) {
    const text = stripInner(m[2] ?? m[1] ?? "");
    if (text) out.push(text);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetch implementation
// ---------------------------------------------------------------------------

const BINARY_RE =
  /^(image|audio|video|font)\/|^application\/(pdf|zip|gzip|octet-stream|msword|vnd\.|x-)/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readBoundedText(
  res: Response,
  cap: number,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!res.body) {
    const text = await res.text();
    return { text: text.slice(0, cap), bytes: text.length, truncated: text.length > cap };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      bytes += value.byteLength;
      if (text.length < cap) {
        text += decoder.decode(value, { stream: true });
        if (text.length >= cap) {
          text = text.slice(0, cap);
          truncated = true;
          await reader.cancel().catch(() => {});
          break;
        }
      } else {
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
    }
  }
  text += decoder.decode();
  return { text: text.slice(0, cap), bytes, truncated };
}

export interface FetchOptions {
  url: string;
  maxBytes: number;
  format: "auto" | "text" | "html" | "markdown" | "raw";
  timeoutMs: number;
  retries: number;
  userAgent?: string;
  headers?: Record<string, string>;
  method: "GET" | "HEAD";
  includeLinks: boolean;
  includeMeta: boolean;
  includeHeaders: boolean;
  maxLinks: number;
  dateLimit: number;
  selector?: string;
}

async function fetchOne(opts: FetchOptions): Promise<FetchResult | FetchError> {
  const inputUrl = opts.url;
  try {
    assertFetchableUrl(inputUrl);
  } catch (error) {
    return {
      success: false as const,
      url: inputUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const scanCap = Math.max(opts.maxBytes * 4, 200_000);
  let lastError: unknown;
  let res: Response | undefined;
  let rawText = "";
  let rawBytes = 0;
  let rawTruncated = false;

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      const headers: Record<string, string> = {
        "User-Agent": opts.userAgent ?? "Nimo-research/2.0 (+extremely-powerful-web-fetch)",
        Accept: "text/html,application/xhtml+xml,application/json,application/xml,text/plain,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(opts.headers ?? {}),
      };
      res = await fetch(inputUrl, {
        method: opts.method,
        signal: ctrl.signal,
        headers,
        redirect: "follow",
      });
      clearTimeout(timer);

      if ((res.status === 429 || res.status >= 500) && attempt < opts.retries) {
        const retryAfter = res.headers.get("retry-after");
        const waitMs = retryAfter
          ? Math.min(5_000, Math.max(0, parseInt(retryAfter, 10) * 1000) || 1_000)
          : 500 * 2 ** attempt;
        await res.body?.cancel().catch(() => {});
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) {
        return {
          success: false as const,
          url: inputUrl,
          error: `HTTP ${res.status} ${res.statusText}`,
        };
      }

      if (opts.method === "HEAD") {
        rawText = "";
        rawBytes = Number(res.headers.get("content-length") ?? 0);
      } else {
        const bounded = await readBoundedText(res, scanCap);
        rawText = bounded.text;
        rawBytes = bounded.bytes;
        rawTruncated = bounded.truncated;
      }
      break;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < opts.retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      return {
        success: false as const,
        url: inputUrl,
        error:
          error instanceof Error
            ? error.name === "AbortError"
              ? `Timeout after ${opts.timeoutMs}ms`
              : error.message
            : String(error),
      };
    }
  }

  if (!res) {
    return {
      success: false as const,
      url: inputUrl,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    };
  }

  const finalUrl = res.url || inputUrl;
  const contentType = res.headers.get("content-type") ?? undefined;
  const charset = contentType?.match(/charset=([\w-]+)/i)?.[1];
  const isBinary = contentType ? BINARY_RE.test(contentType) : false;
  const isHtml =
    (contentType ?? "").includes("html") ||
    /^\s*(<!doctype|<html)/i.test(rawText);
  const isJson =
    (contentType ?? "").includes("json") ||
    (/^\s*[\[{]/.test(rawText) && (() => { try { JSON.parse(rawText); return true; } catch { return false; } })());
  const isXml =
    (contentType ?? "").includes("xml") || /^\s*<\?xml/i.test(rawText);

  // ---- Dates from every source -------------------------------------------
  const allDates: FoundDate[] = [];

  pushDate(allDates, res.headers.get("date"), "header", "Date");
  pushDate(allDates, res.headers.get("last-modified"), "header", "Last-Modified");
  const expires = res.headers.get("expires");
  if (expires && expires !== "0") pushDate(allDates, expires, "header", "Expires");

  let parsed: ParsedMeta | undefined;
  if (isHtml && !isBinary) parsed = parseHtmlMeta(rawText, finalUrl);

  if (parsed) {
    const m = parsed.meta;
    pushDate(allDates, m["article:published_time"], "meta", "article:published_time");
    pushDate(allDates, m["article:modified_time"], "meta", "article:modified_time");
    pushDate(allDates, m["publication_date"] ?? m["datepublished"], "meta", "publication_date");
    pushDate(allDates, m["og:updated_time"] ?? m["og:article:modified_time"], "meta", "og:updated_time");
    pushDate(allDates, m["dc.date"] ?? m["dc:date"] ?? m["dcterms.created"], "meta", "dc.date");
    pushDate(allDates, m["dcterms.modified"] ?? m["dc.modified"], "meta", "dcterms.modified");
    pushDate(allDates, m["date"] ?? m["lastmod"], "meta", "date");
    for (const d of parsed.timeDates) pushDate(allDates, d.raw, d.source, d.context);
    for (const block of parsed.jsonLd) collectJsonLdDates(block, allDates);
  }

  if (isXml && !isBinary) {
    for (const m of rawText.matchAll(/<(?:lastmod|pubDate|updated|published|modified|date)>([^<]+)<\/(?:lastmod|pubDate|updated|published|modified|date)>/gi)) {
      pushDate(allDates, m[1], "xml");
    }
    // RSS / Atom / sitemap: also scan whole document for dates
    for (const d of extractDatesFromText(rawText, opts.dateLimit)) {
      if (d.source === "body") d.source = "xml";
      pushDate(allDates, d.raw, "xml", d.context);
    }
  }

  if (!isBinary && rawText) {
    const searchable = isHtml ? htmlToText(rawText) : rawText;
    for (const d of extractDatesFromText(searchable, opts.dateLimit)) {
      pushDate(allDates, d.raw, "body", d.context);
    }
  }

  const datesDetailed = sortDates(allDates).slice(0, opts.dateLimit * 3);
  const dates = datesDetailed.map((d) => d.raw);

  const metaDates = (keys: string[]): string | undefined => {
    if (!parsed) return undefined;
    for (const k of keys) {
      const iso = tryParseDate(parsed.meta[k] ?? "");
      if (iso) return iso;
    }
    return undefined;
  };

  const jsonLdDate = (re: RegExp): string | undefined => {
    if (!parsed) return undefined;
    const acc: FoundDate[] = [];
    for (const block of parsed.jsonLd) collectJsonLdDates(block, acc);
    const hit = acc.find((d) => re.test(d.context ?? "") && d.iso);
    return hit?.iso;
  };

  const publishedDate =
    metaDates(["article:published_time", "publication_date", "datepublished"]) ??
    jsonLdDate(/published/i) ??
    parsed?.timeDates.find((d) => d.iso)?.iso ??
    datesDetailed.find((d) => d.iso)?.iso;

  const modifiedDate =
    metaDates(["article:modified_time", "og:updated_time", "dcterms.modified", "dc.modified"]) ??
    jsonLdDate(/modified/i) ??
    tryParseDate(res.headers.get("last-modified") ?? "");

  // ---- Body ---------------------------------------------------------------
  let body = "";
  let binarySkipped = false;
  if (isBinary) {
    binarySkipped = true;
    body = "";
  } else if (opts.format === "raw" || opts.format === "html") {
    body = rawText;
  } else if (isHtml) {
    body = opts.format === "markdown" ? htmlToMarkdown(rawText) : htmlToText(rawText);
  } else if (isJson) {
    try {
      body = JSON.stringify(JSON.parse(rawText), null, 2);
    } catch {
      body = rawText;
    }
  } else {
    body = rawText;
  }

  let selectorResults: string[] | undefined;
  if (opts.selector && isHtml) {
    selectorResults = extractBySelector(rawText, opts.selector);
    if (selectorResults.length > 0) body = selectorResults.join("\n\n");
  }

  const clippedBody = clip(body, opts.maxBytes);
  const words = clippedBody.split(/\s+/).filter(Boolean).length;

  const headers: Record<string, string> = {};
  if (opts.includeHeaders) {
    for (const h of [
      "content-type",
      "content-length",
      "date",
      "last-modified",
      "expires",
      "etag",
      "cache-control",
      "location",
      "x-powered-by",
    ]) {
      const v = res.headers.get(h);
      if (v) headers[h] = v;
    }
  }

  return {
    success: true as const,
    url: inputUrl,
    finalUrl,
    redirected: finalUrl !== inputUrl,
    status: res.status,
    statusText: res.statusText,
    fetchedAt: new Date().toISOString(),
    contentType,
    charset,
    bytes: rawBytes,
    textLength: clippedBody.length,
    truncated: rawTruncated || body.length > opts.maxBytes,
    binarySkipped,
    title: parsed?.title,
    description:
      parsed?.meta["description"] ??
      parsed?.meta["og:description"] ??
      parsed?.meta["twitter:description"],
    author:
      parsed?.meta["author"] ??
      parsed?.meta["article:author"] ??
      parsed?.meta["og:article:author"],
    canonical: parsed?.canonical,
    language: parsed?.language,
    publishedDate,
    modifiedDate,
    lastModified: tryParseDate(res.headers.get("last-modified") ?? ""),
    dates,
    datesDetailed,
    links: opts.includeLinks ? (parsed?.links ?? []).slice(0, opts.maxLinks) : [],
    images: opts.includeLinks ? (parsed?.images ?? []).slice(0, opts.maxLinks) : [],
    headers,
    meta: opts.includeMeta ? (parsed?.meta ?? {}) : {},
    jsonLd: opts.includeMeta ? (parsed?.jsonLd ?? []).slice(0, 5) : [],
    selectorResults,
    wordCount: words,
    readingTimeMinutes: Math.max(1, Math.ceil(words / 200)),
    body: clippedBody,
  };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const webFetchTool: Tool = tool({
  description:
    "Extremely powerful web fetcher: fetch any public URL and get full text (or Markdown/HTML/JSON), " +
    "page title/description/author/canonical, **every date on the page** (HTTP Last-Modified/Date headers, " +
    "meta tags like article:published_time, JSON-LD datePublished/dateModified, <time> tags, RSS/sitemap XML dates, " +
    "and dates in the body text — returned as raw + ISO + context and sorted chronologically), " +
    "outbound links, images, response headers, and JSON-LD. " +
    "Supports batch URLs, GET/HEAD, retries with backoff, custom headers/User-Agent, CSS-selector extraction, " +
    "and configurable size/timeout caps. Use for research: papers, docs, changelogs, feeds, APIs.",

  inputSchema: z.object({
    url: z.string().url().optional().describe("Public URL to fetch (single mode)"),
    urls: z
      .array(z.string().url())
      .max(10)
      .optional()
      .describe("Multiple URLs to fetch in parallel (batch mode)"),
    format: z
      .enum(["auto", "text", "html", "markdown", "raw"])
      .default("auto")
      .describe("Output format: auto detects, text strips HTML, html/raw return source, markdown converts"),
    maxBytes: z.number().int().min(1_000).max(200_000).default(30_000),
    method: z.enum(["GET", "HEAD"]).default("GET"),
    timeoutMs: z.number().int().min(1_000).max(60_000).default(15_000),
    retries: z.number().int().min(0).max(2).default(1),
    userAgent: z.string().max(200).optional(),
    headers: z.record(z.string(), z.string()).optional().describe("Extra request headers"),
    selector: z
      .string()
      .max(200)
      .optional()
      .describe("Simple CSS selector (tag / #id / .class / [attr=value]) — body becomes only matching elements' text"),
    includeLinks: z.boolean().default(true),
    includeMeta: z.boolean().default(true),
    includeHeaders: z.boolean().default(true),
    maxLinks: z.number().int().min(0).max(200).default(50),
    dateLimit: z.number().int().min(1).max(100).default(25),
  }),

  execute: async (args) => {
    const targets = args.urls?.length ? args.urls : args.url ? [args.url] : [];
    if (targets.length === 0) {
      return { success: false as const, error: "Provide `url` or `urls`" };
    }
    const base = {
      maxBytes: args.maxBytes,
      format: args.format,
      timeoutMs: args.timeoutMs,
      retries: args.retries,
      userAgent: args.userAgent,
      headers: args.headers,
      method: args.method,
      includeLinks: args.includeLinks,
      includeMeta: args.includeMeta,
      includeHeaders: args.includeHeaders,
      maxLinks: args.maxLinks,
      dateLimit: args.dateLimit,
      selector: args.selector,
    };

    if (targets.length === 1) {
      return fetchOne({ ...base, url: targets[0]! });
    }

    const results = await Promise.allSettled(
      targets.map((url) => fetchOne({ ...base, url })),
    );
    const settled = results.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : { success: false as const, error: String(r.reason) },
    );
    return {
      success: settled.every((r) => r.success),
      count: settled.length,
      fetchedAt: new Date().toISOString(),
      results: settled,
    };
  },
});
