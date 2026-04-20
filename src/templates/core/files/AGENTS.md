# `AGENTS.md` 入口说明

> 本文件由 `Spec nfc` 自动生成并维护，供 `Codex / OpenCode` 等读取仓库级规则的工具使用。

## 文件定位
- 本文件是当前业务仓的 AI 入口文件。
- 面向当前阶段的执行者，不区分岗位。
- 规则入口优先来自 `.specnfc/` 和 `specs/`，不在这里重复维护整套规范。

## 工具入口
{{toolEntryMappingMarkdown}}

## 项目记忆索引
{{memoryIndexBlock}}

## AI 执行前必须先读
{{requiredReadListMarkdown}}

{{optionalReadBlock}}

## 开始实现前必须先执行
{{preflightCommandListMarkdown}}
- 若 `status --json`、`change check` 或 `integration check` 返回 blocking / 阻断项，先修复正式文档，再决定是否进入实现。
- 若 `.specnfc/indexes/project-index.json` 或 `specs/project/summary.md` 缺失，先补齐项目层协议入口，再推进正式开发。

## canonical phases
- 唯一正式阶段顺序：`clarify → design → plan → execute → verify → accept → archive`
- 未完成 `clarify / design / plan`，不得进入 `execute`
- 所有正式开发、验证、交付、归档动作都必须绑定一个当前 `change`

## 标准执行顺序
1. 先读取 `specs/project/summary.md` 与 `.specnfc/indexes/project-index.json`
2. 再读取当前 `change` 的 `meta.json`
3. 再读取 `spec.md`、`plan.md` 和 `tasks.md`
4. 读取相关代码、测试和上下文
5. 明确边界、禁改区和最低验证要求
6. 若涉及对接，先确认 `specnfc integration check <integration-id>` 已无阻断
7. 若涉及权限、数据迁移、接口变更或发布，补读治理层关键文件
8. 只在当前 change 范围内执行并回写正式文件

## 个人 Skills 兼容规则
- 允许使用个人 skills、快捷指令和本地工作流。
- 个人 skills 只能影响工作方式，不得改写仓内流程、文件结构、验证要求和发布边界。
- 与个人 skills 或本地习惯冲突时，以仓内正式规范、`.specnfc/` 和当前 change 为准。
- 下游交接只认仓内正式文件，不认个人 skill 专用过程产物。

## 输出原则
- 只保留最终结果与必要上下文
- 不把过程流水账传给下游
- 遇到禁改区、高风险边界、发布相关内容时必须停下

## 禁止事项
- 禁止跳过 `clarify / design / plan` 直接进入实现
- 禁止未绑定 change 就开始正式开发、验证或交付
- 禁止脱离当前 `change` 改动无关代码
- 禁止静默改变接口、数据库结构和发布边界
- 禁止虚构测试结果、验证结论和上线状态
- 禁止把长篇推理链直接传给下游 Agent

## 高风险场景
- 权限与鉴权
- 支付与资金
- 数据迁移与回填
- 接口兼容性破坏
- 并发、幂等与重试
- 安全策略和风控核心逻辑
