export function inferLoginShellCaption(): string {
  try {
    const envShell =
      typeof process !== "undefined" && process.env && typeof process.env.SHELL === "string"
        ? process.env.SHELL
        : undefined;
    if (envShell) {
      const raw = envShell.trim().replace(/^["']+|["']+$/g, "");
      const last = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\"));
      const base = last < 0 ? raw : raw.slice(last + 1);
      const withoutExe = base.replace(/\.exe$/i, "");
      if (withoutExe.length > 0) {
        return withoutExe;
      }
    }
  } catch {
    /* non-Node or restricted env */
  }

  if (typeof navigator !== "undefined" && /Win/i.test(navigator.userAgent)) {
    return "powershell";
  }

  return "zsh";
}
