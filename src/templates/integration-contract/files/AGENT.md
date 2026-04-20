# `integration-contract` 模块的 `AGENT` 规则

`change` 涉及多人接口 / service 对接时，必须使用本模块。

## 必须输出

- provider / consumer
- 关联 `change-id`
- 契约摘要
- 责任分工
- 依赖顺序
- 联调前置
- 当前状态与阻塞

## 禁止事项

- 接口未对齐就推进到 `in-progress`
- 把责任分工留在聊天记录里
- 联调阻塞不写入正式文件
