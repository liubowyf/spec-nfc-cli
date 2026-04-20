# 运行时 Playbook：发布前检查

## 最小执行步骤
1. 先运行 doctor / status 确认 control-plane 与 compliance。
2. 再核对安装包内容、manifest 与 install verify。
3. 最后回写交接单与交付检查单。

## 共通约束
- 正式真相源始终是 `.specnfc/` 与 `specs/`。
- playbook 只能指导执行，不得取代阶段门禁。
- 需要写回时必须更新 `.nfc/sync/*`。
