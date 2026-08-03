import { join } from "node:path";

import { verifyPackagedApp } from "./verify-packaged-app.mjs";

export default async function afterPack(context) {
  await verifyPackagedApp(
    context.electronPlatformName === "darwin"
      ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
      : context.appOutDir,
  );
}
