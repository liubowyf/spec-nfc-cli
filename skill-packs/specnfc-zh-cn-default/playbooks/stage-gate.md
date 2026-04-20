# 运行时 Playbook：阶段门禁

## 最小执行步骤
1. 先确认当前 canonical phase 与 legacy stage mapping。
2. 先确认 `.specnfc/indexes/project-index.json` 与 `specs/project/summary.md` 已存在且可读。
3. 未满足上游 gate 时，不进入下游执行动作。
4. 阶段切换后立即刷新 `.specnfc/execution/next-step.json`。

## 共通约束
- 正式真相源始终是 `.specnfc/` 与 `specs/`。
- playbook 只能指导执行，不得取代阶段门禁。
- 需要写回时必须更新 `.nfc/sync/*`。
