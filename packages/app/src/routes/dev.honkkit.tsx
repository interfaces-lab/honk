import { createFileRoute, redirect } from "@tanstack/react-router";

import { HonkKitGalleryPage } from "~/components/dev/honkkit-gallery";

export const Route = createFileRoute("/dev/honkkit")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw redirect({ to: "/", replace: true });
    }
  },
  validateSearch: (search: Record<string, unknown>): { component?: string } => {
    return typeof search.component === "string" ? { component: search.component } : {};
  },
  component: HonkKitGalleryPage,
});
