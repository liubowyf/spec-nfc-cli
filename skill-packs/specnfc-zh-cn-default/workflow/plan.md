# 工作流技能：任务规划（plan）

- canonical phase：`plan`
- 触发条件：当设计已闭合，需要形成任务切分、验证计划和依赖顺序时触发。

## 全局阶段顺序
- 唯一正式顺序：`clarify → design → plan → execute → verify → accept → archive`
- 未完成上游阶段，不得跳过进入下游阶段。
- 所有正式开发、验证、交付动作必须绑定当前 change / integration dossier。

## 前置条件
- design.md / spec.md 已具备执行价值
- 关键风险已记录

## 输入
- design.md
- spec.md
- capabilities.md
- spec-deltas.md

## 输出
- 任务切分明确
- 验证计划明确
- 关键决策与依赖顺序明确

## 阶段门禁
### 必需文档
- specs/changes/<change-id>/plan.md
- specs/changes/<change-id>/tasks.md
- specs/changes/<change-id>/decisions.md

### 必需证据
- 当前无硬性证据要求

### 阻断条件
- 未形成任务拆分
- 未形成验证计划
- 未记录关键依赖与决策

### 完成判定
- tasks.md 可直接驱动执行
- 验证路径与依赖顺序已明确

## 必须写入的正式文档
- specs/changes/<change-id>/plan.md
- specs/changes/<change-id>/tasks.md
- specs/changes/<change-id>/decisions.md

## writeback 规则
- 队列：`.nfc/sync/pending-writeback.json`
- 历史：`.nfc/sync/writeback-history.json`
- 阶段退出前必须完成写回：是

## 运行时对象
- .nfc/plans/active/
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
