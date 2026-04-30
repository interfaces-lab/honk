import { getRouteApi, useNavigate } from "@tanstack/react-router";

import {
  PairingPendingSurface,
  PairingRouteSurface,
} from "~/components/pairing/pairing-route-surface";

const routeApi = getRouteApi("/pair");

export function PairRouteView() {
  const { authGateState } = routeApi.useRouteContext();
  const navigate = useNavigate();

  if (!authGateState) {
    return null;
  }

  return (
    <PairingRouteSurface
      auth={authGateState.auth}
      onAuthenticated={() => {
        void navigate({ to: "/", replace: true });
      }}
      {...(authGateState.errorMessage ? { initialErrorMessage: authGateState.errorMessage } : {})}
    />
  );
}

export function PairRoutePendingView() {
  return <PairingPendingSurface />;
}
