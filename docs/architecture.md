# 架构约定

本文约定 SqlTool 的代码组织、状态归属与依赖方向。先按运行环境隔离，再按具体能力分包；目录表达职责，不为每个内部文件建立独立模块。

## 基本原则

- 使用单工程内的目录包，暂不拆分独立 npm 包或构建单元。
- 通过公共入口访问模块，禁止跨包引用内部实现。
- 模块之间保持单向依赖，禁止循环引用，包括类型依赖。
- 每份可变状态有明确所有者，外部通过公开命令修改。
- 必要模型显式定义，API 和服务类型优先从实现推导。
- 注入接口用于隔离外部能力，不为每个函数增加抽象层。

## 目录结构

```text
src/
├─ core/
│  ├─ database.ts              # 数据库配置、结构、查询、状态与领域错误
│  └─ workspace.ts             # 工作区持久化模型
├─ main/
│  ├─ app/
│  │  ├─ index.ts              # Electron 启动入口、存储接入与全局组装
│  │  ├─ window.ts             # 窗口创建、生命周期事件与原生关闭确认
│  │  └─ services.ts           # 连接与会话实例的创建及依赖注入
│  ├─ connections/
│  │  ├─ index.ts              # 配置变更检查、连接汇总快照与公共命令
│  │  ├─ configs.ts            # 内部配置管理
│  │  └─ store.ts              # 配置存储接口与适配
│  ├─ sessions/
│  │  ├─ index.ts
│  │  ├─ sessions.ts           # 实际会话、查询执行、事务与关闭流程
│  │  ├─ tasks.ts              # 队列、取消与任务状态
│  │  └─ query.ts              # 结构化查询编译
│  ├─ metadata/
│  │  ├─ index.ts
│  │  └─ metadata.ts           # 结构与类型缓存、结果补全和失效
│  ├─ drivers/
│  │  ├─ index.ts
│  │  ├─ types.ts              # 驱动接口与专用类型
│  │  ├─ shared.ts
│  │  ├─ postgres.ts
│  │  ├─ mysql.ts
│  │  ├─ mysql-types.ts
│  │  └─ ssh.ts
│  ├─ workspace/               # 工作区快照存取
│  ├─ system/                  # 文件、剪贴板与原生系统能力
│  ├─ ipc/
│  │  ├─ index.ts              # 注册、窗口身份与请求校验
│  │  ├─ database.ts           # 数据库调用适配与响应包装
│  │  └─ validation.ts         # IPC 参数和持久化格式校验
│  └─ updater/                 # 应用更新
├─ preload/
│  ├─ index.ts                 # 接入 Electron 并暴露受控桥接
│  ├─ bridge.ts                # 纯桥接组装、公共定义与推导类型
│  ├─ invoke.ts                # 内部注入调用函数的类型
│  ├─ database.ts
│  ├─ system.ts
│  └─ workspace.ts
└─ renderer/
   ├─ app/
   │  ├─ index.tsx             # 挂载、初始化与全局同步
   │  ├─ layout.tsx            # 整体布局
   │  ├─ global.css
   │  ├─ appbar/
   │  ├─ sidebar/              # 连接列表、表单与结构树
   │  └─ workspace/            # 标签栏、查询页与数据浏览页
   ├─ modules/                 # database、workspace、system 的状态与命令
   ├─ components/              # sql-editor、result-grid、run-log、ui
   ├─ env.d.ts
   └─ index.html
```

main 第一层按能力划分模块；renderer/app 是一个应用组装包，sidebar 和 workspace 属于包内实现。renderer/modules、renderer/components 是分组目录，其下明确划分的模块是包。

## 职责与状态归属

### 核心模型

core 只保存必要的数据库模型、公共状态、领域错误和稳定的工作区持久化格式，不依赖 Electron、Node、React、Jotai 或任一端实现。

- 不保存 API 方法清单、IPC 通道或通用响应包装。
- 不包含数据库连接对象、驱动专用类型或运行中的前端状态。
- ConfigDraft 表达尚未保存的连接配置；创建、更新请求可以基于模型派生。
- WorkspaceSnapshot 明确定义持久化格式，不从完整前端运行状态自动推导。

### 后端模块

connections 拥有连接配置及汇总快照版本，配置修改和删除前检查 sessions 的资源状态。configs 是内部实现，不向外提供绕过检查的修改入口。

sessions 拥有真实会话、任务和关闭流程，负责 SQL 执行、取消、事务检查与资源释放。任务队列按会话串行执行，暂时留在 sessions 内部。sessions 通过注入函数读取配置，不反向导入 connections。

metadata 拥有结构和类型缓存，通过注入的读取函数访问会话，不导入 sessions。sessions 协调会话关闭和缓存失效；connections 从 sessions 读取资源与元数据汇总，组装统一快照。

drivers 实现 PostgreSQL、MySQL 与 SSH，拥有驱动接口和专用类型，不依赖 sessions 或其调度工具。共同领域错误归 core，超时辅助留在使用它的模块内部。

