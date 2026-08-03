export type MacDesktopArch = "arm64" | "x64";

export const MAC_DESKTOP_ARCH_OPTIONS: ReadonlyArray<{
  arch: MacDesktopArch;
  label: string;
}> = [
  { arch: "arm64", label: "Apple Silicon" },
  { arch: "x64", label: "Intel x64" },
] as const;

/* The macOS user agent string is frozen at "Intel Mac OS X" on Apple Silicon, so it cannot
 * distinguish architectures. Chromium exposes the real architecture through UA Client Hints;
 * Firefox and Chromium leak it through the WebGL renderer string ("Apple M2" vs "Intel Iris").
 * Safari masks its renderer as "Apple GPU" on both, so it stays on the arm64 default and the
 * visible arch menu is the recovery path. */
export async function detectMacDesktopArch(): Promise<MacDesktopArch> {
  const uaData = (
    navigator as Navigator & {
      userAgentData?: {
        getHighEntropyValues(hints: readonly string[]): Promise<{ architecture?: string }>;
      };
    }
  ).userAgentData;

  if (uaData) {
    const hints = await uaData.getHighEntropyValues(["architecture"]).catch(() => undefined);
    if (hints?.architecture === "x86") return "x64";
    if (hints?.architecture === "arm") return "arm64";
  }

  const renderer = webglRendererString();
  if (/\bApple M\d/i.test(renderer)) return "arm64";
  if (/\b(Intel|AMD|Radeon|Iris)\b/i.test(renderer)) return "x64";
  return "arm64";
}

function webglRendererString(): string {
  const gl = document.createElement("canvas").getContext("webgl");
  if (!gl) return "";
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  return String(gl.getParameter(debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
}

export function macDmgDownloadPath(arch: MacDesktopArch): string {
  return `/download/mac/${arch}`;
}
