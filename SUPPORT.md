# 支持与使用帮助

如果你在使用 `spec-nfc` 时遇到问题，建议按下面顺序处理。

## 1. 先看公开文档

优先阅读：

- [README.md](./README.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [`examples/public/`](./examples/public)
- [`specs/public-samples/`](./specs/public-samples)

这些文档覆盖了：

- 安装与快速开始
- 版本变化
- 贡献方式
- 安全问题披露方式
- 公开示例与 dossier 样例

## 2. 如果是使用问题

请优先确认：

- Node.js 版本是否满足 `>= 20`
- 是否执行过：

```bash
specnfc --help
specnfc version
```

- 当前问题是否能在最小示例中复现

如果是安装或发布面问题，可补充执行：

```bash
node ./scripts/pack-verify.mjs --json
```

## 3. 如果是 Bug 或缺陷

请通过 GitHub Issue 提交，并尽量附带：

- 复现步骤
- 预期行为
- 实际行为
- Node / npm 版本
- 使用命令
- 最小复现样例

Issue 分流建议见：

- [`.github/ISSUE_TRIAGE.md`](./.github/ISSUE_TRIAGE.md)

## 4. 如果是功能建议

请说明：

- 你的使用场景
- 当前缺口在哪里
- 期望的行为或输出
- 是否会影响 `init / change / integration / status / doctor / upgrade`

## 5. 如果是安全问题

请不要在公开 Issue 中直接披露可利用细节。

请改为查看：

- [SECURITY.md](./SECURITY.md)

并按其中说明通过私密渠道联系维护者。

## 6. 如果你不确定该走哪条路径

默认建议：

- 普通问题 / 文档不清：GitHub Issue
- 功能建议：GitHub Issue
- 安全问题：私密披露
- 贡献代码：先看 [CONTRIBUTING.md](./CONTRIBUTING.md)
