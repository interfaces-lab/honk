import { useState } from "react";

import { Button } from "@multi/ui/button";

export function DesktopBridgeDebug() {
  const [log, setLog] = useState<string>("");
  const bridge = typeof window !== "undefined" ? window.desktopBridge : undefined;

  return (
    <section className="scroll-mt-[4.5rem] font-multi space-y-4" id="debug-desktop-bridge">
      <div className="space-y-1">
        <h2 className="text-[17px] leading-[22px] font-semibold text-foreground">
          Desktop bridge smoke
        </h2>
        <p className="text-detail/[1.45] text-muted-foreground">
          Electron exposes <code className="font-multi-mono text-detail">window.desktopBridge</code>
          . In the web build these buttons are inert except where noted.
        </p>
      </div>

      {!bridge ? (
        <p className="text-detail text-muted-foreground">No desktop bridge on this surface.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-multi-control border-multi-border/45"
            onClick={() => setLog(JSON.stringify(bridge.getAppBranding(), null, 2))}
          >
            getAppBranding
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-multi-control border-multi-border/45"
            onClick={() => setLog(JSON.stringify(bridge.getLocalEnvironmentBootstrap(), null, 2))}
          >
            getLocalEnvironmentBootstrap
          </Button>
        </div>
      )}

      {log ? (
        <pre className="max-h-48 overflow-auto rounded-multi-card border border-multi-border/35 bg-background/30 p-3 font-multi-mono text-detail text-foreground/88">
          {log}
        </pre>
      ) : null}
    </section>
  );
}
