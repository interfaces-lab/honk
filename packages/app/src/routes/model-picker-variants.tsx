import { createFileRoute } from "@tanstack/react-router";

import { ModelPickerVariantsPage } from "~/components/model-picker-variants/model-picker-variants-page";

export const Route = createFileRoute("/model-picker-variants")({
  component: ModelPickerVariantsPage,
});