app 创建实例、接入存储与确认能力，监听窗口事件后触发 sessions 的关闭流程。业务模块不导入 app 或从 app 获取单例。workspace 接收存储读写函数，system 承担实际文件、剪贴板和原生对话框操作。

### IPC 与桥接

preload/database、system、workspace 就地定义通道、桥接参数和响应包装，以明确类型调用注入的 invoke。bridge.ts 聚合方法，并从工厂返回值推导 MainBridge 及各 API 类型，不重复声明接口清单。

只有 preload/index.ts 导入 Electron。bridge.ts 及其内部依赖没有 Electron、Node、运行端副作用，也不导入 main 或 renderer；通用 invoke 不暴露给页面。

main/ipc 从可信事件确定窗口身份，校验未知参数，将请求适配为业务调用。database.ts 在 IPC 边界处理成功、错误和快照包装，并检查实现满足推导出的桥接 API。业务模块不依赖桥接 API 清单。

renderer 仅通过 window.main 调用受控方法；env.d.ts 从 preload/bridge 引用桥接类型。静态类型不能验证 IPC 实际载荷，主进程的运行时参数校验继续保留。

### 渲染进程

| 层 | 职责 | 不承担的职责 |
| --- | --- | --- |
| app | 初始化、布局、数据接入、反馈与交互组织 | 数据库通信、完整查询生命周期 |
| modules | 业务状态、操作编排、客户端能力 | JSX 布局、toast 和展示组件控制 |
| components | 通过参数和回调提供展示与交互 | 直接访问当前标签页等全局业务状态 |

具体状态按以下方式归属：

- `modules/database` 维护后端快照的客户端缓存及派生状态，不另行定义一套真实连接状态。
- `modules/workspace` 维护标签页、查询与分页流程、结果和日志的归属；不同标签页的状态按标识保存。
- 工作区只持久化标签顺序、名称、当前标签、查询页编辑内容及位置、表格页的数据源与排序分页参数。主进程在独立的 `workspace` 存储中保存快照；前端启动时先恢复标签，再自动加载所有表格页，查询页不自动执行。结果、日志、会话和任务状态重新初始化。
- 自动保存每 5 秒检查一次，仅在持久化内容变化时写入，不在退出时额外保存；最后一个保存周期内的修改可能丢失。
- 页面和组件保留菜单展开、弹窗开关等局部交互状态。需要随标签页保留的界面状态，由工作区保存，通过页面接入组件。
- 组件公开自身所需的参数与回调，不依赖工作区的具体状态类型；页面负责必要的数据适配，业务模块不反向导入组件类型。

连接列表和结构树当前属于应用界面，操作由数据库模块提供。打开查询页或数据浏览页时，由页面调用工作区的公共命令。跨区域交互优先使用显式回调，不引入全局事件总线。

结果格式化、排序和 CSV / TSV 转换归属 `result-grid`；实际文件保存与剪贴板访问归属 `system`，由页面连接二者。带业务含义的逻辑不放入通用 `utils`。


## 依赖规则

以下箭头表示允许导入，包括类型导入。

```text
main/app         → connections、sessions、drivers、workspace、ipc、updater、core
main/ipc         → connections、sessions、drivers、workspace、system、core、preload/bridge
main/connections → sessions、core
main/sessions    → metadata、drivers、core
main/metadata    → drivers、core
main/drivers     → core
main/workspace   → core
preload          → core

renderer/app               → modules、components、core
renderer/modules/workspace → modules/database、core、preload/bridge（仅类型）
renderer/modules/database  → core、preload/bridge（仅类型）
renderer/modules/system    → preload/bridge（仅类型）
renderer/components        → components/ui、core、preload/bridge（所需类型）
```

- main、preload、renderer 不导入其他运行端的入口或内部实现。唯一开放的跨端入口为纯 preload/bridge：main/ipc 可以使用桥接定义和通道，renderer 仅引用类型。
- 跨包使用 @/，通过 index.ts / index.tsx 访问模块；core/database、core/workspace 是单文件公共模块，preload/bridge 是显式公共入口，基础 UI 可访问 ui/button 等子入口。
- 包内使用相对路径引用具体文件，不反向导入自身公共入口。
- renderer 和 preload 不通过 main 实现推导 API，避免反向类型依赖与循环。
- 展示组件定义自身参数类型，不依赖工作区状态；带业务含义的逻辑不放入通用 utils。

## 约束检查

- tsconfig.json 集中公共选项、路径映射和检查入口；node 配置检查 main / preload / core，renderer 配置检查 renderer / core 及引用的纯桥接定义，dev 配置检查测试与构建配置。
- TypeScript 的 include 不能单独保证边界。tests/unit/architecture.test.ts 检查生产源码的静态依赖环、公共入口与运行环境边界，包括类型依赖。
- tests/support/database.ts 只为原有场景组装服务与 IPC API，不作为生产后端总服务。
- 结构调整保持业务行为与状态同步语义稳定，使用现有客户端、会话和数据库集成测试验证。
