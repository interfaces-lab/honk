import { createFileRoute, redirect } from "@tanstack/react-router";

import { ComposerInputExamplesPage } from "~/components/chat/composer/composer-input-examples";

export const Route = createFileRoute("/_chat/dev/composer-examples")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: ComposerInputExamplesPage,
});
