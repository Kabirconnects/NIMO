/**
 * Open a URL in the user's default browser.
 *
 * Returns false when no opener could be started (headless machines, a
 * container without `xdg-open`) or when the caller disabled opening. The
 * caller can then print the URL instead of failing the launch.
 */
export function openUrl(url: string): boolean {
  if (process.env.NIMO_NO_BROWSER === "1") return false;

  const [command, ...args] = opener(url);

  if (!command) return false;

  try {
    const child = Bun.spawn([command, ...args], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });

    // A missing opener rejects here. Handle it so it never crashes the CLI.
    void child.exited.catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function opener(url: string): string[] {
  if (process.platform === "win32") {
    // `start` is a cmd builtin; the empty string is the window title so a URL
    // containing `&` is not treated as a second command.
    return ["cmd", "/c", "start", "", url];
  }

  if (process.platform === "darwin") {
    return ["open", url];
  }

  return ["xdg-open", url];
}
