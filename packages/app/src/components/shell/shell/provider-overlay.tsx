"use client";

import { useProviderAuthStore } from "~/lib/provider-auth-store";
import { ProviderKeyDialog } from "~/components/shell/provider/key-dialog";

export function ProviderShellOverlay() {
  const req = useProviderAuthStore((state) => state.req);
  const submit = useProviderAuthStore((state) => state.submit);
  const oauth = useProviderAuthStore((state) => state.oauth);

  return (
    <ProviderKeyDialog
      open={req !== null}
      provider={req?.provider ?? ""}
      mode={req?.mode ?? "api_key"}
      oauthSupported={req?.oauthSupported}
      onSubmit={submit}
      {...(req?.oauthSupported ? { onOAuth: oauth } : {})}
    />
  );
}
