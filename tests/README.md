# 测试说明

所有命令在项目根目录运行，先完成 `bun install`。按改动选择相关验证，不要求每次运行全部测试。

## 验证入口

| 命令 | 范围 |
| --- | --- |
| `bun run typecheck` | 源码、测试和构建配置的类型 |
| `bun run lint` | 格式与静态规则 |
| `bun run test` | 无需数据库的单元测试，含架构边界、桥接、后端逻辑和前端状态 |
| `bun run test:integration` | PostgreSQL / MySQL 的查询、事务、取消、断线、元数据与资源释放，以及 SSH 隧道 |
| `bun tests/interaction/editor.ts` | 编辑器键盘与交互行为 |
| `bun tests/interaction/table-area.ts` | 表格区域交互与原生拖拽 |
| `bun run build` | 类型检查和 Electron 三端生产构建 |

交互测试在独立隐藏 Electron 窗口中运行，不启动开发服务、不截图。现有自动化不包含视觉验证、原生确认对话框的点击验证或独立 MariaDB 服务器验证。

## 本地数据库

需要 Docker Compose。根目录 `docker-compose.yml` 提供专用 PostgreSQL 17 / MySQL 8.4 测试库：

```sh
docker compose up -d --wait
bun run test:integration
```

| 数据库 | 地址 | 数据库名 | 用户 / 密码 |
| --- | --- | --- | --- |
| PostgreSQL | `127.0.0.1:15432` | `sqltool_test` | `sqltool` / `sqltool` |
| MySQL | `127.0.0.1:13306` | `sqltool_test` | `sqltool` / `sqltool` |

MySQL 管理员为 `root`，密码为 `sqltool_root`，可通过容器内客户端使用。SSH 测试使用临时服务，仅允许转发到上述测试端口。

`docker compose down` 停止容器并保留数据；`docker compose down -v` 同时删除数据卷，再启动即可重建空库。这套环境可以丢弃，修改与重建授权见 [协作规则](../AGENTS.md#测试数据库授权)。
