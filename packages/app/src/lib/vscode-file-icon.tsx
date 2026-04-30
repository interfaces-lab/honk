import { IconFileBend } from "central-icons";
import { memo, useMemo, useState } from "react";
import associations from "../vscode-icons-language-associations.json";
import manifest from "../vscode-icons-manifest.json";
import { cn } from "./utils";

type ThemeManifest = {
  iconDefinitions: Record<string, { iconPath: string }>;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  languageIds: Record<string, string>;
};

const m = manifest as ThemeManifest;
const extToLang = associations.extensionToLanguageId as Record<string, string>;
const fileToLang = associations.fileNameToLanguageId as Record<string, string>;

function base(path: string) {
  const clean = path.replace(/\\/g, "/");
  const pos = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return pos < 0 ? clean : clean.slice(pos + 1);
}

function ext(name: string) {
  const t = name.trim().toLowerCase();
  const pos = t.lastIndexOf(".");
  if (pos < 0 || pos === t.length - 1) return "";
  return t.slice(pos + 1);
}

const defaultHref = "/vscode-icons/default_file.svg";

export function vscodeIconHref(filePath: string): string {
  const bn = base(filePath).toLowerCase();
  const x = ext(bn);

  let key: string | undefined = m.fileNames[bn];
  if (!key) {
    const langFromFn = fileToLang[bn];
    if (langFromFn) key = m.languageIds[langFromFn];
  }
  if (!key && x) key = m.fileExtensions[x];
  if (!key && x) {
    const lang = extToLang[x];
    if (lang) key = m.languageIds[lang];
  }

  if (!key) return defaultHref;

  const def = m.iconDefinitions[key];
  const p = def?.iconPath?.trim();
  if (!p) return defaultHref;

  const name = p.replace(/^\.\.\/\.\.\/icons\//, "");
  return `/vscode-icons/${name}`;
}

export const VsFileIcon = memo(function VsFileIcon(props: {
  path: string;
  className?: string;
  errored?: boolean;
}) {
  const href = useMemo(() => vscodeIconHref(props.path), [props.path]);
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <IconFileBend
        className={cn(
          "size-3.5 shrink-0",
          props.errored && "text-destructive/80",
          "text-foreground/48",
        )}
      />
    );
  }

  return (
    <img
      src={href}
      alt=""
      width={14}
      height={14}
      className={cn("size-3.5 shrink-0 object-contain", props.className)}
      onError={() => setBroken(true)}
    />
  );
});
