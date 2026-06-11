import type { Configuration } from "electron-builder";

function resolvePublishConfig(): Configuration["publish"] {
  const rawRepo =
    process.env.MULTI_DESKTOP_UPDATE_REPOSITORY?.trim() ||
    process.env.GITHUB_REPOSITORY?.trim() ||
    "";
  if (!rawRepo) {
    return undefined;
  }

  const [owner, repo, ...rest] = rawRepo.split("/");
  if (!owner || !repo || rest.length > 0) {
    return undefined;
  }

  return [
    {
      provider: "github",
      owner,
      repo,
      releaseType: "release",
    },
  ];
}

function resolveMacIdentity(): NonNullable<Configuration["mac"]>["identity"] {
  return process.env.MULTI_DESKTOP_SKIP_MAC_SIGNING === "true" ? null : undefined;
}

export default {
  appId: "com.interfacesco.multi",
  productName: "Multi",
  artifactName: "Multi-${version}-${arch}.${ext}",
  directories: {
    buildResources: "resources",
    output: "dist",
  },
  files: ["out/**/*", "resources/**/*"],
  asarUnpack: [
    "**/node_modules/@ff-labs/**",
    "**/node_modules/ffi-rs/**",
    "**/node_modules/@yuuang/**",
  ],
  publish: resolvePublishConfig(),
  mac: {
    target: ["dmg", "zip"],
    icon: "icon.icns",
    category: "public.app-category.developer-tools",
    identity: resolveMacIdentity(),
  },
  linux: {
    target: ["AppImage"],
    executableName: "multi",
    icon: "icon.png",
    category: "Development",
    desktop: {
      entry: {
        StartupWMClass: "multi",
      },
    },
  },
} satisfies Configuration;
