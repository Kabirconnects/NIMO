import { tool, type Tool } from "ai";
import { z } from "zod";

import { clip } from "../shared/workspace.js";

export const webFetchTool: Tool = tool({
  description:
    "Fetch a public URL and return its text content (markdown-stripped HTML or raw). " +
    "Use for research: papers, docs, changelogs. No workspace access, no secrets, 15s timeout, 50KB cap.",

  inputSchema: z.object({
    url: z.string().url().describe("Public URL to fetch"),
    maxBytes: z.number().int().min(1_000).max(100_000).default(30_000),
  }),

  execute: async ({ url, maxBytes }) => {
    try {
      const u = new URL(url);
      if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http/https URLs allowed");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Nimo-research/1.0" } });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      const isHtml = (res.headers.get("content-type") ?? "").includes("html");
      const body = isHtml
        ? text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        : text;
      return { success: true as const, url, status: res.status, bytes: body.length, body: clip(body, maxBytes) };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
