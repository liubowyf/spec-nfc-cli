# `Spec nfc` 命令总览

用法：
  specnfc <命令> [参数]

可用命令：
  init        初始化并接管项目协议
  add         追加可选模块
  change      管理 specs/changes 下的变更工作流
  demo        生成完整公开示例仓
  doctor      检查当前仓协议一致性
  status      默认总入口；统一查看当前仓状态与下一步建议
  explain     解释当前结构、模块和命令
  upgrade     升级当前仓模板到最新版本
  version     查看版本信息
  integration 管理多人接口 / service 对接关系

示例：
  specnfc init
  specnfc init --profile enterprise
  specnfc status
  specnfc change create risk-device-link --title "设备关联风险识别增强"
  specnfc change check risk-device-link
  specnfc doctor
  specnfc change stage risk-device-link --to in-progress
  specnfc integration list
  specnfc explain install
  specnfc explain modules
  specnfc explain skills
  specnfc upgrade --dry-run

推荐主链路：
  1. specnfc init --profile enterprise
  2. specnfc status
  3. specnfc change create <change-id> --title "标题"
  4. specnfc change check <change-id>

默认理解：
  - init 负责把项目接入 Spec nfc 协议
  - status 负责告诉你当前仓下一步最应该做什么
  - change create 之后先补 01-需求与方案.md
  - change check 会按复杂度分流到 02-技术设计与选型.md 或 03-任务计划与执行.md
