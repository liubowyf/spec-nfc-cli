import { createSuccessResult } from "../cli/output.mjs";
import {
  buildGovernanceInvalidSummaryItems,
  buildRepositoryContractHealthSummary,
  translateComplianceLevel,
  translateControlPlaneStatus,
  translateGenericStatus,
  translateGovernanceMode,
  translateProfile,
  translateProjectionStatus,
  translatePhase,
  translateRepositoryStatus,
  translateRuntimeSyncStatus,
  translateSkillPackStatus,
  translateStage
} from "../cli/contract-formatters.mjs";
import { resolveRepoRoot } from "../kernel/paths.mjs";
import { inspectStatus } from "../workflow/status.mjs";

export async function runStatus({ flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);
  const report = await inspectStatus({ repoRoot });
  const contractHealthSummary = buildRepositoryContractHealthSummary({
    initialized: report.repo?.initialized,
    controlPlane: report.repo?.controlPlane,
    compliance: report.repo?.compliance,
    currentPhase: report.repo?.nextStepProtocol?.currentPhase,
    recommendedFocus: report.next || []
  });

  return createSuccessResult({
    command: "status",
    cwd: repoRoot,
    data: {
      ...report,
      contractHealthSummary
    },
    human: {
      summary: `状态：${translateRepositoryStatus(report.status)}`,
      sections: [
        {
          title: "当前推进主链路",
          items: buildPrimaryActionItems(report.repo?.nextStepProtocol)
        },
        {
          title: "总结",
          items: [
            `仓库状态：${report.repo.initialized ? "已初始化" : "未初始化"}`,
            `活跃变更：${report.summary.activeChangeCount}`,
            `活跃对接：${report.summary.activeIntegrationCount ?? 0}`,
            `handoff 就绪：${report.summary.readiness?.handoffReadyChangeCount ?? 0}`,
            `发布阻塞：${report.summary.readiness?.releaseBlockerCount ?? 0}`,
            `最高优先事项：${report.summary.highestPriority}`
          ]
        },
        {
          title: "协议合同健康摘要",
          items: [
            `综合状态：${contractHealthSummary.overallStatus}`,
            `控制面状态：${contractHealthSummary.controlPlaneStatus}`,
            `合规等级：${contractHealthSummary.complianceLevel}`,
            `当前阶段：${contractHealthSummary.currentPhase}`,
            `写回状态：${contractHealthSummary.writebackStatus}`,
            `投影状态：${contractHealthSummary.projectionStatus}`,
            `技能包状态：${contractHealthSummary.skillPackStatus}`,
            `阻塞项：${contractHealthSummary.blockerCount}`,
            `提示项：${contractHealthSummary.advisoryCount}`,
            `建议聚焦：${contractHealthSummary.recommendedFocus.join("；") || "当前无"}`
          ]
        },
        {
          title: "就绪度摘要",
          items: [
            `受阻变更：${report.summary.readiness?.blockedChangeCount ?? 0}`,
            `被对接阻塞的变更：${report.summary.readiness?.changesBlockedByIntegrationCount ?? 0}`,
            `未就绪对接引用：${report.summary.readiness?.blockedIntegrationRefCount ?? 0}`,
            `已就绪对接：${report.summary.readiness?.readyIntegrationCount ?? 0}`,
            `仓级提示：${report.summary.readiness?.repositoryAdvisoryCount ?? 0}`,
            `项目记忆提示：${report.summary.projectMemoryAdvisoryCount ?? 0}`
          ]
        },
        {
          title: "治理对象摘要",
          items: report.repo.governanceRecords
            ? [
                `总记录数：${report.summary.governanceRecordCount ?? 0}`,
                `评审记录：${report.repo.governanceRecords.recordCounts?.review ?? 0}`,
                `审批记录：${report.repo.governanceRecords.recordCounts?.approval ?? 0}`,
                `验证记录：${report.repo.governanceRecords.recordCounts?.verification ?? 0}`,
                `豁免记录：${report.repo.governanceRecords.recordCounts?.waiver ?? 0}`,
                `发布决策：${report.repo.governanceRecords.recordCounts?.releaseDecision ?? 0}`,
                ...buildGovernanceInvalidSummaryItems(report.repo.governanceRecords)
              ]
            : ["当前无"]
        },
        {
          title: "治理注册中心",
          items: report.repo.governanceRegistries
            ? [
                `状态：${translateGenericStatus(report.repo.governanceRegistries.status)}`,
                `团队注册中心：${report.repo.governanceRegistries.teamRegistryCount ?? 0}`,
                `项目注册中心：${report.repo.governanceRegistries.projectRegistryCount ?? 0}`,
                `缺失文件：${report.repo.governanceRegistries.missingCount ?? 0}`,
                `无效文件：${report.repo.governanceRegistries.invalidCount ?? 0}`,
                `注册根目录：${report.repo.governanceRegistries.registryRoot}`
              ]
            : ["当前无"]
        },
        {
          title: "外部 Skills 导入物",
          items: report.repo.externalSkillImports
            ? [
                `状态：${translateGenericStatus(report.repo.externalSkillImports.status)}`,
                `总数：${report.repo.externalSkillImports.totalCount ?? 0}`,
                `无效导入：${report.repo.externalSkillImports.invalidCount ?? 0}`,
                `待回写：${report.repo.externalSkillImports.pendingWritebackCount ?? 0}`,
                `governed 待回写：${report.repo.externalSkillImports.governedPendingWritebackCount ?? 0}`,
                `保留期已过：${report.repo.externalSkillImports.expiredCount ?? 0}`,
                `安全违规：${report.repo.externalSkillImports.securityViolationCount ?? 0}`,
                `namespace：${report.repo.externalSkillImports.namespaces?.join("、") || "当前无"}`,
                `trust tier：${report.repo.externalSkillImports.trustTiers?.join("、") || "当前无"}`
              ]
            : ["当前无"]
        },
        {
          title: "运行时审计",
          items: report.repo.runtimeAudit
            ? [
                `状态：${translateGenericStatus(report.repo.runtimeAudit.status)}`,
                `当前阶段：${translateStage(report.repo.runtimeAudit.sessionTrace?.currentPhase)}`,
                `活跃锁数：${report.repo.runtimeAudit.sessionTrace?.activeLockCount ?? 0}`,
                `待回写：${report.repo.runtimeAudit.writeback?.pendingCount ?? 0}`,
                `写回历史：${report.repo.runtimeAudit.writeback?.historyCount ?? 0}`,
                `阶段决策：${report.summary.runtimeDecisionCount ?? 0}`,
                `证据引用：${report.summary.runtimeEvidenceRefCount ?? 0}`,
                `跟踪目标：${report.repo.runtimeAudit.runtimeLinks?.trackedTargetCount ?? 0}`,
                `运行时事件：${report.repo.runtimeAudit.eventStreams?.runtimeEventCount ?? 0}`
              ]
            : ["当前无"]
        },
        {
          title: "项目记忆摘要",
          items: report.repo.projectMemory
            ? [
                `状态：${translateGenericStatus(report.repo.projectMemory.status)}`,
                `入口索引：${translateGenericStatus(report.repo.projectMemory.entryIndex?.status ?? "unknown")}`,
                `仓级长期事实：${translateGenericStatus(report.repo.projectMemory.repositoryFacts?.status ?? "unknown")}`,
                `OpenCode 指令同步：${translateGenericStatus(report.repo.projectMemory.opencode?.status ?? "unknown")}`,
                `项目记忆提示数：${report.repo.projectMemory.advisoryCount ?? 0}`,
                `缺失长期事实：${report.repo.projectMemory.coverage?.repositoryFactMissingCount ?? 0}`,
                `占位长期事实：${report.repo.projectMemory.coverage?.repositoryFactPlaceholderCount ?? 0}`,
                `入口索引漂移：${report.repo.projectMemory.coverage?.entryFileDriftCount ?? 0}`
              ]
            : ["当前无"]
        },
        {
          title: "推荐阅读路径",
          items: report.readingPath?.length ? report.readingPath.map((item) => `先读 \`${item}\``) : ["当前无"]
        },
        {
          title: "仓库状态",
          items: [
            `仓库档位：${translateProfile(report.repo.profile)}`,
            `已启用模块：${report.repo.modules.join("、") || "当前无"}`
          ]
        },
        {
          title: "控制面",
          items: report.repo.controlPlane
            ? [
                `状态：${translateControlPlaneStatus(report.repo.controlPlane.status)}`,
                `仓级合同：${report.repo.controlPlane.repoContractPath}`,
                `治理模式：${translateGovernanceMode(report.repo.controlPlane.governanceMode)}`,
                `当前技能包：${report.repo.controlPlane.activeSkillPack}`,
                `入口投影状态：${translateProjectionStatus(report.repo.controlPlane.projectionStatus)}`,
                `投影检查数：${report.repo.controlPlane.projectionHealth?.checkedCount ?? 0}`,
                `投影漂移数：${report.repo.controlPlane.projectionHealth?.driftCount ?? 0}`,
                `投影缺失数：${report.repo.controlPlane.projectionHealth?.missingCount ?? 0}`,
                `技能包同步：${translateSkillPackStatus(report.repo.controlPlane.skillPackStatus)}`,
                `运行时同步：${translateRuntimeSyncStatus(report.repo.controlPlane.runtimeSyncStatus)}`,
                `治理注册中心：${translateGenericStatus(report.repo.controlPlane.governanceRegistryStatus)}`,
                `运行时审计：${translateGenericStatus(report.repo.controlPlane.runtimeAuditStatus)}`,
                `待回写文档：${report.repo.controlPlane.writebackTargets?.join("、") || "当前无"}`,
                `运行时账本：${report.repo.controlPlane.runtimeLedgerPath ?? "当前无"}`,
                `控制面缺失项：${report.repo.controlPlane.missingCount}`
              ]
            : ["当前无"]
        },
        {
          title: "合规摘要",
          items: report.repo.compliance
            ? [
                `等级：${translateComplianceLevel(report.repo.compliance.complianceLevel)}`,
                `阻塞数：${report.repo.compliance.blockingIssues.length}`,
                `提示数：${report.repo.compliance.advisoryIssues.length}`,
                `运行时写回：${translateRuntimeSyncStatus(report.repo.compliance.runtimeSyncStatus)}`
              ]
            : ["当前无"]
        },
        {
          title: "下一步协议",
          items: buildStepAwareProtocolItems(report.repo.nextStepProtocol)
        },
        {
          title: "对接总览",
          items: report.repo.integrations
            ? [
                `总数：${report.repo.integrations.total}`,
                `已就绪：${report.repo.integrations.ready ?? 0}`,
                `草稿中：${report.repo.integrations.draft}`,
                `已对齐：${report.repo.integrations.aligned}`,
                `实现中：${report.repo.integrations.implementing}`,
                `联调中：${report.repo.integrations.integrating}`,
                `已阻塞：${report.repo.integrations.blocked}`,
                `已完成：${report.repo.integrations.done}`,
                `未知状态：${report.repo.integrations.unknown}`,
                `受阻塞对接影响的变更：${report.repo.integrations.blockedAffectedChanges?.join("、") || "当前无"}`
              ]
            : ["当前无"]
        },
        {
          title: "依赖关系摘要",
          items: [
            `出现对接依赖的变更：${report.summary.relationships?.changesWithIntegrationsCount ?? 0}`,
            `总对接引用数：${report.summary.relationships?.totalIntegrationRefs ?? 0}`,
            `当前未就绪对接引用：${report.summary.relationships?.blockedIntegrationRefs?.join("、") || "当前无"}`
          ]
        },
        {
          title: "变更总览",
          items: report.changes.length
            ? report.changes.map(
                (change) =>
                  `${change.id}｜${change.title}｜${translateStage(change.stage)}｜成熟度：${change.maturity}｜交付：${change.delivery}｜对接阻塞：${change.integrations?.blocked?.length ?? 0}｜动作：${change.action}`
              )
            : ["当前无活跃变更"]
        },
        {
          title: "风险与阻塞",
          items: report.risks.length ? report.risks.map((item) => `${item.code}：${item.message}`) : ["当前无"]
        },
        {
          title: "仓级长期文档提示",
          items: report.repo.repositoryAdvisories?.length
            ? report.repo.repositoryAdvisories.map((item) => `${item.code}：${item.message}`)
            : ["当前无"]
        },
        {
          title: "项目记忆提示",
          items: report.repo.projectMemory?.advisories?.length
            ? report.repo.projectMemory.advisories.map((item) => `${item.code}：${item.message}`)
            : ["当前无"]
        }
      ]
    },
    warnings: [],
    next: report.next
  });
}

