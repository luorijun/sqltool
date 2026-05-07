## TODO

### 问题

- table 高亮选中行时，正常cell的文字会显示在pinned文字的上方

### 整体功能

- 检查并自动更新
- 自定义外壳
- 快捷键管理

### sidebar

- 实现全局长连接，tabs 里执行语句前先打开长连接，不再使用临时连接

### tabbar

- 拖拽排序
- 右键菜单：关闭、关闭其他、关闭左侧、关闭右侧、固定/取消固定

### Code Area

- 无连接 tab 默认通用 sql
- 自动补全
- 语法诊断
- 常用片段

建议依赖：

- `@codemirror/autocomplete`
- `@codemirror/lint`

### Table Area

- 可编辑表格
- 超大结果集提示
- 虚拟列表
- 提供更多列元数据
- 按类型渲染优化

建议依赖：

- `@tanstack/react-virtual`
