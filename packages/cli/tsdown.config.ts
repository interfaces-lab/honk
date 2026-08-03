import { defineConfig } from "tsdown";

export default defineConfig({
  // @honk/opencode is a private workspace package. Inline its host contract and
  // generated plugin sources so the published CLI has no workspace dependency.
  deps: { onlyBundle: ["@honk/opencode"] },
});
