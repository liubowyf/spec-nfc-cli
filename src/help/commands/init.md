# `specnfc init` 初始化命令

这个命令不是单纯“建目录”，而是把当前仓接入 `Spec nfc` 协议。

执行后会完成：
- 初始化 `.specnfc/` 控制面
- 初始化 `.nfc/` 本地运行时骨架
- 初始化 `specs/` 正式文档目录
- 生成多工具入口文件
- 写入仓级 next-step 协议

执行完成后，默认第一步不是直接创建 change，而是先运行：

- `specnfc status`

因为 `status` 才是当前仓的默认总入口，它会明确告诉你：
- 当前阶段
- 当前步骤
- 当前主动作
- 当前文档
- 当前不该做什么
- 完成后下一步

常用参数：
- --profile <minimal|standard|enterprise>
- --with <模块列表>
- --dry-run
- --force
- --json
- --cwd <路径>

示例：
- specnfc init
- specnfc init --profile standard
- specnfc init --profile enterprise
- specnfc init --with context,execution,governance
- specnfc init --dry-run

推荐顺序：
1. `specnfc init --profile enterprise`
2. `specnfc status`
3. `specnfc change create <change-id> --title "标题"`
4. `specnfc change check <change-id>`

补充说明：
- `init` 只负责接管项目协议，不负责替你决定当前 change
- 如果仓里已经有 active change，`status` 会优先引导你继续当前 change
- 如果仓里还没有 active change，`status` 会引导你创建第一项 change
