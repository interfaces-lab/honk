import * as Linking from "expo-linking";
import * as React from "react";

import {
  claimConnectionLink,
  EMPTY_CONNECTION_LINK_INTAKE,
  receiveConnectionLink,
  type ConnectionLinkIntake,
} from "./connection-link-intake";

interface ConnectionLinkContextValue extends ConnectionLinkIntake {
  readonly ready: boolean;
  readonly receive: (value: string, fallbackOrigin?: string, repeat?: boolean) => void;
  readonly claim: (deliveryID: number) => void;
}

const ConnectionLinkContext = React.createContext<ConnectionLinkContextValue | null>(null);

export function ConnectionLinkProvider({ children }: React.PropsWithChildren): React.ReactElement {
  const [intake, setIntake] = React.useState(EMPTY_CONNECTION_LINK_INTAKE);
  const [ready, setReady] = React.useState(false);
  const receive = React.useCallback((value: string, fallbackOrigin = "", repeat = false): void => {
    setIntake((current) => receiveConnectionLink(current, value, fallbackOrigin, repeat));
  }, []);
  const claim = React.useCallback((deliveryID: number): void => {
    setIntake((current) => claimConnectionLink(current, deliveryID));
  }, []);

  React.useEffect(() => {
    let active = true;
    const subscription = Linking.addEventListener("url", ({ url }) => receive(url, "", true));
    void Linking.getInitialURL()
      .then((url) => {
        if (active && url !== null) receive(url);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [receive]);

  return (
    <ConnectionLinkContext.Provider value={{ ...intake, ready, receive, claim }}>
      {children}
    </ConnectionLinkContext.Provider>
  );
}

export function useConnectionLinkIntake(): ConnectionLinkContextValue {
  const value = React.useContext(ConnectionLinkContext);
  if (value === null) {
    throw new Error("useConnectionLinkIntake must be used inside ConnectionLinkProvider");
  }
  return value;
}
