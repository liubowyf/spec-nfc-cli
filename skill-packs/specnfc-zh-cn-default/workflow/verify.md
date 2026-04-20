# 工作流技能：验证验收（verify）

- canonical phase：`verify`
- 触发条件：当实现已完成，需要沉淀验证方式、结果和剩余风险时触发。

## 全局阶段顺序
- 唯一正式顺序：`clarify → design → plan → execute → verify → accept → archive`
- 未完成上游阶段，不得跳过进入下游阶段。
- 所有正式开发、验证、交付动作必须绑定当前 change / integration dossier。

## 前置条件
- 执行主体已完成
- 相关验证命令可运行

## 输入
- 测试结果
- 验收范围
- 风险清单
- status.md

## 输出
- 验证结论明确
- 剩余风险明确
- 是否进入 accept 的结论

## 阶段门禁
### 必需文档
- specs/changes/<change-id>/acceptance.md
- specs/changes/<change-id>/status.md

### 必需证据
- 测试 / 验证记录
- 必要时的 review / approval evidence

### 阻断条件
- 缺验证结论
- 关键失败未说明
- evidence 未与 acceptance 对齐

### 完成判定
- acceptance.md 已形成结论
- status.md 已同步剩余风险与 accept 判断

## 必须写入的正式文档
- specs/changes/<change-id>/acceptance.md
- specs/changes/<change-id>/status.md

## writeback 规则
- 队列：`.nfc/sync/pending-writeback.json`
- 历史：`.nfc/sync/writeback-history.json`
- 阶段退出前必须完成写回：是

## 运行时对象
- .nfc/logs/actions/
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
