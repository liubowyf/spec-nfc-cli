export function buildRepositoryContractHealthSummary({
  initialized = true,
  controlPlane,
  compliance,
  currentPhase,
  recommendedFocus = [],
  uninitializedLabel = "未初始化"
}) {
  const blockerCount = compliance?.blockingIssues?.length ?? 0;
  const advisoryCount = compliance?.advisoryIssues?.length ?? 0;
  const overallStatus = !initialized ? uninitializedLabel : blockerCount ? "存在阻塞" : advisoryCount ? "需关注" : "健康";

  return {
    overallStatus,
    controlPlaneStatus: initialized ? translateControlPlaneStatus(controlPlane?.status) : uninitializedLabel,
    complianceLevel: initialized ? translateComplianceLevel(compliance?.complianceLevel) : uninitializedLabel,
    currentPhase: initialized ? translatePhase(currentPhase) : uninitializedLabel,
    writebackStatus: initialized ? translateWritebackStatus(controlPlane) : uninitializedLabel,
    projectionStatus: initialized ? translateProjectionStatus(controlPlane?.projectionStatus) : uninitializedLabel,
    skillPackStatus: initialized ? translateSkillPackStatus(controlPlane?.skillPackStatus) : uninitializedLabel,
    blockerCount,
    advisoryCount,
    recommendedFocus: recommendedFocus.slice(0, 3),
    generatedAt: compliance?.generatedAt ?? new Date().toISOString()
  };
}

export function buildWorkflowContractHealthSummary({
  blockerCount = 0,
  advisoryCount = 0,
  currentPhase,
  writebackCount = 0,
  recommendedFocus = [],
  projectionDrift = false,
  skillPackDrift = false,
  generatedAt,
  controlPlaneStatus = "规则已加载"
}) {
  return {
    overallStatus: blockerCount ? "存在阻塞" : advisoryCount ? "需关注" : "健康",
    controlPlaneStatus,
    complianceLevel: blockerCount ? "阻塞" : advisoryCount ? "提示" : "健康",
    currentPhase: translatePhase(currentPhase),
    writebackStatus: writebackCount ? `待回写（${writebackCount} 项）` : "已同步",
    projectionStatus: projectionDrift ? "存在漂移" : "已同步",
    skillPackStatus: skillPackDrift ? "存在漂移" : "已同步",
    blockerCount,
    advisoryCount,
    recommendedFocus: recommendedFocus.slice(0, 3),
    generatedAt: generatedAt ?? new Date().toISOString()
  };
}

