# 维护者说明

本文件用于公开说明当前仓库的维护责任与基本维护边界。

## 当前维护者

- 仓库维护者：[@liubowyf](https://github.com/liubowyf)

## 维护范围

当前维护工作主要包括：

- CLI 核心行为与输出合同
- `init / change / integration / status / doctor / explain / upgrade / demo / version`
- 公开 README、CHANGELOG、示例与样例 dossier
- npm 包与 GitHub Release 公开发布面
- 协议 schema、回归测试与包边界校验

## 维护原则

- 公开结果优先保持清晰、稳定、可验证
- 文档、示例与真实行为应尽量同步
- 与公开仓无关的内部过程、私有运行时与敏感信息不进入公开结果
- 发布结果必须经过可复现校验，而不是只依赖人工判断

## Issue / PR 处理原则

优先级通常按以下顺序处理：

1. 安全问题
2. 公开发布面问题（GitHub / npm / 包边界）
3. 核心命令回归
4. schema / 文档合同回归
5. README / 示例 / 使用体验问题
6. 增强类需求

## 版本与发布责任

维护者负责：

- 版本号与发布说明的一致性
- GitHub Release 与附件的完整性
- npm 公共包可安装、可执行、可校验
- 公开仓首页与公开示例的基础可读性

## 当前边界

当前仓库是公开项目，不在本仓公开维护：

- 私有团队内部流程
- 私有审批 / IM / 知识库联动
- 非公开运行时记录
- 与公开包无关的内部操作细节

## 联系与支持

如需一般帮助，请优先查看：

- [SUPPORT.md](./SUPPORT.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
