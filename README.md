# SqlTool

面向开发者的本地桌面数据库客户端，支持 PostgreSQL 和 MySQL / MariaDB。核心功能包括连接管理、结构浏览、SQL 编辑与执行、结果查看和运行日志。

## 本地开发

需要 Bun 和桌面运行环境；Bun 版本以 `package.json` 的 `packageManager` 为准。

```sh
bun install
bun run dev
```

| 命令 | 用途 |
| --- | --- |
| `bun run typecheck` | 检查源码、测试和构建配置的类型 |
| `bun run lint` | 检查代码格式与静态规则 |
| `bun run test` | 运行单元测试 |
| `bun run build` | 类型检查并构建 Electron 三端 |
| `bun run make` | 构建并打包桌面应用 |

数据库集成测试需要 Docker，环境和运行方式见 [测试说明](tests/README.md)。

## 技术与文档

Electron 承载桌面应用，React / TypeScript / Jotai 组织界面和状态，Tailwind CSS / Base UI 提供样式与基础组件。SQL 编辑器使用 CodeMirror，结果表格使用 TanStack Table，数据库驱动使用 `pg` 和 `mysql2`。

构建配置见 `electron.vite.config.ts`，打包配置见 `electron-builder.yml`。

- [架构约定](docs/architecture.md)：模块职责、依赖边界与状态归属。
- [测试说明](tests/README.md)：验证方式与本地测试数据库。
- [协作规则](AGENTS.md)：代码修改和检查的约束。
