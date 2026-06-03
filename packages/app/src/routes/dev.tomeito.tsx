import { createFileRoute, redirect } from "@tanstack/react-router";

import { TomeitoGalleryPage } from "~/components/dev/tomeito-gallery";

export const Route = createFileRoute("/dev/tomeito")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: TomeitoGalleryPage,
});
