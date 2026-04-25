## TODO

### 问题

- table 高亮选中行时，正常cell的文字会显示在pinned文字的上方

### 整体功能

- 检查并自动更新
- tab 栏允许拖动排序
- 自定义外壳
- 快捷键管理

### Code Area

- 无连接 tab 的方言切换或覆盖
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

### 低优先级

- tabs 的 TabResultState 中可以复用 conn 的 QueryResult
