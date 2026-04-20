# `specnfc change` 变更工作流命令

这个命令管理 `specs/changes/` 下的变更目录。

当前默认主链路不是“一次性把所有文档都补完”，而是：

1. `specnfc change create <change-id> --title "标题"`
2. 先补 `01-需求与方案.md`
3. `specnfc change check <change-id>`
4. 再由 `check` 分流到后续文档

子命令：
- create <change-id>：创建一项新的变更
- list：列出当前全部变更；会显示阶段、成熟度、交付状态和下一步动作
- check [change-id]：检查单个或全部变更的完整性，并给出当前主动作/当前文档/下一步
- stage <change-id> --to <stage>：推进变更阶段；启用 `delivery` 时会同步交付阶段
- handoff <change-id>：生成发布交接单；启用 `delivery` 时会同步交付自检状态
- archive <change-id>：归档变更；启用 `delivery` 时会同步归档状态并校验交付前置条件

常用参数：
- --title <标题>
- --type <类型>
- --to <阶段>
- --dry-run
- --force
- --json
- --cwd <路径>
示例：
- specnfc change create risk-device-link --title "设备关联风险识别增强"
- specnfc change list
- specnfc change check risk-device-link
- specnfc change stage risk-device-link --to in-progress
- specnfc change handoff risk-device-link
- specnfc change archive risk-device-link

默认文档：
- `01-需求与方案.md`：先写需求边界、方案结论、验收口径
- `02-技术设计与选型.md`：中高复杂度 / 涉及架构取舍 / 技术选型时必须细写
- `03-任务计划与执行.md`：任务拆分、执行状态、阻塞、下一步
- `04-验收与交接.md`：验证结果、交接说明、提交说明、handoff / archive 前置条件

`create` 后默认只要求先补：
- `01-需求与方案.md`

`check` 的分流规则：
- 低复杂度：`01 → 03`
- 中高复杂度 / 涉及架构取舍 / 技术选型：`01 → 02 → 03`
- 进入交付前统一收口到 `04`

当前不要误用：
- `create` 后不要先补 `03`
- `create` 后不要直接写代码
- `check` 没通过前，不要直接推进 `stage --to in-progress`
