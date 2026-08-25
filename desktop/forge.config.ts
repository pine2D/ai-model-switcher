import { existsSync } from "node:fs";
import { join } from "node:path";

import { FuseV1Options, FuseVersion } from "@electron/fuses";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";

import { mainConfig } from "./webpack.main.config";
import { rendererConfig } from "./webpack.renderer.config";

const oauthResource = join(__dirname, "resources", "oauth.json");

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: "com.pine2d.polyask",
    appCategoryType: "public.app-category.productivity",
    executableName: "polyask-desktop",
    ...(existsSync(oauthResource) ? { extraResource: [oauthResource] } : {})
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "PolyAsk",
        authors: "pine2D",
        description: "Compare answers from nine live AI sites in one window"
      }
    },
    {
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: {
        options: {
          maintainer: "pine2D",
          homepage: "https://github.com/pine2D/polyask"
        }
      }
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "win32"],
      config: {}
    }
  ],
  plugins: [
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: "./src/renderer/index.html",
            js: "./src/renderer/index.tsx",
            name: "main_window",
            preload: { js: "./src/preload/shell.ts" }
          },
          {
            html: "./src/renderer/site.html",
            js: "./src/renderer/site.ts",
            name: "site_window",
            preload: { js: "./src/preload/site.ts" }
          }
        ]
      }
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
};

export default config;
