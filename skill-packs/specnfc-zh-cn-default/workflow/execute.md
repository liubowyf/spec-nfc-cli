# 工作流技能：执行落地（execute）

- canonical phase：`execute`
- 触发条件：当 plan gate 已满足，需要按计划实施并持续回填状态时触发。

## 全局阶段顺序
- 唯一正式顺序：`clarify → design → plan → execute → verify → accept → archive`
- 未完成上游阶段，不得跳过进入下游阶段。
- 所有正式开发、验证、交付动作必须绑定当前 change / integration dossier。

## 前置条件
- 当前阶段已可进入 execute
- 依赖 integration 不阻断

## 输入
- plan.md
- tasks.md
- decisions.md
- 当前代码与测试状态

## 输出
- 实现推进
- 风险与阻断更新
- 标准 next-step 输出

## 阶段门禁
### 必需文档
- specs/changes/<change-id>/plan.md
- specs/changes/<change-id>/tasks.md
- specs/changes/<change-id>/status.md

### 必需证据
- 当前无硬性证据要求

### 阻断条件
- plan gate 未满足
- 上游 integration 未 ready / aligned
- 缺少当前执行范围与状态回填

### 完成判定
- 状态已持续回填
- 实现进展与阻断同步到 status.md

## 必须写入的正式文档
- specs/changes/<change-id>/status.md

## writeback 规则
- 队列：`.nfc/sync/pending-writeback.json`
- 历史：`.nfc/sync/writeback-history.json`
- 阶段退出前必须完成写回：是

## 运行时对象
- .nfc/notes/working.md
- .nfc/logs/actions/
- .nfc/sync/pending-writeback.json

## 建议 CLI
- `specnfc change stage <change-id> --to in-progress`

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
