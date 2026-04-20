# 安装说明

`Spec nfc` 依赖 `Node.js >= 20`。

先检查：

```bash
node -v
npm -v
```

## 最终用户安装

推荐直接通过 npm 安装全局命令：

```bash
npm install -g spec-nfc
specnfc version
specnfc --help
```

也可以不安装，直接临时试用：

```bash
npx --yes spec-nfc@latest --help
npx --yes spec-nfc@latest version
```

## 从源码仓本地验证

如果你正在贡献源码或调试当前仓，可以使用：

```bash
npm install
npm test
npm link
specnfc version
```

如需结构化结果，可执行：

```bash
node ./scripts/bootstrap.mjs --json
```

不做全局命令时，也可以直接运行：

```bash
node ./bin/specnfc.mjs version
node ./bin/specnfc.mjs --help
```

## 平台建议

- `macOS`：可使用 `Homebrew` 或 `nvm` 管理 Node.js
- `Linux`：优先使用用户级 Node 环境，避免依赖 `sudo`
- `Windows`：优先使用 `PowerShell`；安装 Node 后重新打开终端再执行 `npm link`

安装完成后至少验证：

```bash
specnfc version
specnfc explain install
specnfc explain
specnfc demo --cwd /tmp/specnfc-demo
specnfc doctor --cwd /tmp/specnfc-demo
```
