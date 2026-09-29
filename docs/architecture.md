# 架构约定

本文面向 SqlTool 当前的连接管理、结构浏览、SQL 查询和结果处理功能，约定代码组织与依赖边界。目录结构表达组织方向，不代表现有代码已全部符合；功能和复杂度变化时，可以相应调整边界。

## 基本原则

- 先按运行环境隔离，再按业务职责分包，包内按需要分层。
- 以明确的目录作为包边界，通过公共入口交互，禁止跨包访问内部实现。
- 包之间保持单向依赖，不允许循环依赖，包括类型依赖。
- 明确状态的所有者与操作的负责人，避免多个包共同维护同一份可变状态。
- 使用单工程内的目录包，暂不拆分独立 npm 包或构建单元。
- 不要求每个目录都是包，也不要求每个包具备相同的层级结构。

## 目录结构

```text
src/
├─ contracts/                    # 跨进程协议
│  ├─ database/                  # 数据库请求、结果、快照、错误和通道
│  ├─ system/                    # 文件、剪贴板等系统能力协议
│  └─ bridge.ts                  # 聚合各领域 API
│
├─ main/
│  ├─ app/                       # 启动、窗口、依赖组装与退出清理
│  ├─ database/                  # 数据库业务能力
│  │  ├─ index.ts                # 公共入口
│  │  ├─ service.ts              # 业务检查与操作编排
│  │  ├─ ports.ts                # 驱动、存储、确认操作等所需接口
│  │  ├─ configs.ts              # 配置存取
│  │  ├─ sessions.ts             # 会话与资源生命周期
│  │  ├─ tasks.ts                # 执行队列、取消和任务状态
│  │  ├─ catalog.ts              # 结构读取与缓存
│  │  ├─ query.ts                # 结构化查询编译
│  │  └─ drivers/                # PostgreSQL、MySQL、SSH 等内部实现
│  ├─ ipc/                       # IPC 注册、参数校验与调用者身份处理
│  ├─ system/                    # 文件保存、剪贴板与系统对话框
│  └─ updater/                   # 应用更新
│
├─ preload/                      # 受控桥接
│  ├─ index.ts
│  ├─ database.ts
│  └─ system.ts
│
└─ renderer/
   ├─ app/                       # 应用入口、全局组装与样式
   ├─ pages/
   │  └─ workbench/              # 主工作台页面包
   │     ├─ index.tsx
   │     ├─ appbar/
   │     ├─ sidebar/             # 连接列表、连接表单、结构树
   │     └─ workspace/           # 标签栏、查询页、数据浏览页
   ├─ modules/
   │  ├─ database/               # 客户端 API、快照缓存与派生状态
   │  ├─ workspace/              # 标签页、查询和浏览的状态与操作
   │  └─ system/                 # 系统能力客户端
   └─ components/
      ├─ sql-editor/             # SQL 编辑器
      ├─ result-grid/            # 结果表格、格式化与导出转换
      ├─ run-log/                # 运行日志展示与筛选
      └─ ui/                     # 基于 Base UI 的基础组件与样式工具
```

`pages`、`modules`、`components` 是分组目录，其下明确划分的模块是包。`workbench/sidebar`、`database/drivers` 等目录默认属于所在包的内部实现，不单独建立包级边界。小模块可以保持单文件，不为目录形式拆分代码。

## 职责与状态归属

### 跨进程契约

`contracts` 只保存跨进程共享的请求参数、返回结果、状态快照、错误分类、API 签名、IPC 通道及必要的协议校验。

- 不依赖 Electron、Node、React、Jotai 或任一端的实现。
- 不包含数据库连接对象、页面状态或具体业务实现。
- 领域协议由 `bridge.ts` 聚合，领域协议不反向依赖聚合入口。
- 仅后端使用的驱动接口留在后端，仅前端使用的编辑器和表格类型留在前端。

### 主进程与桥接

`main/database` 拥有连接配置、真实会话、执行任务和结构缓存。它们共享资源生命周期，当前作为一个包维护，内部由 `service.ts` 协调配置变更、断开连接、取消任务和缓存清理等操作。

业务逻辑通过所需接口访问驱动、存储与确认能力，不直接处理窗口对象或 IPC 事件。`main/app` 负责组装实现；`main/ipc` 负责将 IPC 请求适配为业务调用，并从可信的调用上下文确定窗口身份。

`preload` 只按契约暴露明确的调用方法，不承载业务规则和状态，不暴露通用 IPC 调用入口，也不导入 main 或 renderer 的实现。

### 渲染进程

| 层 | 职责 | 不承担的职责 |
| --- | --- | --- |
| `app` | 应用初始化、全局组装、挂载页面 | 具体业务流程 |
| `pages` | 页面布局、数据接入、用户反馈与交互组织 | 数据库通信、完整查询生命周期 |
| `modules` | 业务状态、操作编排、客户端能力 | JSX 布局、toast 和展示组件控制 |
| `components` | 通过参数和回调提供可组合的展示与交互 | 直接访问当前标签页等全局业务状态 |

具体状态按以下方式归属：

- `modules/database` 维护后端快照的客户端缓存及派生状态，不另行定义一套真实连接状态。
- `modules/workspace` 维护标签页、查询与分页流程、结果和日志的归属；不同标签页的状态按标识保存。
- 页面和组件保留菜单展开、弹窗开关等局部交互状态。需要随标签页保留的界面状态，由工作区保存，通过页面接入组件。
- 组件公开自身所需的参数与回调，不依赖工作区的具体状态类型；页面负责必要的数据适配，业务模块不反向导入组件类型。

连接列表和结构树当前属于工作台页面，操作由数据库模块提供。打开查询页或数据浏览页时，由页面调用工作区的公共命令。跨区域交互优先使用显式回调，不引入全局事件总线。

结果格式化、排序和 CSV / TSV 转换归属 `result-grid`；实际文件保存与剪贴板访问归属 `system`，由页面连接二者。带业务含义的逻辑不放入通用 `utils`。

## 依赖规则

以下箭头表示允许导入，未列出的跨包依赖需要先明确职责与方向。

```text
main/app       → main/ipc、main/database、main/system、main/updater
main/ipc       → main/database、main/system、contracts
main/database  → contracts/database
main/system    → contracts/system
preload        → contracts

renderer/app                 → pages、modules（初始化与组装）
renderer/pages               → modules、components、contracts（所需类型）
renderer/modules/workspace   → modules/database、contracts/database
renderer/modules/database    → contracts/database
renderer/modules/system      → contracts/system
renderer/components/业务组件 → components/ui、contracts（所需类型）
```

- main、preload、renderer 不相互导入实现或实现中的类型，跨进程交互只依赖契约。
- 模块通过 `index.ts` 暴露必要的函数、类型、状态读取和操作命令。公共接口不要求额外定义一个 `interface`。
- 基础 UI 可以显式开放 `ui/button` 等子入口；其余内部路径不对外开放。
- 包内直接引用具体文件，不从自身公共入口反向导入，避免聚合入口产生循环。
- 外部通过命令修改包拥有的业务状态，不直接操作内部可写状态。
- 注入接口用于隔离外部能力或替换实现，不为每个函数增加抽象层。

## 约束检查

- main、preload、renderer 使用各自的 TypeScript 检查环境。
- 目录、路径别名和 TypeScript 的 `include` 不能单独保证依赖边界。
- 结构调整保持业务行为和状态同步语义稳定，使用现有会话、客户端及数据库集成测试验证相关改动。
