# 工作流技能：交付归档（accept）

- canonical phase：`accept`
- 触发条件：当验证已闭合，需要形成交接、发布准备与归档动作时触发。

## 全局阶段顺序
- 唯一正式顺序：`clarify → design → plan → execute → verify → accept → archive`
- 未完成上游阶段，不得跳过进入下游阶段。
- 所有正式开发、验证、交付动作必须绑定当前 change / integration dossier。

## 前置条件
- acceptance.md 已形成结论
- handoff 前置已满足

## 输入
- acceptance.md
- 交付要求
- 发布影响与回退信息

## 输出
- 交付材料齐备
- handoff / archive 条件明确
- 标准 next-step 输出

## 阶段门禁
### 必需文档
- specs/changes/<change-id>/acceptance.md
- specs/changes/<change-id>/release-handoff.md
- specs/changes/<change-id>/delivery-checklist.md
- specs/changes/<change-id>/status.md

### 必需证据
- 必要时的 verification / approval / release decision 记录

### 阻断条件
- acceptance 未闭合
- handoff 材料不完整
- 交付检查单未确认

### 完成判定
- 交付材料齐备
- 可进入 archive 或 release

## 必须写入的正式文档
- specs/changes/<change-id>/release-handoff.md
- specs/changes/<change-id>/delivery-checklist.md
- specs/changes/<change-id>/status.md

## writeback 规则
- 队列：`.nfc/sync/pending-writeback.json`
- 历史：`.nfc/sync/writeback-history.json`
- 阶段退出前必须完成写回：是

## 运行时对象
- .nfc/handoffs/pending/
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
