# `specnfc trace`

检查 change 的需求、验收、任务与证据链。

用法：
  specnfc trace <change-id> [--strict] [--no-write]

说明：
  - 识别 `REQ-xxx`、`AC-xxx`、`TASK-xxx`、`EV-xxx` 编号
  - 输出需求 → 验收 → 任务 → 证据的覆盖矩阵与缺口
  - 默认把报告写入 `.specnfc/traceability/<change-id>.json`
  - `--strict` 在存在缺口时返回非零退出码

示例：
  specnfc trace risk-device-link
  specnfc trace risk-device-link --strict