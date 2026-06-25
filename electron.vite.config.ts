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

const mainConfig = {
  build: {
    rollupOptions: {
      input: { index: resolve(__dirname, "src/main.ts") },
    },
  },
} satisfies UserConfig

const preloadConfig = {
  build: {
    rollupOptions: {
      input: { index: resolve(__dirname, "src/preload.ts") },
      output: { format: "cjs" },
    },
  },
} satisfies UserConfig

const rendererConfig = {
  root: ".",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@/": "/src/" } },
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
