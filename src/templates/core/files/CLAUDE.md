@AGENTS.md

## Claude Code 专用补充

- 本文件由 `Spec nfc` 自动生成并维护。
- 本仓使用 `Spec nfc` 作为标准流程入口。
- 项目记忆索引如下：
{{memoryIndexBlock}}
- 在开始任何实现前，先读取 {{requiredReadSentence}}。
- 在开始任何实现前，先执行 {{preflightCommandSentence}}。
- 若 `.specnfc/indexes/project-index.json` 或 `specs/project/summary.md` 缺失，先补齐项目层协议入口。
- 唯一正式阶段顺序：`clarify → design → plan → execute → verify → accept → archive`。
- 未完成 `clarify / design / plan`，不得进入 `execute`。
- 所有正式开发、验证、交付动作必须绑定一个当前 `change`。
{{optionalReadLine}}
- 当 `AGENTS.md` 与其他个人偏好冲突时，以仓内正式规范、`.specnfc/` 和当前 change 为准。
- 只把最终结果写回正式文件，不把长篇聊天过程当作交付物。

## 个人 Skills 兼容规则

- 允许保留个人 skills 和常用工作习惯。
- 个人 skills 只能影响工作方式，不能覆盖仓内规则、当前 change、验证要求和发布边界。
- 如个人 skill 要求额外过程文件或私有交付物，只能留在本地，不能作为正式交接内容。
