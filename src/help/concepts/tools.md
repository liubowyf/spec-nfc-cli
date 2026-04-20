# 多工具接入说明

仓里只维护一套规则，不给每个工具各写一份。

规则源：
- 同一个仓只维护一套正式规范，源头在 `.specnfc/` 与 `specs/changes/`
- 不同工具只是在入口文件上做适配，不复制第二套规则
- 所有任务都必须先回到仓级 `status`，再决定落到哪个 `change`
- AI 只负责规格、实现、验证和交接，不负责最终发布

入口：
- `Codex / OpenCode`：读取 `AGENTS.md`
- `Claude Code`：读取 `CLAUDE.md`
- `Trae`：读取 `.trae/rules/project_rules.md`
- `OpenCode` 另外通过 `opencode.json` 自动纳入 `.specnfc/**/*.md` 与 `specs/changes/**/*.md`

接入顺序：
1. `specnfc init --profile enterprise`
2. `specnfc status`
3. `specnfc change create <change-id> --title "标题"`
4. `specnfc change check <change-id>`
5. 必要时再执行 `specnfc doctor`
6. 再打开任意 AI 工具开始工作

强引导理解：
- `init`：把项目接入协议
- `status`：统一给出当前主链路
- `change create`：只负责建立 work object
- `change check`：决定当前应该补哪份文档
- AI 工具进入后，不应自行跳过这条主链路

开场提示：
- “按仓内 Spec nfc 规范执行，先运行 `specnfc status`，读取当前主动作和当前文档，再开始。”
- “如需进入某个 change，先执行 `specnfc change check <change-id>`，严格按返回的当前文档推进。”
- “本次仅处理 `specs/changes/<change-id>/` 范围，不改无关代码。”

切换工具时：
- 可以在同一 change 下切换工具
- 不允许因为切换工具而切换规则源
- 以仓内正式文件和 `status / change check` 返回的 next-step 为准，不以聊天记录为准

个人 Skills：
- 团队允许保留个人 skills 和提示词习惯。
- 个人 skills 只能影响工作方式，不能覆盖仓内规则、当前 change、验证要求和发布边界。
- 冲突时统一回退到 `AGENTS.md / CLAUDE.md / .trae/rules/project_rules.md`、`.specnfc/` 和当前 change。
- 下游交接只认仓内正式文件，不认个人 skill 专用过程产物。

补充：
- `Trae` 当前采用工程兼容层做接入，如你们团队的 Trae 版本规则入口不同，可调整 `.trae/rules/project_rules.md` 模板
