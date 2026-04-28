## TODO

### 问题

- table 高亮选中行时，正常cell的文字会显示在pinned文字的上方

### 整体功能

- 检查并自动更新
- 自定义外壳
- 快捷键管理

### navbar

- 编辑连接时提供测试按钮
- 支持 mysql/mariadb 数据库
- 支持 ssh 密钥连接
- 连接保存以复用，提供连接/断开按钮
- 合并 conn 与 config 组件，连接 config 后，查出数据库结构信息直接以子树的形式展示在 config 下

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
