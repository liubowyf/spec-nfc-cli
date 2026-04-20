# 工作流技能：集成对齐（integration）

- canonical phase：`design`
- 触发条件：当多人接口 / service 对接需要统一契约、责任分工和联调前置时触发。

## 全局阶段顺序
- 唯一正式顺序：`clarify → design → plan → execute → verify → accept → archive`
- 未完成上游阶段，不得跳过进入下游阶段。
- 所有正式开发、验证、交付动作必须绑定当前 change / integration dossier。

## 前置条件
- integration dossier 已存在
- provider / consumer 边界已知

## 输入
- integration contract
- 相关 change
- 接口 / service 责任边界

## 输出
- 契约对齐
- 联调前置明确
- 依赖阻断可见

## 阶段门禁
### 必需文档
- specs/integrations/<integration-id>/contract.md
- specs/integrations/<integration-id>/status.md

### 必需证据
- 必要时的 integration review / verification evidence

### 阻断条件
- provider / consumer 责任边界不清
- 联调前置未写回 contract/status

### 完成判定
- 契约、依赖和阻断项可直接支撑联调与 change gate

## 必须写入的正式文档
- specs/integrations/<integration-id>/contract.md
- specs/integrations/<integration-id>/status.md

## writeback 规则
- 队列：`.nfc/sync/pending-writeback.json`
- 历史：`.nfc/sync/writeback-history.json`
- 阶段退出前必须完成写回：是

## 运行时对象
- .nfc/handoffs/pending/
- .nfc/sync/pending-writeback.json

## 建议 CLI
- `specnfc integration check <integration-id>`

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
