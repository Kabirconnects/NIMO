import { collectDoctorReport, type DoctorStatus } from "./report";

const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  red: "\u001B[31m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
} as const;

const useColor = (): boolean =>
  Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function paint(code: string, value: string): string {
  return useColor() ? `${code}${value}${ANSI.reset}` : value;
}

function glyph(status: DoctorStatus): string {
  return status === "ok" ? "✓" : status === "warn" ? "!" : "✖";
}

function color(status: DoctorStatus): string {
  return status === "ok"
    ? ANSI.green
    : status === "warn"
      ? ANSI.yellow
      : ANSI.red;
}

function line(status: DoctorStatus, label: string, detail = ""): void {
  console.log(
    `  ${paint(color(status), glyph(status))} ${label}${
      detail ? ` ${paint(ANSI.dim, detail)}` : ""
    }`,
  );
}

const dim = (message: string) => console.log(paint(ANSI.dim, message));

/**
 * Diagnose the local install: runtime, configuration, and a running API.
 *
 * Exit code 1 only for problems that prevent the CLI from working at all;
 * a backend that is simply not started yet is a warning.
 */
export async function runDoctor(): Promise<number> {
  const report = await collectDoctorReport();

  console.log("");
  console.log(paint(ANSI.bold, "◆ Nimo doctor"));
  console.log("");

  for (const section of report.sections) {
    console.log(paint(ANSI.bold, `  ${section.title}`));
    for (const check of section.checks) {
      line(check.status, check.label, check.detail);
    }
    console.log("");
  }

  if (report.empty) {
    console.log(
      `  ${paint(ANSI.yellow, "Nothing configured.")} Run ${paint(ANSI.bold, "nimo setup")}.`,
    );
    console.log("");
    return 1;
  }

  if (report.failures > 0) {
    console.log(
      `  ${paint(ANSI.red, "Not ready.")} Fix the ${report.failures} problem${
        report.failures === 1 ? "" : "s"
      } above, then run “nimo doctor” again.`,
    );
    console.log("");
    return 1;
  }

  console.log(
    `  ${paint(ANSI.green, "Ready.")} Run ${paint(ANSI.bold, "nimo")} to start the API and open the chat.`,
  );
  console.log("");
  return 0;
}
