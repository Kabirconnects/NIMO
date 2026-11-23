import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import { COLORS } from "../../../theme";
import { collectDoctorReport, type DoctorReport, type DoctorStatus } from "../report";

type DoctorOverlayProps = {
  onClose: () => void;
};

function statusColor(status: DoctorStatus): string {
  if (status === "ok") return COLORS.success;
  if (status === "warn") return COLORS.warning;
  return COLORS.error;
}

function statusGlyph(status: DoctorStatus): string {
  return status === "ok" ? "✓" : status === "warn" ? "!" : "✖";
}

/** `/doctor` — the same report the terminal `nimo doctor` prints. */
export function DoctorOverlay({ onClose }: DoctorOverlayProps) {
  const dimensions = useTerminalDimensions();
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    collectDoctorReport()
      .then((result) => {
        if (!cancelled) setReport(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q" || key.name === "return") {
      key.preventDefault();
      onClose();
    }
  });

  const panelWidth = Math.max(46, Math.min(88, dimensions.width - 4));
  const panelHeight = Math.max(12, Math.min(dimensions.height - 4, 28));

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      zIndex={50}
      backgroundColor={COLORS.background}
      alignItems="center"
      justifyContent="center"
    >
      <box
        width={panelWidth}
        height={panelHeight}
        border
        borderStyle="rounded"
        borderColor={COLORS.border}
        backgroundColor={COLORS.background}
        title=" Doctor "
        titleColor={COLORS.brand}
        titleAlignment="left"
        flexDirection="column"
      >
        <scrollbox flexGrow={1} minHeight={0}>
          {!report && !error && (
            <box height={1} paddingX={1}>
              <text fg={COLORS.dim}>Checking the install…</text>
            </box>
          )}

          {error && (
            <box height={1} paddingX={1}>
              <text fg={COLORS.error} truncate>
                {error}
              </text>
            </box>
          )}

          {report?.sections.map((section) => (
            <box key={section.title} flexDirection="column" height={section.checks.length + 1}>
              <box height={1} paddingX={1}>
                <text fg={COLORS.brand} attributes={TextAttributes.BOLD}>
                  {section.title}
                </text>
              </box>

              {section.checks.map((check) => (
                <box key={check.label} flexDirection="row" height={1} paddingX={1}>
                  <box width={2} flexShrink={0}>
                    <text fg={statusColor(check.status)}>{statusGlyph(check.status)}</text>
                  </box>
                  <box width={18} flexShrink={0}>
                    <text fg={COLORS.text}>{check.label}</text>
                  </box>
                  <text fg={COLORS.dim} truncate>
                    {check.detail ?? ""}
                  </text>
                </box>
              ))}
            </box>
          ))}
        </scrollbox>

        <box height={1} paddingX={1}>
          <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
            {report
              ? report.failures > 0
                ? `${report.failures} problem${report.failures === 1 ? "" : "s"} found — run “nimo setup” to fix the configuration.`
                : "Everything looks good."
              : " "}
          </text>
        </box>

        <box height={1} paddingX={1}>
          <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
            esc close
          </text>
        </box>
      </box>
    </box>
  );
}
