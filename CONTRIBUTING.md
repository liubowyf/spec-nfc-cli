# 贡献指南

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

## 变更建议

- 功能改动优先补充或更新公开样例：`examples/`、`specs/public-samples/`
- 如修改 CLI 行为，同时更新 `README.md`
- 如修改输出合同，同时同步更新 `.specnfc/design/*.schema.json`
- 避免把内部运行时、临时材料或私人流程约定带入公开结果

## Pull Request 期望

- 说明变更动机，而不是只罗列文件名
- 给出验证命令和结果
- 如果涉及协议变更，明确说明对 `init / change / integration / status / doctor` 的影响
