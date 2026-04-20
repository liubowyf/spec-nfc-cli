# 工作流技能：评审复核（review）

- canonical phase：`verify`
- 触发条件：当设计、实现或对接结果需要形成结构化 review 结论时触发。

## 全局阶段顺序
- 唯一正式顺序：`clarify → design → plan → execute → verify → accept → archive`
- 未完成上游阶段，不得跳过进入下游阶段。
- 所有正式开发、验证、交付动作必须绑定当前 change / integration dossier。

## 前置条件
- 待评审对象已明确
- review scope 与 reviewer 角色已知

## 输入
- 目标 dossier / diff / 契约文档
- 当前风险、验证信息、治理记录

## 输出
- review 结论
- 阻断项与建议项
- 是否允许进入下一阶段

## 阶段门禁
### 必需文档
- specs/changes/<change-id>/status.md

### 必需证据
- specs/changes/<change-id>/evidence/reviews/<review-id>.json

### 阻断条件
- review 结论未结构化
- review 阻断未回填 status.md

### 完成判定
- review evidence 已落盘
- blocking / advisory 已映射到下一步

## 必须写入的正式文档
- specs/changes/<change-id>/evidence/reviews/<review-id>.json
- specs/changes/<change-id>/status.md

## writeback 规则
- 队列：`.nfc/sync/pending-writeback.json`
- 历史：`.nfc/sync/writeback-history.json`
- 阶段退出前必须完成写回：是

## 运行时对象
- .nfc/logs/actions/
- .nfc/handoffs/pending/
- .nfc/sync/pending-writeback.json

## 建议 CLI
- `specnfc change check <change-id>`

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
