/** Short labels: GitHub `owner/repo`, under home use last two segments or `~/…`, else last two segments. */
export function shortWorkspacePathLabel(path: string, home: string | null): string {
  const p = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!p) return "Workspace";

  const gitSsh = p.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (gitSsh) return `${gitSsh[1]}/${gitSsh[2]}`;

  const gitHttps = p.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i);
  if (gitHttps) return `${gitHttps[1]}/${gitHttps[2]}`;

  if (home) {
    const h = home.replace(/\\/g, "/").replace(/\/+$/, "");
    if (p === h) return "~";
    const prefix = `${h}/`;
    if (p.startsWith(prefix)) {
      const rel = p.slice(prefix.length);
      const seg = rel.split("/").filter(Boolean);
      if (seg.length >= 2) return `${seg[seg.length - 2]}/${seg[seg.length - 1]}`;
      if (seg.length === 1) return `~/${seg[0]}`;
      return "~";
    }
  }

  const seg = p.split("/").filter(Boolean);
  if (seg.length >= 2) return `${seg[seg.length - 2]}/${seg[seg.length - 1]}`;
  return seg[0] ?? "Workspace";
}
