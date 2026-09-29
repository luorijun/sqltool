# SqlTool

A simple SQL client built with React and Electron.

![home](docs/snapshot-home.png)

![form](docs/snapshot-form.png)

## TODO

### 问题

- 表格高亮行 z index 不正确，普通 cell 文字会显示在冻结 cell 背景上

### 整体功能

- 支持导出数据库
  - 支持多选数据表批量导出
- 快捷键管理
- 考虑实现 i18n
- 支持运行日志记录

### sidebar

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

建议依赖：

- `@tanstack/react-virtual`
