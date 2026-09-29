import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import type {
  MainViteConfig,
  PreloadViteConfig,
  RendererViteConfig,
} from "electron-vite"
import { defineConfig } from "electron-vite"
import type { UserConfig } from "vite"
import { compilerOptions } from "./tsconfig.json"

const alias = Object.fromEntries(
  Object.entries(compilerOptions.paths).map(([name, [target]]) => [
    name.replace(/\/\*$/, ""),
    resolve(__dirname, compilerOptions.baseUrl, target.replace(/\/\*$/, "")),
  ]),
)

const mainConfig = {
  resolve: { alias },
  build: {
    rollupOptions: {
      input: { index: resolve(__dirname, "src/main/app/index.ts") },
    },
  },
} satisfies UserConfig

const preloadConfig = {
  resolve: { alias },
  build: {
    rollupOptions: {
      input: { index: resolve(__dirname, "src/preload/index.ts") },
      output: { format: "cjs" },
    },
  },
} satisfies UserConfig

const rendererConfig = {
  root: ".",
  plugins: [react(), tailwindcss()],
  resolve: { alias },
  build: {
    rollupOptions: {
      input: { index: resolve(__dirname, "index.html") },
    },
  },
} satisfies UserConfig

export default defineConfig({
  main: mainConfig as MainViteConfig,
  preload: preloadConfig as PreloadViteConfig,
  renderer: rendererConfig as RendererViteConfig,
})
