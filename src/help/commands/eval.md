# `specnfc eval`

运行仓内 agent 评测与回归用例。

用法：
  specnfc eval list
  specnfc eval validate
  specnfc eval run [--suite <name>] [--case a,b] [--allow-approval] [--dry-run]

说明：
  - 用例定义在 `.specnfc/evals/manifest.json`
  - 每个用例声明 command、timeoutMs 与 expect（exitCode / stdoutIncludes / fileExists 等）
  - 结果写入 `.nfc/evals/results/<runId>.json`，包含 traceId 与逐用例耗时
  - 任一用例失败时命令以非零退出码结束，可直接用于 CI 门禁
  - eval 用例等同于 CI 脚本，必须像代码一样评审；不要在用例中读取或输出凭据
  - 执行前会检查 `.specnfc/security/permissions.json`：命中 deny 的命令直接拒绝，命中 requireApproval 的命令需要 `--allow-approval`
  - 子进程只继承最小环境变量（PATH / HOME / TMPDIR / LANG 等），不会传入仓库或 CI 的密钥变量

示例：
  specnfc eval list
  specnfc eval run
  specnfc eval run --suite smoke
  specnfc eval run --case protocol-config