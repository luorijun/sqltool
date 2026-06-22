# SqlTool

A simple SQL client built with React and Electron.

![home](docs/snapshot-home.png)

![form](docs/snapshot-form.png)

## TODO

### 问题

- 无法拖动 appbar 调整窗口位置
- push 之前检查版本是否正确
- 完善自动更新的 ui 反馈
- 隐式处理连接与关闭：执行需要连接的操作时，自动检查连接状态并在必要时建立连接；当连接不再需要时，自动关闭连接
  - 编辑连接时，如果未关闭连接，提示用户是否关闭连接
- 表格高亮行 z index 不正确，普通 cell 文字会显示在冻结 cell 背景上

### 整体功能

- 支持导出数据库
  - 支持多选数据表批量导出
- 快捷键管理
- 考虑实现 i18n
- 支持运行日志记录

### sidebar

- 实现全局长连接，tabs 里执行语句前先打开长连接，不再使用临时连接
  - 连接变为隐式操作，用户不需要直接连接，而是通过执行需要连接的操作来触发连接
- 增删改表格
- 导出表格数据

### tabbar

- 拖拽排序
- 右键菜单：关闭、关闭其他、关闭左侧、关闭右侧、固定/取消固定
- 状态持久化

### Code Area

- 无连接 tab 默认通用 sql
- 自动补全
- 语法诊断
- 常用片段

建议依赖：

- `@codemirror/autocomplete`
- `@codemirror/lint`

### Table Area

- 增删改数据
- 超大结果集提示
- 虚拟列表
- 提供更多列元数据
- 按类型渲染优化

建议依赖：

- `@tanstack/react-virtual`
