# 工作流技能：系统化调试（systematic-debugging）

- canonical phase：`execute`
- 触发条件：当执行或验证阶段出现失败、异常、回归或不确定根因的问题时触发。

## 全局阶段顺序
- 唯一正式顺序：`clarify → design → plan → execute → verify → accept → archive`
- 未完成上游阶段，不得跳过进入下游阶段。
- 所有正式开发、验证、交付动作必须绑定当前 change / integration dossier。

## 前置条件
- 已绑定 active change 或 integration
- 已有失败症状、日志或复现步骤

## 输入
- 失败现象
- 日志 / 栈 / 测试输出
- 当前 plan / status / decisions

## 输出
- 复现路径明确
- 根因假设明确
- 最小修复路径与验证方式明确

## 阶段门禁
### 必需文档
- specs/changes/<change-id>/status.md
- specs/changes/<change-id>/decisions.md

### 必需证据
- 失败日志 / 测试输出 / 最小复现证据

### 阻断条件
- 没有稳定复现就直接改代码
- 根因与现象未区分
- 修复后无回归验证计划

### 完成判定
- 失败现象可复现或已被边界化
- 根因与修复策略已写回正式文档

## 必须写入的正式文档
- specs/changes/<change-id>/decisions.md
- specs/changes/<change-id>/status.md

## writeback 规则
- 队列：`.nfc/sync/pending-writeback.json`
- 历史：`.nfc/sync/writeback-history.json`
- 阶段退出前必须完成写回：是

## 运行时对象
- .nfc/logs/actions/
- .nfc/notes/working.md
- .nfc/sync/pending-writeback.json

## 建议 CLI
- `specnfc status && specnfc doctor`

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
