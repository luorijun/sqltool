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
- 样式与组件：Tailwind CSS v4、Base UI primitives、本地 `src/components/ui`。基础本地组件应基于 Base UI 实现，并沉淀为项目自己的 UI 基础设施。
- 数据库：PostgreSQL 和 MySQL，对应访问依赖主要是 `pg` 和 `mysql2`。
- 编辑与展示：CodeMirror 承载 SQL 编辑体验，TanStack Table 承载查询结果表格能力。

### 目录导读

- `src/lib`：应用能力层，承载跨进程领域模块、renderer 侧客户端接口和共享类型。
- `src/page`：界面组织层，承载应用框架、侧边栏、主工作区等页面结构。
- `src/components/ui`：本地基础 UI 组件层。
- `src/global.css`：Tailwind v4 主题变量和全局样式。
- `electron.vite.config.ts`：Electron main / preload / renderer 三端构建配置。
- `electron-builder.yml`：桌面应用打包配置。

### 领域模块模式

跨进程能力按领域组织在 `src/lib` 下，稳定模式是 `src/lib/<domain>/{index,main,preload,renderer}.ts`。这个模式同时表达领域边界和进程边界：main 侧负责真实能力实现，preload 负责受控桥接，renderer 侧负责提供页面可用的客户端接口。

- `index.ts` 放置领域类型、IPC channel 名称和 main / preload / renderer 之间共享的定义。
- `main.ts` 放置 main 侧能力实现，负责调用 Electron、Node、数据库驱动等只能在主进程侧执行的能力。
- `preload.ts` 放置 IPC 调用包装，并通过全局桥接接口暴露给 renderer。
- `renderer.ts` 放置 renderer 侧客户端接口，以及该领域在客户端需要维护的全局缓存和状态同步逻辑。

### 请求响应模式

当前结构更接近请求响应模式，也可以借助 MVC 的视角理解。`src/page` 主要负责界面展示和交互组织，不直接访问数据库驱动、文件系统或 Electron 主进程对象。`src/lib/<domain>/renderer.ts` 是 renderer 侧访问领域能力的客户端接口和缓存层，`src/lib/<domain>/main.ts` 是 main 侧的实际能力实现。

典型数据流是：页面组件发起动作，调用对应领域的 renderer 客户端接口；renderer 客户端接口通过 preload 暴露的桥接能力发起 IPC 请求；main 侧完成实际处理并返回结果；renderer 侧再更新缓存或状态，驱动页面刷新。

## 本地测试数据库

根目录 `docker-compose.yml` 提供专门用于开发和功能测试的 PostgreSQL、MySQL 环境。在项目根目录运行 `docker compose up -d --wait` 启动，运行 `docker compose down` 停止并保留数据；运行 `docker compose down -v` 删除测试数据后，再启动即可重建空库。

- PostgreSQL：`127.0.0.1:15432`；MySQL：`127.0.0.1:13306`。
- 两者数据库名均为 `sqltool_test`，用户名和密码均为 `sqltool`；MySQL 管理员账号为 `root`，密码为 `sqltool_root`，可通过容器内客户端使用。
- 这套环境及其中的数据均可随时丢弃。后续开发可按测试需要任意修改配置、创建或删除数据库对象、增删改数据、停止或重建容器、删除数据卷，无需额外确认。此授权仅限该 Compose 测试环境，不适用于其他数据库或开发服务。
