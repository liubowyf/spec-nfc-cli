# Spec nfc 项目规则

> 本文件由 `Spec nfc` 自动生成并维护，作为 Trae 的项目规则兼容入口。

本项目使用 `Spec nfc` 作为标准开发流程。

## 项目记忆索引
{{memoryIndexBlock}}

## 必须遵守

在开始任何实现前，先读取：
{{requiredReadListMarkdown}}
- 在开始任何实现前，先执行：
{{preflightCommandListMarkdown}}
- 若 `.specnfc/indexes/project-index.json` 或 `specs/project/summary.md` 缺失，先补齐项目层协议入口。
- 唯一正式阶段顺序：`clarify → design → plan → execute → verify → accept → archive`
- 未完成 `clarify / design / plan`，不得进入 `execute`
- 所有开发任务必须先对应到一项 change。
- 只允许在当前 change 范围内执行改动。
- 输出必须回写正式文件，不以聊天记录代替交付。

## 个人 Skills 兼容规则

- 允许保留个人 skills、提示词和本地工作流。
- 个人 skills 只能影响工作方式，不能覆盖仓内规则、当前 change、验证要求和发布边界。
- 与个人 skills 或本地习惯冲突时，以仓内正式规范、`.specnfc/` 和当前 change 为准。
- 下游交接只认仓内正式文件，不接个人 skill 专用过程产物。

{{optionalReadBlock}}

## 推荐执行顺序

1. 先读 `specs/project/summary.md` 与 `.specnfc/indexes/project-index.json`
2. 再读 `spec.md`
3. 再读 `plan.md`
4. 再读 `tasks.md`
5. 再进行代码、测试和验证

## 禁止事项

- 禁止跳过 `clarify / design / plan` 直接进入实现
- 禁止跳过 change 直接开发
- 禁止静默改接口、库表和发布边界
- 禁止虚构测试结果
- 禁止把长篇推理链传给下游
