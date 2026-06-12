import { createFileRoute, redirect } from "@tanstack/react-router";

import { HonkKitGalleryPage } from "~/components/dev/honkkit-gallery";

export const Route = createFileRoute("/dev/honkkit")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: HonkKitGalleryPage,
});
