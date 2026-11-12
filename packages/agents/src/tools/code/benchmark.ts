import { tool, type Tool } from "ai";
import { z } from "zod";

import { resolveSafe, toRel, tail } from "../shared/workspace.js";
import { assertCanRunShell } from "../shared/permissions.js";
import { runProcess } from "../shared/process.js";

interface Stats {
  meanMs: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  stdDevMs: number;
  totalMs: number;
}

function stats(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1]! + sorted[middle]!) / 2
      : sorted[middle]!;
  const variance =
    sorted.reduce((acc, value) => acc + (value - mean) ** 2, 0) / sorted.length;
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1));

  return {
    meanMs: Math.round(mean),
    medianMs: Math.round(median),
    minMs: Math.min(...sorted),
    maxMs: Math.max(...sorted),
    p95Ms: sorted[p95Index]!,
    stdDevMs: Math.round(Math.sqrt(variance)),
    totalMs: Math.round(sum),
  };
}

export const benchmarkTool: Tool = tool({
  description:
    "Time a command over several runs and return statistics (mean, median, min, max, p95, stddev). " +
    "Useful for measuring build/test latency or comparing implementations. " +
    "Supports warmup runs so the first cold run does not skew the result. " +
    "Runs through the allowlisted process sandbox; the command should be non-interactive. " +
    "Requires Auto mode or AGENT_ALLOW_SHELL=true.",

  inputSchema: z.object({
    command: z.string().min(1).max(4_000).optional()
      .describe("Command to measure, e.g. 'pnpm build' or 'bun test'"),
    argv: z.array(z.string().min(1).max(1_000)).min(1).max(100).optional()
      .describe("Explicit argument list (preferred when arguments contain spaces)"),
    runs: z.number().int().min(1).max(20).default(3)
      .describe("Measured runs"),
    warmup: z.number().int().min(0).max(5).default(1)
      .describe("Unmeasured warmup runs"),
    cwd: z.string().default(".").describe("Working directory relative to the workspace"),
    timeoutMs: z.number().int().min(1_000).max(600_000).default(180_000)
      .describe("Timeout per run"),
  }),

  execute: async ({ command, argv, runs, warmup, cwd, timeoutMs }) => {
    try {
      assertCanRunShell();
      if (!command && !argv) throw new Error("Provide either command or argv");
      const dir = await resolveSafe(cwd);

      const results: { durationMs: number; exitCode: number | null; ok: boolean; timedOut: boolean }[] = [];
      let lastOutput = "";

      for (let i = 0; i < warmup + runs; i++) {
        const result = await runProcess({
          command: argv ? undefined : command,
          argv,
          cwd: dir,
          timeoutMs,
          maxOutputBytes: 20_000,
        });

        lastOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");

        if (i >= warmup) {
          results.push({
            durationMs: result.durationMs,
            exitCode: result.exitCode,
            ok: result.ok,
            timedOut: result.timedOut,
          });
        }
      }

      const durations = results.map((r) => r.durationMs);
      const failed = results.filter((r) => !r.ok).length;

      return {
        success: failed === 0,
        command: argv ? argv.join(" ") : command,
        cwd: toRel(dir),
        runs,
        warmup,
        failedRuns: failed,
        ...stats(durations),
        samples: results,
        outputTail: tail(lastOutput, 4_000),
        hint:
          failed > 0
            ? "Some runs failed; timing comparisons are only meaningful when every run exits 0."
            : undefined,
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
