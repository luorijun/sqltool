import { FuseV1Options, FuseVersion } from "@electron/fuses"
import { MakerDeb } from "@electron-forge/maker-deb"
import { MakerRpm } from "@electron-forge/maker-rpm"
import { MakerSquirrel } from "@electron-forge/maker-squirrel"
import { MakerZIP } from "@electron-forge/maker-zip"
import { FusesPlugin } from "@electron-forge/plugin-fuses"
import { VitePlugin } from "@electron-forge/plugin-vite"
import { PublisherGithub } from "@electron-forge/publisher-github"
import type { ForgeConfig } from "@electron-forge/shared-types"

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    ignore: [],
    executableName: "sqltool",
    osxSign: { identity: "-" },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  publishers: [
    new PublisherGithub({
      draft: true,
      repository: {
        name: "sqltool",
        owner: "luorijun",
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          target: "main",
          entry: "src/main.ts",
          config: "vite.main.config.mts",
        },
        {
          target: "preload",
          entry: "src/preload.ts",
          config: "vite.preload.config.mts",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.mts",
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
}

export default config
