import { createErrorResult, createSuccessResult } from "../cli/output.mjs";
import {
  buildGovernanceInvalidSummaryItems,
  buildNextStepProtocolItems,
  buildRepositoryContractHealthSummary,
  translateComplianceLevel,
  translateControlPlaneStatus,
  translateGenericStatus,
  translateGovernanceMode,
  translateProfile,
  translateProjectionStatus,
  translateReleaseReadinessStatus,
  translateRuntimeSyncStatus,
  translateScope,
  translateSkillPackStatus,
  translateStage
} from "../cli/contract-formatters.mjs";
import { resolveRepoRoot } from "../kernel/paths.mjs";
import { inspectRepository } from "../kernel/scaffold.mjs";
import { inspectStatus } from "../workflow/status.mjs";

export async function runDoctor({ flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);
  const report = await inspectRepository(repoRoot);

  if (!report.initialized) {
    return createErrorResult({
      command: "doctor",
      cwd: repoRoot,
      code: "NOT_INITIALIZED",
      message: "当前仓库尚未初始化",
      next: ["运行 `specnfc init --with context,execution,governance`"]
    });
  }

  const nextStepProtocol = await resolveDoctorNextStepProtocol({
    repoRoot,
    fallback: report.nextStepProtocol
  });
  const contractHealthSummary = buildRepositoryContractHealthSummary({
    controlPlane: report.controlPlane,
    compliance: report.compliance,
    currentPhase: nextStepProtocol?.currentPhase,
    recommendedFocus: report.compliance?.recommendedActions || []
  });
  const next = buildDoctorNext(report);

  return createSuccessResult({
    command: "doctor",
    cwd: repoRoot,
    data: {
      ...report,
      nextStepProtocol,
      contractHealthSummary
    },
    human: {
      summary:
        report.risks.length ||
        report.missing.length ||
        report.compliance?.blockingIssues?.length ||
        report.compliance?.advisoryIssues?.length
          ? "当前仓库存在需处理项。"
          : "当前仓库状态正常。",
      sections: [
        {
          title: "仓库概览",
          items: [
            `仓库档位：${translateProfile(report.profile)}`,
            `已安装模块：${report.installedModules.join("、") || "当前无"}`,
            `进行中变更：${report.changes?.active ?? 0}`,
            `已归档变更：${report.changes?.archived ?? 0}`
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
          title: "控制面",
          items: report.controlPlane
            ? [
                `状态：${translateControlPlaneStatus(report.controlPlane.status)}`,
                `仓级合同：${report.controlPlane.repoContractPath}`,
                `治理模式：${translateGovernanceMode(report.controlPlane.governanceMode)}`,
                `当前技能包：${report.controlPlane.activeSkillPack}`,
                `入口投影状态：${translateProjectionStatus(report.controlPlane.projectionStatus)}`,
                `投影检查数：${report.controlPlane.projectionHealth?.checkedCount ?? 0}`,
                `投影漂移数：${report.controlPlane.projectionHealth?.driftCount ?? 0}`,
                `投影缺失数：${report.controlPlane.projectionHealth?.missingCount ?? 0}`,
                `技能包同步：${translateSkillPackStatus(report.controlPlane.skillPackStatus)}`,
                `运行时同步：${translateRuntimeSyncStatus(report.controlPlane.runtimeSyncStatus)}`,
                `治理注册中心：${translateGenericStatus(report.controlPlane.governanceRegistryStatus)}`,
                `运行时审计：${translateGenericStatus(report.controlPlane.runtimeAuditStatus)}`,
                `待回写文档：${report.controlPlane.writebackTargets?.join("、") || "当前无"}`,
                `运行时账本：${report.controlPlane.runtimeLedgerPath ?? "当前无"}`,
                `控制面缺失项：${report.controlPlane.missingCount}`
              ]
            : ["当前无"]
        },
        {
          title: "合规摘要",
          items: report.compliance
            ? [
                `等级：${translateComplianceLevel(report.compliance.complianceLevel)}`,
                `阻塞数：${report.compliance.blockingIssues.length}`,
                `提示数：${report.compliance.advisoryIssues.length}`,
                `运行时写回：${translateRuntimeSyncStatus(report.compliance.runtimeSyncStatus)}`
              ]
            : ["当前无"]
        },
        {
          title: "豁免摘要",
          items: report.compliance?.waivers
            ? [
                `状态：${formatWaiverStatus(report.compliance.waivers.status)}`,
                `总数：${report.compliance.waivers.totalCount ?? 0}`,
                `有效：${report.compliance.waivers.validCount ?? 0}`,
                `过期：${report.compliance.waivers.expiredCount ?? 0}`,
                `无效：${report.compliance.waivers.invalidCount ?? 0}`,
                `已覆盖问题：${report.compliance.waivers.appliedIssueCodes?.join("、") || "当前无"}`
              ]
            : ["当前无"]
        },
        {
          title: "治理对象摘要",
          items: report.governanceRecords
            ? [
                `状态：${translateGenericStatus(report.governanceRecords.status)}`,
                `总记录数：${report.governanceRecords.recordCounts?.total ?? 0}`,
                `评审记录：${report.governanceRecords.recordCounts?.review ?? 0}`,
                `审批记录：${report.governanceRecords.recordCounts?.approval ?? 0}`,
                `验证记录：${report.governanceRecords.recordCounts?.verification ?? 0}`,
                `豁免记录：${report.governanceRecords.recordCounts?.waiver ?? 0}`,
                `发布决策：${report.governanceRecords.recordCounts?.releaseDecision ?? 0}`,
                `治理目标数：${report.governanceRecords.targetSummaries?.length ?? 0}`,
                ...buildGovernanceInvalidSummaryItems(report.governanceRecords)
              ]
            : ["当前无"]
        },
        {
          title: "治理注册中心",
          items: report.governanceRegistries
            ? [
                `状态：${translateGenericStatus(report.governanceRegistries.status)}`,
                `团队注册中心：${report.governanceRegistries.teamRegistryCount ?? 0}`,
                `项目注册中心：${report.governanceRegistries.projectRegistryCount ?? 0}`,
                `缺失文件：${report.governanceRegistries.missingCount ?? 0}`,
                `无效文件：${report.governanceRegistries.invalidCount ?? 0}`,
                `注册根目录：${report.governanceRegistries.registryRoot}`
              ]
            : ["当前无"]
        },
        {
          title: "外部 Skills 导入物",
          items: report.externalSkillImports
            ? [
                `状态：${translateGenericStatus(report.externalSkillImports.status)}`,
                `总数：${report.externalSkillImports.totalCount ?? 0}`,
                `无效导入：${report.externalSkillImports.invalidCount ?? 0}`,
                `待回写：${report.externalSkillImports.pendingWritebackCount ?? 0}`,
                `governed 待回写：${report.externalSkillImports.governedPendingWritebackCount ?? 0}`,
                `保留期已过：${report.externalSkillImports.expiredCount ?? 0}`,
                `安全违规：${report.externalSkillImports.securityViolationCount ?? 0}`,
                `namespace：${report.externalSkillImports.namespaces?.join("、") || "当前无"}`,
                `trust tier：${report.externalSkillImports.trustTiers?.join("、") || "当前无"}`
              ]
            : ["当前无"]
        },
        {
          title: "运行时审计",
          items: report.runtimeAudit
            ? [
                `状态：${translateGenericStatus(report.runtimeAudit.status)}`,
                `当前阶段：${translateStage(report.runtimeAudit.sessionTrace?.currentPhase)}`,
                `活跃锁数：${report.runtimeAudit.sessionTrace?.activeLockCount ?? 0}`,
                `待回写：${report.runtimeAudit.writeback?.pendingCount ?? 0}`,
                `写回历史：${report.runtimeAudit.writeback?.historyCount ?? 0}`,
                `阶段决策：${report.runtimeAudit.stageDecisions?.decisionCount ?? 0}`,
                `证据引用：${report.runtimeAudit.evidenceRefs?.totalRefs ?? 0}`,
                `跟踪目标：${report.runtimeAudit.runtimeLinks?.trackedTargetCount ?? 0}`,
                `运行时事件：${report.runtimeAudit.eventStreams?.runtimeEventCount ?? 0}`
              ]
            : ["当前无"]
        },
        {
          title: "下一步协议",
          items: buildNextStepProtocolItems(nextStepProtocol)
        },
        {
          title: "交付概览",
          items: report.changes?.delivery?.enabled
            ? [
                `启用交付的变更：${report.changes.delivery.enabled}`,
                `交付文件已生成：${report.changes.delivery.prepared}`,
                `交付状态已同步：${report.changes.delivery.ready}`,
                `已归档：${report.changes.delivery.archived}`,
                `缺少交付文件：${report.changes.delivery.missing}`,
                `交付状态未同步：${report.changes.delivery.out_of_sync}`
              ]
            : ["当前无启用交付的变更"]
        },
        {
          title: "规格成熟度概览",
          items: report.changes?.maturity
            ? [
                `可实现：${report.changes.maturity.ready}`,
                `待补规格：${report.changes.maturity.draft}`,
                `待补细节：${report.changes.maturity.incomplete}`,
                `实现中：${report.changes.maturity.implementation}`,
                `可交接：${report.changes.maturity.handoff}`,
                `已归档：${report.changes.maturity.archived}`,
                `异常：${report.changes.maturity.broken}`
              ]
            : ["当前无"]
        },
        {
          title: "关键规格缺口",
          items: report.changes?.maturity?.gapSummary && Object.keys(report.changes.maturity.gapSummary).length
            ? Object.entries(report.changes.maturity.gapSummary).map(([code, count]) => `${code}：${count}`)
            : ["当前无"]
        },
        {
          title: "优先处理变更",
          items: report.changes?.maturity?.priority?.length
            ? report.changes.maturity.priority.map((item) => `${item.id}｜${translateStage(item.status)}｜${item.action}`)
            : ["当前无"]
        },
        {
          title: "对接总览",
          items: report.integrations
            ? [
                `总数：${report.integrations.total}`,
                `已就绪：${report.integrations.ready ?? 0}`,
                `草稿中：${report.integrations.draft}`,
                `已对齐：${report.integrations.aligned}`,
                `实现中：${report.integrations.implementing}`,
                `联调中：${report.integrations.integrating}`,
                `已阻塞：${report.integrations.blocked}`,
                `已完成：${report.integrations.done}`,
                `未知状态：${report.integrations.unknown}`,
                `受阻塞对接影响的变更：${report.integrations.blockedAffectedChanges?.join("、") || "当前无"}`
              ]
            : ["当前无"]
        },
        {
          title: "发布就绪度",
          items: report.releaseReadiness
            ? [
                `状态：${translateReleaseReadinessStatus(report.releaseReadiness.status)}`,
                `handoff 就绪变更：${report.releaseReadiness.handoffReadyChangeCount}`,
                `阻塞变更：${report.releaseReadiness.blockedChangeCount}`,
                `阻塞对接引用：${report.releaseReadiness.blockedIntegrationRefCount}`,
                `仓级风险：${report.releaseReadiness.repositoryRiskCount}`,
                `总阻塞数：${report.releaseReadiness.blockerCount}`
              ]
            : ["当前无"]
        },
        {
          title: "对接依赖摘要",
          items: report.integrationDependencies
            ? [
                `存在对接依赖的变更：${report.integrationDependencies.changesWithRefsCount}`,
                `总对接引用数：${report.integrationDependencies.totalRefs}`,
                `当前未就绪对接引用：${report.integrationDependencies.blockedIntegrationRefs.join("、") || "当前无"}`,
                `被对接阻塞的变更：${report.integrationDependencies.changesBlockedByIntegration.join("、") || "当前无"}`
              ]
            : ["当前无"]
        },
        {
          title: "交付阻塞项",
          items: report.changes?.delivery?.blocked?.length
            ? report.changes.delivery.blocked.map((item) => `${item.id}：${item.action}`)
            : ["当前无"]
        },
        {
          title: "规格阻塞项",
          items: report.changes?.maturity?.blocked?.length
            ? report.changes.maturity.blocked.map((item) => `${item.id}：${item.action}`)
            : ["当前无"]
        },
        {
          title: "当前生效规则",
          items: report.runtimeRules
            ? [
                `规则文件：${report.runtimeRules.path}`,
                `已启用模块：${report.runtimeRules.enabledModules.join("、") || "当前无"}`,
                `阻断范围：${(report.runtimeRules.blockingScopes || []).map(translateScope).join("、") || "当前无"}`,
                `提示范围：${(report.runtimeRules.advisoryScopes || []).map(translateScope).join("、") || "当前无"}`
              ]
            : ["当前无"]
        },
        {
          title: "仓级长期文档提示",
          items: report.repositoryAdvisories?.length
            ? report.repositoryAdvisories.map((item) => `${item.code}：${item.message}`)
            : ["当前无"]
        },
        {
          title: "项目层索引摘要",
          items: report.projectIndex
            ? [
                `状态：${translateGenericStatus(report.projectIndex.status)}`,
                `索引文件：${report.projectIndex.indexPath}`,
                `汇总文档：${report.projectIndex.summaryPath}`,
                `团队级上下文引用：${report.projectIndex.teamContextRefCount ?? 0}`,
                `change 引用：${report.projectIndex.changeRefCount ?? 0}`,
                `integration 引用：${report.projectIndex.integrationRefCount ?? 0}`,
                `最近迭代条目：${report.projectIndex.latestIterationCount ?? 0}`,
                `提示数：${report.projectIndex.advisoryCount ?? 0}`
              ]
            : ["当前无"]
        },
        {
          title: "项目层索引提示",
          items: report.projectIndex?.advisories?.length
            ? report.projectIndex.advisories.map((item) => `${item.code}：${item.message}`)
            : ["当前无"]
        },
        {
          title: "项目记忆摘要",
          items: report.projectMemory
            ? [
                `状态：${translateGenericStatus(report.projectMemory.status)}`,
                `入口索引：${translateGenericStatus(report.projectMemory.entryIndex?.status ?? "unknown")}`,
                `仓级长期事实：${translateGenericStatus(report.projectMemory.repositoryFacts?.status ?? "unknown")}`,
                `OpenCode 指令同步：${translateGenericStatus(report.projectMemory.opencode?.status ?? "unknown")}`,
                `提示数：${report.projectMemory.advisoryCount ?? 0}`,
                `缺失长期事实：${report.projectMemory.coverage?.repositoryFactMissingCount ?? 0}`,
                `占位长期事实：${report.projectMemory.coverage?.repositoryFactPlaceholderCount ?? 0}`,
                `入口索引缺失：${report.projectMemory.coverage?.entryFileMissingCount ?? 0}`,
                `入口索引漂移：${report.projectMemory.coverage?.entryFileDriftCount ?? 0}`
              ]
            : ["当前无"]
        },
        {
          title: "项目记忆提示",
          items: report.projectMemory?.advisories?.length
            ? report.projectMemory.advisories.map((item) => `${item.code}：${item.message}`)
            : ["当前无"]
        },
        {
          title: "对接阻塞项",
          items: report.integrations?.blockedItems?.length
            ? report.integrations.blockedItems.map((item) => `${item.id}｜${translateStage(item.status)}｜影响变更：${item.changes?.join("、") || "当前无"}｜${item.action}`)
            : ["当前无"]
        },
        {
          title: "正常项",
          items: report.healthy.length ? report.healthy : ["当前无"]
        },
        {
          title: "缺失项",
          items: report.missing.length ? report.missing : ["当前无"]
        },
        {
          title: "风险项",
          items: report.risks.length ? report.risks.map((item) => `${item.code}：${item.message}`) : ["当前无"]
        }
      ]
    },
    warnings: [],
    next
  });
}

async function resolveDoctorNextStepProtocol({ repoRoot, fallback }) {
  try {
    const statusReport = await inspectStatus({ repoRoot });
    return statusReport.repo?.nextStepProtocol ?? fallback ?? null;
  } catch {
    return fallback ?? null;
  }
}

function buildDoctorNext(report) {
  const next = [...(report.compliance?.recommendedActions || [])];

  if (report.missing.length) {
    next.push("根据缺失项补装模块或修复目录漂移");
  }

  if (report.changes?.delivery?.blocked?.length) {
    for (const item of report.changes.delivery.blocked) {
      next.push(`${item.id}：${item.action}`);
    }
  }

  if (report.changes?.maturity?.blocked?.length) {
    for (const item of report.changes.maturity.blocked) {
      next.push(`${item.id}：${item.action}`);
    }
  }

  if (report.risks.length) {
    next.push("修复风险项后重新运行 `specnfc doctor`");
  }

  if (report.integrations?.blockedItems?.length) {
    next.push("运行 `specnfc integration check` 检查并解除对接阻塞");
  }

  if (report.repositoryAdvisories?.length) {
    next.push("补齐仓级长期文档后重新运行 `specnfc doctor`");
  }

  if (report.projectMemory?.advisories?.length) {
    next.push("补齐项目记忆索引与关键事实文档后重新运行 `specnfc doctor`");
  }

  if (report.projectIndex?.advisories?.length) {
    next.push("补齐 `project-index.json` 与 `specs/project/summary.md` 后重新运行 `specnfc doctor`");
  }

  if (report.governanceRecords?.invalidRecords?.length) {
    next.push("修复治理记录 JSON 或 target 引用后重新运行 `specnfc doctor`");
  }

  if (report.governanceRegistries?.advisoryCount) {
    next.push("补齐 `.specnfc/governance/registries/` 下的团队 / 项目注册中心文件后重新运行 `specnfc doctor`");
  }

  return Array.from(new Set(next));
}

function formatWaiverStatus(status) {
  switch (status) {
    case "active":
      return "生效中";
    case "attention":
      return "需处理";
    case "clean":
      return "当前无";
    default:
      return status || "未知";
  }
}
