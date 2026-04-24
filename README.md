## todo

- 编辑器
  - 代码补全使用 tab 键而不是 enter 键
  - search 组件视觉优化
- 表格
  - 表格组件样式修改，类似 code area 状态栏放下面，高度 24，操作栏放上面，高度36
  - pin 功能有问题
  - 点击行号选中整行，加入快捷键功能
- 实现可编辑表格，联动编辑器，表格编辑时自动更新编辑器内容


## V2 规划

当前先不考虑 `code area` 和 `table area` 的联动，优先分别把三个面板各自做深，并先把状态分层做好。

建议把状态拆成以下几部分：

- `tabSqlAtom`：继续只存当前 SQL 文本
- `tabEditorStateAtom`：存光标、选区、滚动、搜索状态、可选的方言覆盖
- `tabResultAtom`：存执行结果、错误、耗时、结果集
- `tabLogsAtom`：只存日志 entries
- `tabTableUiAtom`：存排序、列宽、显示列、pinning、筛选、选择态

这样做的直接收益：

- 日志变化不会拖着 table 和 code 一起重渲染
- 编辑器视图状态和执行结果状态分离，后续扩展更容易
- 表格 UI 状态可以独立保留，不污染查询结果模型

### Code Area V2

当前基础：

- 已接入 CodeMirror
- 已有 SQL 方言切换和外部值同步
- 还没有格式化、搜索、快捷键、补全、诊断
- 还没有 per-tab 的编辑器视图状态保留

建议分 3 期：

#### Phase 1：编辑器体验补全

- 保留每个 tab 的光标、选区、滚动位置
- 打通“格式化”按钮
- 增加编辑器搜索
- 增加常用快捷键
- 状态栏显示更完整的编辑信息
- 把顶部 `SQL` 徽标改成真实方言，例如 `PostgreSQL` / `MySQL` / `SQLite`

建议功能：

- `Ctrl/Cmd + Enter` 运行 SQL
- `Shift + Alt + F` 格式化
- `Ctrl/Cmd + F` 打开搜索
- 状态栏显示行列、总行数、选中字符数、选中行数、当前方言

建议依赖：

- `sql-formatter`
- `@codemirror/search`

建议改动点：

- `src/page/main/tab-page/code-area.tsx`
- `src/page/main/tab-page/sql-editor.tsx`
- `src/lib/tabs/index.ts`

#### Phase 2：语言能力

- SQL 关键字/函数自动补全
- 轻量语法诊断
- 无连接 tab 的方言切换或覆盖
- 常用片段/snippets

建议依赖：

- `@codemirror/autocomplete`
- `@codemirror/lint`

边界建议：

- 这一阶段只做方言级能力
- 不做 schema/table/column completion
- 不做 LSP

#### Phase 3：架构整理

- 把 CodeMirror 扩展拆成 builder
- 用更多 `Compartment` 管理 keymap/search/lint/autocomplete
- 给 `SqlEditor` 暴露少量命令接口
- 如果后面确实需要，再单独做 undo history 保留

Code Area 优先级建议：

- per-tab 视图状态保留
- 格式化
- 搜索
- 快捷键
- 补全
- 诊断

### Table Area V2

当前基础：

- 已接入 `tanstack-table`
- 当前只用了 `getCoreRowModel`
- 没有排序、筛选、列宽、列显示、pinning、导出、复制
- 没有虚拟化
- 结果渲染还带有 `role` / `status` 的硬编码语义

建议分 3 期：

#### Phase 1：结果查看器变成真正可用的表格

- 增加排序
- 增加列显示/隐藏
- 增加列宽调整
- 增加列 pinning
- 增加复制能力
- 增加导出能力
- 去掉对 `role` / `status`` 列名的硬编码业务样式
- 改成值类型/列元数据驱动的 renderer

建议功能：

- 复制单元格
- 复制整行
- 复制当前结果集
- 导出 CSV
- 导出 TSV
- 可选导出 JSON

建议状态：

- `sorting`
- `columnVisibility`
- `columnSizing`
- `columnPinning`
- 可选 `rowSelection`

建议改动点：

- `src/page/main/tab-page/table-area.tsx`
- `src/lib/tabs/index.ts`

#### Phase 2：性能和规模

- 加 row virtualization
- 大结果集渲染保护
- 宽表体验优化
- 首列行号 pin 住

推荐：

- table 优先用 `@tanstack/react-virtual`
- 因为和现有 `tanstack-table` 配套最好

建议功能：

- 超大结果集提示
- 只渲染可视区
- overscan 调优
- 可选“仅显示前 N 行”保护

#### Phase 3：类型感知

- 扩展 `QueryResultColumn`
- 尽量从驱动层补一些列元数据
- 做 type-aware 渲染

建议逐步补充：

- `id`
- `name`
- `dbType`
- `nullable`
- `schemaName`
- `tableName`
- 可选 `formatHint`

对应渲染：

- number 右对齐
- boolean 徽标
- null 统一显示
- JSON 折叠/预览
- timestamp 更可读

Table Area 优先级建议：

- table UI state
- copy/export
- sorting/visibility/sizing/pinning
- row virtualization
- richer column metadata

### Log Area 建议

结论：

- 第二版没必要上重型成熟库
- 更没必要上 `xterm.js`
- 最合理的路线是继续保持自定义结构化 React UI
- 只有当日志量明显变大或变成持续流式输出时，再补虚拟化库

原因：

- 当前日志不是 terminal output，而是结构化事件
- `status/sql/detail/duration/time` 这种模型更适合普通 React 列表
- `xterm.js` 更适合 ANSI 流、命令行输出、交互终端，不适合 badge/timeline/card 风格日志

Log Area V2 建议先做：

- 日志搜索
- 按状态过滤
- 复制单条日志
- 复制全部日志
- 自动滚动到最新
- 展开/折叠 SQL 与 detail
- 重复日志的聚合或视觉去噪
- 运行中日志和完成日志的关系展示更清楚

最重要的架构改动：

- 把 `logs` 从 `TabContent` 里拆出去
- 否则每次追加日志，table area 都会被无意义地牵连

建议状态：

- `tabLogsAtom`
- 可选 `tabLogUiAtom`：filter、search、followTail

什么时候需要引入库：

- 如果单 tab 日志通常只有几十条：不用新库
- 如果会到几百/几千条，或会持续刷日志：加虚拟化
- 如果后面要接进程输出、ANSI 颜色、终端交互：再考虑 `xterm.js`

如果要加库，建议：

- log area 首选 `react-virtuoso`
- 因为更适合 variable-height log item，也更适合 feed/log 场景
- 如果想尽量统一技术栈，也可以用 `@tanstack/react-virtual`
- 但日志区会比 `react-virtuoso` 更手工一些
- 不建议为了 log area 单独上 `xterm.js`

### V2 推荐实施顺序

- 拆状态：`tabEditorStateAtom`、`tabLogsAtom`、`tabTableUiAtom`
- Code Area Phase 1：保留 tab 视图状态、格式化、搜索、快捷键
- Table Area Phase 1：sorting、visibility、sizing、pinning、copy/export
- Log Area Phase 1：search/filter/copy/follow-tail
- Table virtualization
- CodeMirror autocomplete/lint
