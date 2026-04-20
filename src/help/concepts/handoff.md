# 交接说明

`handoff` 不是“发一段聊天总结”，而是把当前 change 的可交接结果落到正式文件。

最小交接面包括：

- `04-验收与交接.md`：验收范围、验证结果、剩余风险与交接结论
- `release-handoff.md`：面向发布或下一位接手人的交接单

旧版仓如果仍保留 `delivery-checklist.md / commit-message.md`，只作为兼容输入，不再是当前新 change 的默认交接主文档。

推荐流程：

1. 先运行 `specnfc change check <change-id>`，确认四主文档没有明显缺口
2. 若状态已到 `verifying` 或可交接，运行 `specnfc change handoff <change-id>`
3. 补齐 `release-handoff.md`
4. 再决定是否归档

交接时必须说明：

- 当前已经完成了什么
- 还有哪些未完成或风险
- 下一个人继续时先做什么
- 是否还依赖外部对接 / 其他 change / 环境条件

不建议的做法：

- 只在聊天里描述结论，不回写正式文件
- `release-handoff.md` 缺失就直接归档
- `04-验收与交接.md` 还没闭合就交给别人继续

配套命令：

- `specnfc status`
- `specnfc doctor`
- `specnfc change handoff <change-id>`
- `specnfc change archive <change-id>`
