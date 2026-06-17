export type MacDesktopArch = "arm64" | "x64";

export const MAC_DESKTOP_ARCH_OPTIONS: ReadonlyArray<{
  arch: MacDesktopArch;
  label: string;
}> = [
  { arch: "arm64", label: "Apple Silicon" },
  { arch: "x64", label: "Intel x64" },
] as const;

const GITHUB_RELEASES_API = "https://api.github.com/repos/interfaces-lab/honk/releases/latest";

export const GITHUB_RELEASES_PAGE = "https://github.com/interfaces-lab/honk/releases/latest";

export function defaultMacDesktopArch(): MacDesktopArch {
  if (typeof navigator === "undefined") {
    return "arm64";
  }

  if (navigator.userAgent.includes("Intel Mac OS X")) {
    return "x64";
  }

  return "arm64";
}

export async function resolveMacDmgDownloadUrl(arch: MacDesktopArch): Promise<string> {
  try {
    const response = await fetch(GITHUB_RELEASES_API);
    if (!response.ok) {
      return GITHUB_RELEASES_PAGE;
    }

    const release = (await response.json()) as {
      assets?: ReadonlyArray<{ name: string; browser_download_url: string }>;
    };
    const suffix = `-${arch}.dmg`;
    const asset = release.assets?.find((item) => item.name.endsWith(suffix));
    return asset?.browser_download_url ?? GITHUB_RELEASES_PAGE;
  } catch {
    return GITHUB_RELEASES_PAGE;
  }
}
