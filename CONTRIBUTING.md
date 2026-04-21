# 贡献指南

感谢你关注 `spec-nfc`。

本项目欢迎围绕以下方向的改进：

- CLI 行为与输出合同
- change / integration / status / doctor 协议能力
- README、示例、公开样例 dossier
- 安装、升级、发布、公开装配与边界校验
- schema、测试、失败路径与回归补强

## 开发环境

- Node.js >= 20
- npm >= 10

```bash
npm install
npm test
```

## 提交前最低要求

```bash
npm test
node ./scripts/pack-verify.mjs --json
```

说明：`pack-verify` 在内部源仓执行时会先装配 `dist/public/npm-publish/`，然后只校验公开 npm 发布视图。

## 变更建议

- 功能改动优先补充或更新公开样例：`examples/`、`specs/public-samples/`
- 如修改 CLI 行为，同时更新 `README.md` 与 `README.en.md`
- 如修改输出合同，同时同步更新 `.specnfc/design/*.schema.json`
- 如修改公开发布面，确认 `CHANGELOG.md` 与 Release 说明是否也应同步
- 避免把内部运行时、临时材料或私人流程约定带入公开结果

## Pull Request 期望

- 说明变更动机，而不是只罗列文件名
- 给出验证命令和结果
- 如果涉及协议变更，明确说明对 `init / change / integration / status / doctor` 的影响
- 如果涉及公开发布面，说明对 GitHub / npm 用户可见的变化

## 推荐开发流程

1. 先阅读 `README.md`、`CHANGELOG.md` 与公开示例索引
2. 明确本次改动属于：功能 / 文档 / schema / 测试 / 发布面
3. 实现最小必要改动
4. 执行测试与 `pack-verify`
5. 补充 README、样例或 changelog（如适用）
6. 提交 PR，并附带验证证据

## Issue 与 Triage

问题分流建议见：[`./.github/ISSUE_TRIAGE.md`](./.github/ISSUE_TRIAGE.md)

一般建议：

- Bug：附复现步骤、预期结果、实际结果、环境信息
- Feature request：说明目标场景、当前缺口、期望行为
- Security issue：不要公开提交细节，请走私密披露渠道

## 公开边界要求

以下内容不应进入公开提交面：

- 内部团队信息
- 私有发布流程细节
- 非公开运行时记录
- 与公开仓无关的私人工具约定

如不确定某类内容是否适合公开，请按“默认不公开”处理。
