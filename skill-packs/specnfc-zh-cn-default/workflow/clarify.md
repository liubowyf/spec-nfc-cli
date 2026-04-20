# 工作流技能：需求澄清（clarify）

- canonical phase：`clarify`
- 触发条件：当 change 仍需统一问题定义、范围、非目标、当前选择和验收口径时触发。
- 借鉴来源：吸收 `oh-my-codex/deep-interview` 的多轮澄清节奏，但正式主权仍归 `specnfc` 的四主文档与阶段门禁。

## 全局阶段顺序
- 唯一正式顺序：`clarify → design → plan → execute → verify → accept → archive`
- 未完成上游阶段，不得跳过进入下游阶段。
- 所有正式开发、验证、交付动作必须绑定当前 change / integration dossier。

## 前置条件
- 已绑定 active change
- 已读取 `specs/changes/<change-id>/01-需求与方案.md`
- 已读取当前 `change check / status / next-step` 输出

## 输入
- 当前 change dossier
- 业务背景、上下文、历史决策
- 当前团队协作边界、外部依赖和验收口径

## 输出
- 问题定义闭合
- 目标 / 非目标 / 范围明确
- 方案备选与当前选择明确
- 风险与验收口径明确
- 标准 next-step 输出

## 工作方式：访谈式澄清协议
本技能不是静态“补文档提醒”，而是**多轮澄清协议**。每一轮只追一个当前最关键、最容易导致团队误解的问题。

### 每轮固定输出结构
1. `Round N`
2. `Target`
3. `Ambiguity`
4. 已确认
5. `Readiness Gates`
6. 本轮唯一关键问题
7. 本轮应写回章节

### 默认澄清顺序
1. **问题定义与目标**
2. **非目标与范围**
3. **方案备选与当前选择**
4. **风险与验收口径**

### Readiness Gates（最小闭合标准）
- `问题定义与目标`：说明为什么现在要做、成功后要达到什么结果
- `非目标与范围`：说明明确不做什么、哪些相邻范围必须排除
- `方案备选与当前选择`：至少给出备选方案与当前选择理由
- `风险与验收口径`：说明关键风险、验收口径、进入下一阶段条件

### 必须出现的追问主题
- **非目标**：防止团队把“顺手优化”“顺手重构”混入当前 change
- **决策边界**：说明哪些决定 AI / 执行者可以自行处理，哪些必须显式确认
- **压力追问**：至少对一个已确认结论做反问，例如“如果不做这部分，会不会影响验收？”

## 阶段门禁
### 必需文档
- `specs/changes/<change-id>/01-需求与方案.md`

### 必需 section
- 问题定义
- 目标
- 非目标
- 范围
- 方案备选
- 当前选择
- 风险与验收口径

### 阻断条件
- `01-需求与方案.md` 仍是占位内容
- 问题定义 / 非目标 / 当前选择 / 验收口径 缺失
- active change 未绑定

### 完成判定
- `01-需求与方案.md` 已补齐关键 section
- `change check` 不再提示 `PLACEHOLDER_REQUIREMENTS_AND_SOLUTION`
- 已能明确进入技术设计或任务计划分流

## 必须写入的正式文档
- `specs/changes/<change-id>/01-需求与方案.md`

## 本技能默认写回章节
- 问题定义
- 目标
- 非目标
- 范围
- 方案备选
- 当前选择
- 风险与验收口径

## writeback 规则
- 队列：`.nfc/sync/pending-writeback.json`
- 历史：`.nfc/sync/writeback-history.json`
- 阶段退出前必须完成写回：是

## 运行时对象
- `.nfc/interviews/active/`
- `.nfc/sync/pending-writeback.json`

## 建议 CLI
- `specnfc change check <change-id>`

## 完成后必须输出
1. 当前阶段
2. 当前轮次
3. 当前聚焦
4. 当前歧义
5. 已确认
6. Readiness Gates
7. 本轮关键问题
8. 本轮写回章节
9. 推荐下一步

## 治理模式差异
- advisory：提示为主，不直接阻断。
- guided：缺正式文档或关键 section 时给出强提示。
- strict：`问题定义 / 非目标 / 当前选择 / 验收口径` 未闭合时软阻断阶段推进。
- locked：不得绕过当前阶段与正式 dossier。
