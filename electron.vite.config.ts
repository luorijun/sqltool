import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import type {
  MainViteConfig,
  PreloadViteConfig,
  RendererViteConfig,
} from "electron-vite"
import { defineConfig } from "electron-vite"
import { compilerOptions } from "./tsconfig.json"

const alias = Object.fromEntries(
  Object.entries(compilerOptions.paths).map(([name, [target]]) => [
    name.replace(/\/\*$/, ""),
    resolve(import.meta.dirname, target.replace(/\/\*$/, "")),
  ]),
)

const mainConfig = {
  resolve: { alias },
  build: {
    target: "node24.21",
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, "src/main/app/index.ts") },
    },
  },
} satisfies MainViteConfig

const preloadConfig = {
  resolve: { alias },
  build: {
    target: "node24.21",
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, "src/preload/index.ts") },
      output: { format: "cjs" },
    },
  },
} satisfies PreloadViteConfig

const rendererConfig = {
  root: resolve(import.meta.dirname, "src/renderer"),
  plugins: [react(), tailwindcss()],
  resolve: { alias },
  build: {
    target: "chrome152",
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, "src/renderer/index.html") },
    },
  },
} satisfies RendererViteConfig

export default defineConfig({
  main: mainConfig,
  preload: preloadConfig,
  renderer: rendererConfig,
})
