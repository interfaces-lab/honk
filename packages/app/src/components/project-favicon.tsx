import type { EnvironmentId } from "@honk/shared/environment";
import { IconFolder1 } from "central-icons";
import { useState } from "react";
import { resolveCoreEnvironmentHttpUrl } from "../environments/core";

const loadedProjectFaviconSrcs = new Set<string>();

export function ProjectFavicon(input: {
  environmentId: EnvironmentId;
  cwd: string;
  className?: string;
}) {
  const src = resolveProjectFaviconSrc(input.environmentId, input.cwd);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(() =>
    loadedProjectFaviconSrcs.has(src) ? "loaded" : "loading",
  );

  return (
    <>
      {status !== "loaded" ? (
        <IconFolder1
          className={`size-3.5 shrink-0 text-muted-foreground/50 ${input.className ?? ""}`}
        />
      ) : null}
      <img
        src={src}
        alt=""
        className={`size-3.5 shrink-0 rounded-sm object-contain ${status === "loaded" ? "" : "hidden"} ${input.className ?? ""}`}
        onLoad={() => {
          loadedProjectFaviconSrcs.add(src);
          setStatus("loaded");
        }}
        onError={() => setStatus("error")}
      />
    </>
  );
}

function resolveProjectFaviconSrc(environmentId: EnvironmentId, cwd: string): string {
  try {
    return resolveCoreEnvironmentHttpUrl({
      environmentId,
      pathname: "/api/project-favicon",
      searchParams: { cwd },
    });
  } catch {
    return "";
  }
}
