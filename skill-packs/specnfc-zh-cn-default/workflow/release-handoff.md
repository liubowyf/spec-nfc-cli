# 工作流技能：发布交接（release-handoff）

- canonical phase：`accept`
- 触发条件：当验证闭合后，需要形成面向发布、接手人或运维侧的最终交接包时触发。

## 全局阶段顺序
- 唯一正式顺序：`clarify → design → plan → execute → verify → accept → archive`
- 未完成上游阶段，不得跳过进入下游阶段。
- 所有正式开发、验证、交付动作必须绑定当前 change / integration dossier。

## 前置条件
- acceptance 已确认
- 必要治理记录已齐备
- 交付范围与回退路径已知

## 输入
- acceptance.md
- delivery-checklist.md
- 发布影响、回退、验证与依赖信息

## 输出
- 可执行发布交接单
- 最终交付说明
- 是否允许 release / archive 的结论

## 阶段门禁
### 必需文档
- specs/changes/<change-id>/release-handoff.md
- specs/changes/<change-id>/delivery-checklist.md
- specs/changes/<change-id>/status.md

### 必需证据
- 必要时的 release decision / verification / approval 记录

### 阻断条件
- 发布影响、回退、依赖、验证摘要不完整
- 交接结论未与 delivery-checklist 对齐

### 完成判定
- 交接单与交付检查单已同步
- release / archive 条件明确

## 必须写入的正式文档
- specs/changes/<change-id>/release-handoff.md
- specs/changes/<change-id>/delivery-checklist.md
- specs/changes/<change-id>/commit-message.md
- specs/changes/<change-id>/status.md

## writeback 规则
- 队列：`.nfc/sync/pending-writeback.json`
- 历史：`.nfc/sync/writeback-history.json`
- 阶段退出前必须完成写回：是

## 运行时对象
- .nfc/handoffs/pending/
- .nfc/logs/actions/
- .nfc/sync/pending-writeback.json

## 建议 CLI
- `specnfc change handoff <change-id>`

## 完成后必须输出
1. 当前阶段
2. 已完成
3. 缺失 / 阻断
4. 推荐下一步
5. 是否需要 writeback
6. 是否存在 projection / skill-pack drift

## 治理模式差异
- advisory：提示为主，不直接阻断。
- guided：缺正式文档或关键 section 时给出强提示。
- strict：缺 gate 或未写回时可软阻断阶段推进。
- locked：不得绕过当前阶段与正式 dossier。
