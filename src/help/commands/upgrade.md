# `specnfc upgrade` 模板升级命令

这个命令用于把已初始化仓升级到当前 `Spec nfc` 模板版本。

当前升级策略是保守型：

- 刷新受管入口文件：`.specnfc/README.md`、`AGENTS.md`、`CLAUDE.md`、`opencode.json`、`.trae/rules/project_rules.md`
- 刷新已追踪且未被手工改动的模块模板文件
- 更新 `.specnfc/config.json` 中的模板版本和默认 change 结构
- 只为现有 change 补齐缺失文件
- 不覆盖已经存在的 change 内容
- 对已追踪但内容已变化的文件，输出冲突并跳过
- 对旧仓里未纳入追踪的现有模板文件，保守跳过并要求人工确认

常见用法：

- specnfc upgrade
- specnfc upgrade --dry-run
- specnfc upgrade --json

`--dry-run` 和 `--json` 会附带受管文件的差异预览，包含：

- 轻量摘要（新增/删除行数、上下文 preview）
- unified diff 风格预览（便于人工审查和给 Agent / CI 消费）
- 支持范围评估（`supported / supported_with_manual_review / out_of_scope`）
- 风险摘要（冲突、保护跳过、超出支持范围）
- 人工补动作摘要（升级后还需要人工补哪些动作）
- 版本迁移说明（从哪个模板版本升级到哪个版本、change 结构补齐了什么）

升级后建议：

- specnfc doctor
- specnfc status
- specnfc change list

如果升级后 `doctor / status` 仍提示 `CHANGE_STRUCTURE_DRIFT`，说明仓里还残留旧版 `defaults.changeStructure`。先修正 `.specnfc/config.json` 或重新执行当前版本 `specnfc upgrade`，再继续新建 change。
