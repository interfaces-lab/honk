"use client";

import { useEffect, useState } from "react";

import { Button } from "@multi/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@multi/ui/dialog";
import { Input } from "@multi/ui/input";

export function ProviderKeyDialog(props: {
  open: boolean;
  provider: string;
  mode: "api_key" | "oauth";
  oauthSupported: boolean | undefined;
  onSubmit: (key: string | undefined) => void;
  onOAuth?: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setValue("");
    setBusy(false);
  }, [props.open]);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onSubmit(undefined);
      }}
    >
      <DialogPopup className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>
            {props.mode === "api_key" ? "API key" : "Authentication required"}
          </DialogTitle>
          <DialogDescription>
            {props.mode === "api_key" ? (
              <>
                Enter an API key for provider <span className="font-medium">{props.provider}</span>.
              </>
            ) : props.oauthSupported ? (
              <>
                Provider <span className="font-medium">{props.provider}</span> uses OAuth in Pi.
                Re-authenticate it here and Multi will retry the blocked action.
              </>
            ) : (
              <>
                Provider <span className="font-medium">{props.provider}</span> is currently using
                OAuth-style credentials from your local Pi config. Multi will not overwrite them
                with an API key prompt.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {props.mode === "api_key" ? (
          <div className="px-6 pb-2">
            <Input
              type="password"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Key"
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => props.onSubmit(undefined)}
          >
            {props.mode === "api_key" ? "Cancel" : "Close"}
          </Button>
          {props.mode === "api_key" ? (
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                const v = value.trim();
                props.onSubmit(v.length > 0 ? v : undefined);
              }}
            >
              Save
            </Button>
          ) : props.oauthSupported && props.onOAuth ? (
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                const oauth = props.onOAuth;
                if (!oauth) return;
                setBusy(true);
                void oauth().finally(() => {
                  setBusy(false);
                });
              }}
            >
              {busy ? "Connecting..." : "Connect with OAuth"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
