# SqlTool

## 项目概览

SqlTool 是一个面向开发者的本地桌面数据库客户端，定位接近 DataGrip、Navicat 这类专业数据库工具。它面向日常开发、调试和数据查看场景，提供图形化的数据库访问体验，帮助开发者更直接地连接数据库、理解数据结构、执行 SQL 并分析查询结果。

当前 SqlTool 聚焦于数据库访问的核心工作流：管理数据库连接、浏览数据库结构、编写并执行 SQL、查看查询结果，以及通过运行日志追踪查询过程。项目明确支持 PostgreSQL 和 MySQL / MariaDB，主要能力围绕“连接数据库、查看结构、运行查询、处理结果”展开。

作为产品，SqlTool 的目标是成为一个清晰、稳定、适合高频使用的开发者数据库工具，让数据库查询、调试和分析工作尽量集中在一个桌面客户端中完成。

## 技术栈与目录结构

### 技术架构导读

- 桌面运行：Electron。
- 构建与发布：`electron-vite` 组织 main / preload / renderer 三端构建，`electron-builder` 负责桌面应用打包，`electron-updater` 提供打包后应用的更新检查能力。
- Renderer：React、TypeScript 和 Jotai。
- 样式与组件：Tailwind CSS v4、Base UI primitives、本地 `src/renderer/components/ui`。基础本地组件应基于 Base UI 实现，并沉淀为项目自己的 UI 基础设施。
- 数据库：PostgreSQL 和 MySQL，对应访问依赖主要是 `pg` 和 `mysql2`。
- 编辑与展示：CodeMirror 承载 SQL 编辑体验，TanStack Table 承载查询结果表格能力。

### 目录导读

- `src/contracts`：跨进程请求、结果、快照、API 签名和通道；不依赖任一运行端的实现。
- `src/main/app`：启动、窗口、存储与确认能力的组装，以及退出清理。
- `src/main/database`：连接配置、会话、任务、结构缓存、查询编译与驱动；`main/ipc` 负责参数校验和调用者身份，`main/system` 负责文件及剪贴板能力。
- `src/preload`：只按契约暴露明确的调用方法。
- `src/renderer/app`：应用挂载、初始化、全局同步和样式。
- `src/renderer/pages/workbench`：工作台页面，组织侧边栏、编辑区、数据浏览和反馈。
- `src/renderer/modules`：数据库快照缓存、工作区状态与命令，以及系统客户端。
- `src/renderer/components`：通过参数与回调接入的编辑器、结果表格、运行日志和基础 UI。
- `src/renderer/app/global.css`：Tailwind v4 主题变量和全局样式。
- `electron.vite.config.ts`：Electron main / preload / renderer 三端构建配置。
- `electron-builder.yml`：桌面应用打包配置。

### 包边界

完整规则见 [架构约定](docs/architecture.md)。先按运行环境隔离，再按业务职责分包。跨包使用 `@/`（映射到 `src/`），仅访问公共 `index.ts` / `index.tsx`，基础 UI 可以使用 `ui/button` 等子入口；包内通过相对路径引用具体文件，不反向导入自身入口。路径映射统一维护在 `tsconfig.json`。禁止跨进程实现依赖和循环依赖，包括类型依赖。

数据库服务通过接口接收驱动、配置存储和确认能力，应用入口负责组装。工作区按标签页标识拥有查询、分页、结果和日志状态；外部通过公开命令更新状态。展示组件定义自身的参数类型，不依赖工作区状态类型。

### 请求响应模式

典型数据流是：页面调用工作区或数据库模块的公共命令，客户端通过 preload 发起请求，IPC 层校验参数并确定窗口身份，数据库服务处理后返回结果与快照；客户端合并快照，工作区更新相应标签页状态，驱动页面刷新。

`bun run typecheck` 检查 main / preload / renderer、构建配置及测试代码的类型。`bun run test` 运行无需数据库的测试，`bun run test:integration` 运行数据库集成测试，见 [测试说明](tests/README.md)。测试可以访问包内实现，生产源码不能。

## 本地测试数据库

根目录 `docker-compose.yml` 提供专门用于开发和功能测试的 PostgreSQL、MySQL 环境。在项目根目录运行 `docker compose up -d --wait` 启动，运行 `docker compose down` 停止并保留数据；运行 `docker compose down -v` 删除测试数据后，再启动即可重建空库。

- PostgreSQL：`127.0.0.1:15432`；MySQL：`127.0.0.1:13306`。
- 两者数据库名均为 `sqltool_test`，用户名和密码均为 `sqltool`；MySQL 管理员账号为 `root`，密码为 `sqltool_root`，可通过容器内客户端使用。
- 这套环境及其中的数据均可随时丢弃。后续开发可按测试需要任意修改配置、创建或删除数据库对象、增删改数据、停止或重建容器、删除数据卷，无需额外确认。此授权仅限该 Compose 测试环境，不适用于其他数据库或开发服务。
