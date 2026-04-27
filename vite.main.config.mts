import { defineConfig } from "vite"

// https://vitejs.dev/config
export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: {
      external: [
        "pg",
        "pg-query-stream",
        "mysql2",
        "ssh2",
        // "better-sqlite3",
        // "sqlite3",
        // "mysql",
        // "mssql",
        // "oracledb",
      ],
    },
  },
})
