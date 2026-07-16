import * as React from "react";
import { Redirect } from "expo-router";

import { useRemote } from "../src/remote-context";
import { LoadingState } from "../src/ui";

export default function IndexRoute(): React.ReactElement {
  const remote = useRemote();
  if (remote.status === "restoring") {
    return <LoadingState label="Restoring Honk connection…" />;
  }
  if (remote.servers.length === 0 || remote.client === null) return <Redirect href="/connect" />;
  return <Redirect href="/(tabs)/home" />;
}