function buildPrimaryActionItems(protocol) {
  if (!protocol) {
    return ["当前无"];
  }

  const primaryAction = formatPrimaryAction(protocol.primaryAction);
  const items = [
    `当前阶段：${translatePhase(protocol.currentPhase)}`,
    `当前步骤：${protocol.stepLabel || protocol.step || "当前无"}`,
    `当前主动作：${primaryAction || "当前无"}`,
    `当前目标：${protocol.primaryGoal || "当前无"}`,
    `当前聚焦文档：${protocol.primaryDoc ? `\`${protocol.primaryDoc}\`` : "当前无"}`,
    `当前需补章节：${protocol.requiredSections?.join("、") || "当前无"}`,
    `当前不该做：${protocol.doNotDoYet?.join("；") || "当前无"}`,
    `完成条件：${protocol.exitCriteria?.join("；") || "当前无"}`,
    `完成后下一步：${protocol.afterPrimaryAction || "当前无"}`
  ];

  if (protocol.interviewRound != null) {
    items.push(`当前轮次：第 ${protocol.interviewRound} 轮`);
  }
  if (protocol.interviewTarget) {
    items.push(`当前聚焦：${protocol.interviewTarget}`);
  }
  if (typeof protocol.ambiguityPercent === "number") {
    items.push(`当前歧义：${protocol.ambiguityPercent}%`);
  }
  if ((protocol.focusQuestion || "").length) {
    items.push(`本轮关键问题：${protocol.focusQuestion}`);
  }

  return items;
}

function buildStepAwareProtocolItems(protocol) {
  if (!protocol) {
    return ["当前无"];
  }

  const items = [
    `当前阶段：${translatePhase(protocol.currentPhase)}`,
    `当前步骤：${protocol.stepLabel || protocol.step || "当前无"}`,
    `主动作：${formatPrimaryAction(protocol.primaryAction) || "当前无"}`,
    `当前文档：${protocol.primaryDoc ? `\`${protocol.primaryDoc}\`` : "当前无"}`,
    `已完成：${(protocol.completed || []).join("、") || "当前无"}`,
    `缺失：${(protocol.missing || []).join("、") || "当前无"}`,
    `阻断：${(protocol.blocking || []).join("、") || "当前无"}`
  ];

  if (protocol.interviewRound != null) {
    items.push(`当前轮次：第 ${protocol.interviewRound} 轮`);
  }
  if (protocol.interviewTarget) {
    items.push(`当前聚焦：${protocol.interviewTarget}`);
  }
  if (typeof protocol.ambiguityPercent === "number") {
    items.push(`当前歧义：${protocol.ambiguityPercent}%`);
  }
  if ((protocol.confirmedFacts || []).length) {
    items.push(`已确认：${protocol.confirmedFacts.join("；")}`);
  }
  if ((protocol.readinessGates || []).length) {
    items.push(
      `Readiness Gates：${protocol.readinessGates
        .map((item) => `${item.name || item.label || "当前无"}=${translateGateStatus(item.status)}`)
        .join("；")}`
    );
  }
  if ((protocol.writebackSections || []).length) {
    items.push(`本轮写回章节：${protocol.writebackSections.join("、")}`);
  }
  if (protocol.focusQuestion) {
    items.push(`本轮关键问题：${protocol.focusQuestion}`);
  }

  return items;
}

function formatPrimaryAction(action) {
  if (!action) {
    return null;
  }

  if (typeof action === "string") {
    return `运行 \`${action}\``;
  }

  if (action.value) {
    return `运行 \`${action.value}\``;
  }

  return null;
}

function translateGateStatus(status) {
  switch (status) {
    case "complete":
      return "已完成";
    case "focus":
      return "当前聚焦";
    case "pending":
      return "待补齐";
    case "blocked":
      return "阻断";
    default:
      return "未知";
  }
}
