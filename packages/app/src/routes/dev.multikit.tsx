import { createFileRoute, redirect } from "@tanstack/react-router";

import { MultikitGalleryPage } from "~/components/dev/multikit-gallery";

export const Route = createFileRoute("/dev/multikit")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: MultikitGalleryPage,
});
