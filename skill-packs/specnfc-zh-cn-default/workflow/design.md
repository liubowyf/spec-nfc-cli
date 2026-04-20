# 工作流技能：方案设计（design）

- canonical phase：`design`
- 触发条件：当 change 已完成需求澄清，且复杂度为中高、涉及架构取舍或涉及技术选型时触发。
- 借鉴来源：吸收 `oh-my-codex/ralplan` 的“先比较方案、再形成决策”的规划思想，但正式主权仍归 `specnfc` 的四主文档与门禁。

## 全局阶段顺序
- 唯一正式顺序：`clarify → design → plan → execute → verify → accept → archive`
- 未完成上游阶段，不得跳过进入下游阶段。
- 所有正式开发、验证、交付动作必须绑定当前 change / integration dossier。

## 前置条件
- `01-需求与方案.md` 已具备执行价值
- 当前 change 已触发独立技术设计
- 已读取当前 `change check / status / next-step` 输出

## 输入
- `specs/changes/<change-id>/01-需求与方案.md`
- 现有架构与边界约束
- 相关 integration 依赖
- 当前仓内既有模式与历史决策

## 输出
- 技术背景与约束明确
- 候选方案对比清楚
- 选型结论可复用、可交接
- 影响面与验证思路明确
- 标准 next-step 输出

## 工作方式：轻量 ralplan 化设计协议
本技能不是“直接写一个技术方案”，而是要求先做**方案比较 → 决策收敛 → 写回正式文档**。

### 每轮固定输出结构
1. `Round N`
2. `Target`
3. `Ambiguity`
4. 已确认
5. `Readiness Gates`
6. 当前推荐方案 / 仍缺什么决策
7. 本轮唯一关键问题
8. 本轮应写回章节

### 默认设计顺序
1. **触发说明与设计边界**
2. **候选方案对比**
3. **选型结论与决策边界**
4. **影响面与验证思路**

### Readiness Gates（最小闭合标准）
- `触发说明与设计边界`：说明为什么必须单独做技术设计、有哪些不可突破的边界
- `候选方案对比`：至少给出两个可行方案，并说明优缺点与适用条件
- `选型结论与决策边界`：明确最终选择、放弃其他方案的原因
- `影响面与验证思路`：说明影响哪些模块/接口/协作方，以及如何证明方案成立

### 必须出现的设计内容
- **Decision Drivers**：本次选型最重要的 2~3 个驱动因素
- **候选方案对比**：不能只写单一路径
- **当前推荐**：不是只罗列方案，必须形成推荐
- **验证思路**：说明后续要用什么测试/联调/观察指标证明设计成立

## 阶段门禁
### 必需文档
- `specs/changes/<change-id>/02-技术设计与选型.md`

### 必需 section
- 触发说明
- 技术背景与约束
- 候选方案对比
- 选型结论
- 影响面与验证思路

### 阻断条件
- `02-技术设计与选型.md` 仍是占位内容
- 候选方案对比缺失
- 选型结论未形成
- 验证思路缺失

### 完成判定
- `02-技术设计与选型.md` 已补齐关键 section
- `change check` 不再提示 `PLACEHOLDER_TECHNICAL_DESIGN`
- 已可进入 `03-任务计划与执行.md`

## 必须写入的正式文档
- `specs/changes/<change-id>/02-技术设计与选型.md`

## 本技能默认写回章节
- 触发说明
- 技术背景与约束
- 候选方案对比
- 选型结论
- 影响面与验证思路

## writeback 规则
- 队列：`.nfc/sync/pending-writeback.json`
- 历史：`.nfc/sync/writeback-history.json`
- 阶段退出前必须完成写回：是

## 运行时对象
- `.nfc/plans/active/`
- `.nfc/specs/scratch/`
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
7. 当前推荐方案 / 决策边界
8. 本轮关键问题
9. 本轮写回章节
10. 推荐下一步

## 治理模式差异
- advisory：提示为主，不直接阻断。
- guided：缺关键 section 时给出强提示。
- strict：`候选方案对比 / 选型结论 / 验证思路` 未闭合时软阻断进入 plan。
- locked：不得绕过当前阶段与正式 dossier。
