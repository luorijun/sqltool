# 测试

- `bun run test`：无需数据库或浏览器，运行会话、调度、参数校验、查询编译、前端状态、编辑器及结果转换等单元测试。
- `docker compose up -d --wait` 后运行 `bun run test:integration`：使用项目的 PostgreSQL 17 / MySQL 8.4 测试库，覆盖事务、临时表、辅助连接隔离、取消、断线、结构刷新、关闭回滚和物理连接释放；SSH 测试验证隧道取消、中断与释放，临时服务仅允许转发到这两个本地测试端口。
- `bun run build`：类型检查与 Electron 三端生产构建。
- `bun tests/interaction/editor.ts`：在独立隐藏窗口中检查编辑器键盘事件、补全、查找替换、多光标和只读行为，不启动开发服务或截图。

这些自动化用例不包含视觉验证、原生确认对话框的点击验证或单独的 MariaDB 服务器验证。
