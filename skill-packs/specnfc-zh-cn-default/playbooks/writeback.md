# 运行时 Playbook：写回编排

## 最小执行步骤
1. 先识别运行时产物对应的正式文档目标。
2. 把待回写项登记到 `.nfc/sync/pending-writeback.json`。
3. 写回完成后，把结果追加到 `.nfc/sync/writeback-history.json`。

## 共通约束
- 正式真相源始终是 `.specnfc/` 与 `specs/`。
- playbook 只能指导执行，不得取代阶段门禁。
- 需要写回时必须更新 `.nfc/sync/*`。
