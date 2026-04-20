# `specnfc status` 仓级状态命令

这个命令是当前仓的默认总入口，进入仓后应优先执行它。

这个命令用于统一查看：

- 当前仓是否已初始化
- 当前有哪些活跃 change
- 当前最重要的风险或阻塞
- 当前有哪些 integration 依赖与阻塞链
- 当前 handoff / release readiness 概况
- 下一步最应该执行什么命令
- 当前推进主链路应该先补哪份文档

常用参数：

- `--json`
- `--cwd <路径>`

示例：

- `specnfc status`
- `specnfc status --json`
- `specnfc status --cwd /path/to/repo`

默认输出会明确包含：

- 当前阶段
- 当前步骤
- 当前主动作
- 当前文档
- 当前不该做什么
- 完成后下一步

典型分流：

- 当前无 active change：
  - 主动作通常是 `specnfc change create <change-id>`
  - 当前文档通常是 `specs/changes/<change-id>/01-需求与方案.md`
- 当前已有 active change：
  - 主动作通常是 `specnfc change check <change-id>`
  - 由 `change check` 再继续分流到 `01 / 02 / 03 / 04`

`--json` 下重点关注：

- `summary.readiness`：handoff 就绪、release 阻塞、被对接阻塞的 change 数
- `summary.relationships`：change 与 integration 的依赖关系摘要
- `repo.integrations`：ready / blocked / affectedChanges 汇总
- `repo.nextStepProtocol`：机器可读的下一步协议
- `contractHealthSummary`：协议合同健康摘要

推荐用法：

1. 刚进入仓，先跑 `specnfc status`
2. 看“当前推进主链路”
3. 按 `primaryAction / primaryDoc` 执行
4. 再跑 `specnfc status` 或 `specnfc change check <change-id>` 进入下一步
