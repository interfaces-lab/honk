export const BRAND_ASSET_PATHS = {
  productionMacIconPng: "packages/desktop/resources/icon.png",
  productionLinuxIconPng: "assets/brand/generated/prod/honk-production-linux-icon-1024.png",
  productionWebFaviconIco: "assets/brand/generated/prod/honk-black-web-favicon.ico",
  productionWebFavicon16Png: "assets/brand/generated/prod/honk-black-web-favicon-16x16.png",
  productionWebFavicon32Png: "assets/brand/generated/prod/honk-black-web-favicon-32x32.png",
  productionSplashIconPng: "assets/brand/generated/prod/honk-production-splash-icon-180.png",

  developmentMacIconIcns: "assets/brand/generated/dev/honk-development-macos-icon.icns",
  developmentDesktopIconPng: "assets/brand/generated/dev/honk-development-desktop-icon-1024.png",
  developmentWebFaviconIco: "assets/brand/generated/dev/blueprint-web-favicon.ico",
  developmentWebFavicon16Png: "assets/brand/generated/dev/blueprint-web-favicon-16x16.png",
  developmentWebFavicon32Png: "assets/brand/generated/dev/blueprint-web-favicon-32x32.png",
  developmentSplashIconPng: "assets/brand/generated/dev/honk-development-splash-icon-180.png",
} as const;

export interface IconOverride {
  readonly sourceRelativePath: string;
  readonly targetRelativePath: string;
}

export const DEVELOPMENT_ICON_OVERRIDES: ReadonlyArray<IconOverride> = [
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    targetRelativePath: "dist/client/favicon.ico",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    targetRelativePath: "dist/client/favicon-16x16.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    targetRelativePath: "dist/client/favicon-32x32.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentSplashIconPng,
    targetRelativePath: "dist/client/apple-touch-icon.png",
  },
];

export const PUBLISH_ICON_OVERRIDES: ReadonlyArray<IconOverride> = [
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebFaviconIco,
    targetRelativePath: "dist/client/favicon.ico",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    targetRelativePath: "dist/client/favicon-16x16.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    targetRelativePath: "dist/client/favicon-32x32.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionSplashIconPng,
    targetRelativePath: "dist/client/apple-touch-icon.png",
  },
];
