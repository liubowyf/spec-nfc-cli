# `specnfc integration` 对接协作命令

这个命令管理 `specs/integrations/` 下的多人接口 / service 对接关系。

## 子命令

- `create <integration-id>`：创建新的对接关系
- `list`：列出全部对接关系
- `check [integration-id]`：检查全部或单个对接关系
- `stage <integration-id> --to <state>`：推进对接状态

## 常用写法

```bash
specnfc integration create account-risk-api --provider risk-engine --consumer account-service --changes risk-score-upgrade,account-link-alert
specnfc integration list
specnfc integration check
specnfc integration stage account-risk-api --to aligned
```

## 固定状态

- `draft`
- `aligned`
- `implementing`
- `integrating`
- `blocked`
- `done`

## 基本规则

- 接口 / service 未对齐前，不进入 `in-progress`
- 对接交接只认正式文件，不认聊天记录
- `blocked` 必须写清阻塞原因
- `done` 必须写清验证结论