export function buildGovernanceInvalidSummaryItems(governance) {
  if (!governance) {
    return ["当前无"];
  }

  const invalidCount = governance.invalidCount ?? governance.invalidRecords?.length ?? 0;
  if (!invalidCount) {
    return ["无效记录：0"];
  }

  const byReason = Object.entries(governance.invalidSummary?.byReason || {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => `${translateGovernanceInvalidReason(reason)}=${count}`);
  const byType = Object.entries(governance.invalidSummary?.byType || {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([type, count]) => `${translateGovernanceRecordType(type)}=${count}`);
  const samples = (governance.invalidSummary?.samples || []).map((item) => {
    const parts = [item.file, translateGovernanceInvalidReason(item.reason), translateGovernanceRecordType(item.type)];
    return parts.filter(Boolean).join("｜");
  });

  return [
    `无效记录：${invalidCount}`,
    `无效原因：${byReason.join("、") || "当前无"}`,
    `无效类型：${byType.join("、") || "当前无"}`,
    `样本：${samples.join("；") || "当前无"}`
  ];
}

export function formatGovernanceInlineSummary(governance) {
  if (!governance) {
    return "无效：0";
  }

  const invalidCount = governance.invalidCount ?? governance.invalidRecords?.length ?? 0;
  if (!invalidCount) {
    return "无效：0";
  }

  const byReason = Object.entries(governance.invalidSummary?.byReason || {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => `${translateGovernanceInvalidReason(reason)}×${count}`)
    .join("、");

  return `无效：${invalidCount}（${byReason || "当前无"}）`;
}

export function buildNextStepProtocolItems(protocol) {
  if (!protocol) {
    return ["当前无"];
  }

  const items = [
    `当前阶段：${translatePhase(protocol.currentPhase)}`
  ];

  if (protocol.step) {
    if (typeof protocol.step === "number") {
      items.push(`当前步骤：第 ${protocol.step} 步｜${protocol.stepLabel || "当前无"}`);
    } else {
      items.push(`当前步骤：${protocol.stepLabel || protocol.step}`);
    }
  } else if (protocol.stepLabel) {
    items.push(`当前步骤：${protocol.stepLabel}`);
  }

  if (protocol.primaryAction) {
    items.push(`当前主动作：${translateProtocolAction(protocol.primaryAction)}`);
  }

  if (protocol.primaryGoal) {
    items.push(`当前目标：${translateProtocolText(protocol.primaryGoal)}`);
  }

  if (protocol.primaryDoc) {
    items.push(`当前文档：${translateProtocolText(protocol.primaryDoc)}`);
  }

  if ((protocol.requiredSections || []).length) {
    items.push(`当前需补章节：${protocol.requiredSections.map(translateProtocolText).join("、")}`);
  }

  if ((protocol.doNotDoYet || []).length) {
    items.push(`当前不该做：${protocol.doNotDoYet.map(translateProtocolText).join("、")}`);
  }

  if ((protocol.exitCriteria || []).length) {
    items.push(`完成条件：${protocol.exitCriteria.map(translateProtocolText).join("、")}`);
  }

  if (protocol.afterPrimaryAction) {
    items.push(`完成后下一步：${translateProtocolText(protocol.afterPrimaryAction)}`);
  }

  if (protocol.interviewRound != null) {
    items.push(`当前轮次：第 ${protocol.interviewRound} 轮`);
  }

  if (protocol.interviewTarget) {
    items.push(`当前聚焦：${translateProtocolText(protocol.interviewTarget)}`);
  }

  if (typeof protocol.ambiguityPercent === "number") {
    items.push(`当前歧义：${protocol.ambiguityPercent}%`);
  }

  if ((protocol.confirmedFacts || []).length) {
    items.push(`已确认：${protocol.confirmedFacts.map(translateProtocolText).join("、")}`);
  }

  if ((protocol.readinessGates || []).length) {
    items.push(
      `Readiness Gates：${protocol.readinessGates
        .map((item) => formatReadinessGate(item))
        .join("、")}`
    );
  }

  if (protocol.focusQuestion) {
    items.push(`本轮关键问题：${translateProtocolText(protocol.focusQuestion)}`);
  }

  if ((protocol.writebackSections || []).length) {
    items.push(`本轮写回章节：${protocol.writebackSections.map(translateProtocolText).join("、")}`);
  }

  items.push(`已完成：${(protocol.completed || []).map(translateProtocolText).join("、") || "当前无"}`);
  items.push(`缺失：${(protocol.missing || []).map(translateProtocolText).join("、") || "当前无"}`);
  items.push(`阻断：${(protocol.blocking || []).map(translateProtocolText).join("、") || "当前无"}`);

  return items;
}

export function translateRepositoryStatus(value) {
  return translateValue(value, {
    not_initialized: "未初始化",
    healthy_idle: "健康空闲",
    in_progress: "推进中",
    ready_for_handoff: "待交接",
    attention_needed: "需关注"
  });
}

export function translateProfile(value) {
  return translateValue(value, {
    enterprise: "企业级",
    standard: "标准",
    minimal: "最小"
  });
}

export function translateControlPlaneStatus(value) {
  return translateValue(value, {
    complete: "完整",
    partial: "部分完整",
    missing: "缺失",
    unknown: "未知"
  });
}

export function translateGovernanceMode(value) {
  return translateValue(value, {
    advisory: "提示模式",
    guided: "引导模式",
    strict: "严格模式",
    locked: "锁定模式",
    unknown: "未知"
  });
}

export function translateProjectionStatus(value) {
  return translateValue(value, {
    synced: "已同步",
    drifted: "存在漂移",
    missing: "缺失",
    unknown: "未知"
  });
}

export function translateSkillPackStatus(value) {
  return translateValue(value, {
    synced: "已同步",
    missing: "缺失",
    drifted: "存在漂移",
    stale: "版本滞后",
    unknown: "未知"
  });
}

export function translateComplianceLevel(value) {
  return translateValue(value, {
    clean: "健康",
    advisory: "提示",
    blocking: "阻塞",
    unknown: "未知"
  });
}

export function translateRuntimeSyncStatus(value) {
  return translateValue(value, {
    synced: "已同步",
    pending: "待回写",
    invalid: "已损坏",
    clean: "已同步",
    unknown: "未知"
  });
}

export function translateWritebackStatus(controlPlane) {
  if (!controlPlane) {
    return "当前无";
  }
  if ((controlPlane.writebackTargets?.length ?? 0) > 0 || controlPlane.runtimeSyncStatus === "pending") {
    return `待回写（${controlPlane.writebackTargets?.length ?? 0} 份文档）`;
  }
  return "已同步";
}

export function translateReleaseReadinessStatus(value) {
  return translateValue(value, {
    ready: "可发布",
    blocked: "存在阻塞",
    attention_needed: "需关注",
    unknown: "未知"
  });
}

export function translatePhase(value) {
  return translateValue(value, {
    clarify: "需求澄清",
    design: "方案设计",
    plan: "任务规划",
    execute: "执行落地",
    verify: "验证验收",
    accept: "交付验收",
    archive: "归档冻结",
    unknown: "未知"
  });
}

export function translateStage(value) {
  return translateValue(value, {
    draft: "草稿",
    design: "设计中",
    ready: "可执行",
    "in-progress": "执行中",
    verifying: "验证中",
    handoff: "待交接",
    archived: "已归档",
    aligned: "已对齐",
    implementing: "实现中",
    integrating: "联调中",
    blocked: "已阻塞",
    done: "已完成",
    unknown: "未知"
  });
}

export function translateScope(value) {
  return translateValue(value, {
    repository: "仓库",
    change: "变更",
    integration: "对接",
    project: "项目",
    runtime: "运行时",
    delivery: "交付",
    execution: "执行",
    governance: "治理",
    quality: "质量",
    context: "上下文"
  });
}

export function translateGenericStatus(value) {
  return translateValue(value, {
    complete: "完整",
    partial: "部分完整",
    missing: "缺失",
    synced: "已同步",
    pending: "待处理",
    clean: "已同步",
    tracked: "已跟踪",
    empty: "空白",
    attention: "需关注",
    unknown: "未知"
  });
}

export function translateGovernanceRecordType(value) {
  return translateValue(value, {
    review: "评审",
    approval: "审批",
    verification: "验证",
    waiver: "豁免",
    releaseDecision: "发布决策",
    unknown: "未知"
  });
}

export function translateGovernanceInvalidReason(value) {
  return translateValue(value, {
    JSON_PARSE_FAILED: "JSON 解析失败",
    SCOPE_MISMATCH: "scope 不匹配",
    TARGET_MISMATCH: "target 不匹配",
    MISSING_RELATED_RECORD_REF: "关联记录引用缺失",
    UNKNOWN: "未知原因"
  });
}

export function translateProtocolAction(action) {
  if (!action) {
    return "当前无";
  }

  if (typeof action === "string") {
    return translateProtocolText(action);
  }

  if (action.type && action.value) {
    return `${action.type}：${translateProtocolText(action.value)}`;
  }

  if (action.value) {
    return translateProtocolText(action.value);
  }

  return "当前无";
}

function translateProtocolText(value) {
  if (value == null || value === "") {
    return "当前无";
  }

  let result = String(value);
  const replacements = [
    ["control plane", "控制面"],
    ["active change", "活跃变更"],
    ["repo protocol initialized", "仓级协议已初始化"],
    ["当前处于 clarify", "当前处于 需求澄清"],
    ["当前处于 design", "当前处于 方案设计"],
    ["当前处于 plan", "当前处于 任务规划"],
    ["当前处于 execute", "当前处于 执行落地"],
    ["当前处于 verify", "当前处于 验证验收"],
    ["当前处于 accept", "当前处于 交付验收"],
    ["当前处于 archive", "当前处于 归档冻结"],
    ["已绑定到阶段 clarify", "已绑定到阶段 需求澄清"],
    ["已绑定到阶段 design", "已绑定到阶段 方案设计"],
    ["已绑定到阶段 plan", "已绑定到阶段 任务规划"],
    ["已绑定到阶段 execute", "已绑定到阶段 执行落地"],
    ["已绑定到阶段 verify", "已绑定到阶段 验证验收"],
    ["已绑定到阶段 accept", "已绑定到阶段 交付验收"],
    ["已绑定到阶段 archive", "已绑定到阶段 归档冻结"]
  ];

  for (const [from, to] of replacements) {
    result = result.replaceAll(from, to);
  }

  return result;
}

function formatReadinessGate(item) {
  if (typeof item === "string") {
    return translateProtocolText(item);
  }

  if (!item || typeof item !== "object") {
    return "当前无";
  }

  const label = translateProtocolText(item.name || item.label || "当前无");
  const status = translateReadinessGateStatus(item.status);
  return `${label}=${status}`;
}

function translateReadinessGateStatus(value) {
  return translateValue(value, {
    complete: "已完成",
    focus: "当前聚焦",
    pending: "待补齐",
    blocked: "阻断",
    unknown: "未知"
  });
}

export function translateValue(value, mapping) {
  if (value == null || value === "") {
    return "当前无";
  }
  return mapping[value] ?? String(value);
}
