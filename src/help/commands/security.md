# `specnfc security`

检查权限清单与不可信内容策略。

用法：
  specnfc security check

说明：
  - 权限清单：`.specnfc/security/permissions.json`
  - 检查默认拒绝、写范围、危险命令白名单、网络出口、密钥模式与审批要求
  - 存在阻塞项时返回非零退出码

示例：
  specnfc security check