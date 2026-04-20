# 对接状态流转

固定状态：

- `draft`
- `aligned`
- `implementing`
- `integrating`
- `blocked`
- `done`

推荐流转：

```text
draft -> aligned -> implementing -> integrating -> done
                  \-> blocked -> aligned / implementing / integrating
```

规则：

- `draft` 不能直接进入 `implementing`
- `blocked` 必须写明阻塞原因
- `done` 必须写明验证结论
