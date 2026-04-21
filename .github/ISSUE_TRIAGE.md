# Issue Triage 指南

本文件用于帮助维护者和贡献者对 GitHub Issue 做最小一致化分流。

## Triage 目标

- 先判断问题类型，再决定处理路径
- 尽快把可复现问题与信息不足问题区分开
- 避免安全问题、内部问题或非公开问题进入公开讨论

## 建议分类

### 1. Bug

适用情况：

- 命令行为与文档不一致
- 输出结构异常或 schema 不匹配
- `init / change / integration / status / doctor / upgrade` 产生错误结果
- 公开装配、打包或安装验证出现回归

建议补充：

- 复现步骤
- 预期结果
- 实际结果
- Node / npm 版本
- 使用命令与最小样例

### 2. Feature request

适用情况：

- 新增协议能力
- 新增或强化命令语义
- 新增示例、公开文档、样例 dossier
- 新增或增强 skill-pack / prompt / 治理能力

建议补充：

- 目标场景
- 当前缺口
- 期望结果
- 是否影响公开安装 / GitHub 首页 / npm 用户体验

### 3. Documentation

适用情况：

- README、CHANGELOG、样例、帮助文档不清楚
- 安装说明或升级说明不完整
- 公开文档与真实行为不一致

### 4. Security

适用情况：

- 路径逃逸
- 非法写入
- 包边界泄漏
- 运行时写回导致越权覆盖
- 公开仓暴露敏感信息

处理要求：

- 不要在公开 issue 中提交可直接利用的细节
- 请按 `SECURITY.md` 中的私密披露方式联系维护者

## Triage 状态建议

可使用以下简单状态来帮助维护：

- `needs-repro`：缺少可复现信息
- `needs-scope`：需求边界不清
- `confirmed`：问题已确认
- `good-first-issue`：适合首次贡献
- `help-wanted`：欢迎社区协助
- `blocked`：依赖其他问题或版本
- `security-private`：转私密渠道处理

## 优先级判断建议

优先级从高到低通常为：

1. 安全问题
2. 公开发布面问题（GitHub / npm / pack-verify）
3. 核心命令回归（init / change / integration / status / doctor / upgrade）
4. schema / 文档合同回归
5. README / 示例 / 文档体验问题
6. 增强类需求

## 关闭 Issue 的建议条件

可考虑关闭的情况：

- 已在最新版本修复并给出版本说明
- 无法复现且长时间缺少补充信息
- 问题不属于公开仓范围
- 属于安全问题并已转私密渠道
- 与现有 issue 明显重复
