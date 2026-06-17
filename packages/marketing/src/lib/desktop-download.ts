export type MacDesktopArch = "arm64" | "x64";

export const MAC_DESKTOP_ARCH_OPTIONS: ReadonlyArray<{
  arch: MacDesktopArch;
  label: string;
}> = [
  { arch: "arm64", label: "Apple Silicon" },
  { arch: "x64", label: "Intel x64" },
] as const;

export function defaultMacDesktopArch(): MacDesktopArch {
  if (typeof navigator === "undefined") {
    return "arm64";
  }

  if (navigator.userAgent.includes("Intel Mac OS X")) {
    return "x64";
  }

  return "arm64";
}

export function macDmgDownloadPath(arch: MacDesktopArch): string {
  return `/download/mac/${arch}`;
}
