# Repository Notes

- `README.md` is a Chinese backlog/V2 planning document, not an operational README. Trust `package.json`, `forge.config.ts`, and the `src/**` entrypoints for current behavior.
- `package.json` declares `packageManager: npm@11.1.0` even though `bun.lock` exists. Default to `bun run ...` unless the user asks for Bun.

## Commands

- `npm run dev`: starts Electron Forge + Vite. `src/main.ts` always opens Chromium devtools for the main window.
- `npm run typecheck`: runs `tsc -b` for the renderer, Forge/Vite config files, and `scripts/**`.
- `npm run lint`: runs `biome lint --write` and mutates files.
- Prefer `npx biome check <changed-paths>` for non-mutating verification. `npx biome check .` currently reports existing repo-wide formatting/import issues, so avoid repo-wide Biome rewrites unless the user asks.
- There is no configured test runner, CI workflow, or Husky hook. `scripts/knex-test.ts` is a local scratch script with a hardcoded Postgres DSN, not a supported test.

## Architecture

- Entry points: `src/main.ts` (Electron main), `src/preload.ts` (bridge), `src/renderer.tsx` -> `src/page/root.tsx` (React UI).
- Keep process boundaries strict: renderer code goes through `window.main` wrappers in `src/lib/*/renderer.ts`. If you add IPC, update `src/lib/<domain>/{index,main,preload,renderer}.ts` and `src/lib/bridge.ts` together.
- Left sidebar code lives under `src/page/navabr/*`.
- `src/lib/config/main.ts` persists connection configs in `electron-store` under the `configs` store name. Change storage types, bridge types, and form fields together.
- `src/lib/tabs/renderer.ts` is the single source of truth for tab state and SQL run/log/dirty side effects. Put shared tab behavior there instead of duplicating state in `src/page/main/**`.

## Data And UI Gotchas

- User-facing copy and error messages are currently Chinese; match that unless the user asks otherwise.
- The UI exposes `postgres`, `mysql`, and `sqlite`, but `src/lib/conn/main.ts` only implements PostgreSQL `inspect` and `query`. Do not assume MySQL/SQLite work without backend changes.
- Query results are array-based: `src/lib/conn/postgres.ts` uses `rowMode: "array"` and `src/page/main/tab-page/table-area.tsx` reads `row[columnIndex]`. Do not switch one side to object rows without updating the other.
- If you add a new DB driver or other main-process dependency used by `src/main.ts`, update `vite.main.config.mts` `build.rollupOptions.external`.
- Tailwind is v4 CSS-first: theme tokens live in `src/global.css`; there is no `tailwind.config.*`.
