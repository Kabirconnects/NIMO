import { useCallback, useState } from "react";

import { openUrl } from "../../../lib/open-url";
import { describeFailure, ensureServices, getLogDir } from "../runner";
import { findWorkspaceRoot } from "../targets";
import type { ServiceId } from "../types";

type BusyTarget = "backend" | "dashboard" | null;

/**
 * Start services from inside the TUI.
 *
 * Service output stays in `~/.nimo/logs` instead of stdout: writing to the
 * terminal while the renderer owns the alternate screen would corrupt the UI.
 */
export function useLauncher(onNotice: (message: string) => void) {
  const [busy, setBusy] = useState<BusyTarget>(null);

  const start = useCallback(
    async (target: Exclude<BusyTarget, null>, ids: ServiceId[]) => {
      const root = findWorkspaceRoot();

      if (!root) {
        onNotice(
          "Cannot find the Nimo workspace. Run this from the project folder, or set NIMO_WORKSPACE_ROOT.",
        );
        return null;
      }

      setBusy(target);
      onNotice(
        target === "backend"
          ? "Starting the Nimo API…"
          : "Starting the API and dashboard…",
      );

      try {
        const states = await ensureServices(ids, { root });
        const failed = states.find((state) => state.status === "failed");

        if (failed) {
          onNotice(describeFailure(failed));
          return null;
        }

        return states;
      } finally {
        setBusy(null);
      }
    },
    [onNotice],
  );

  const startBackend = useCallback(async () => {
    const states = await start("backend", ["api"]);
    const api = states?.find((state) => state.id === "api");

    if (api?.url) {
      onNotice(`API ready at ${api.url}.`);
    }
  }, [onNotice, start]);

  const startDashboard = useCallback(async () => {
    const states = await start("dashboard", ["api", "web"]);
    const web = states?.find((state) => state.id === "web");

    if (web?.url) {
      const opened = openUrl(web.url);
      onNotice(
        opened
          ? `Dashboard ready at ${web.url} — opened in your browser.`
          : `Dashboard ready at ${web.url}.`,
      );
      return;
    }

    if (states) {
      onNotice(`Dashboard is starting. Logs: ${getLogDir()}`);
    }
  }, [onNotice, start]);

  return {
    busy,
    startBackend,
    startDashboard,
  } satisfies {
    busy: BusyTarget;
    startBackend: () => Promise<void>;
    startDashboard: () => Promise<void>;
  };
}
