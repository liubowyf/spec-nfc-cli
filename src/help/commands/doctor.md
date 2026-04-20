# `specnfc doctor` 仓库检查命令

这个命令检查当前仓库的 `Spec nfc` 状态。

输出分三类：
- 正常项
- 缺失项
- 风险项

额外会检查：
- 入口文件是否写明个人 Skills 兼容规则
- governance 模块下是否存在 `personal-skills.md`
- `opencode.json` 是否纳入治理层规则
- 启用 `delivery` 时，会输出交付总览与交付阻塞项
- 启用 `delivery` 时，会提示哪些 change 还缺提交说明或交付自检
- 会输出发布就绪度摘要（handoff 就绪、release blocker、仓级风险）
- 会输出对接依赖摘要（哪些 change 被 integration 阻塞、哪些 integration 尚未 ready）

示例：
- specnfc doctor
- specnfc doctor --json
