import { createErrorResult, createSuccessResult } from "../cli/output.mjs";
import { isInitialized } from "../kernel/config.mjs";
import { resolveRepoRoot } from "../kernel/paths.mjs";
import { upgradeRepository } from "../kernel/upgrade.mjs";

export async function runUpgrade({ flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);

  if (!(await isInitialized(repoRoot))) {
    return createErrorResult({
      command: "upgrade",
      cwd: repoRoot,
      code: "NOT_INITIALIZED",
      message: "当前仓库尚未初始化，请先运行 `specnfc init`",
      next: ["运行 `specnfc init --with context,execution,governance`"]
    });
  }

  const result = await upgradeRepository({
    repoRoot,
    dryRun: Boolean(flags.dryRun)
  });

  const hasMaterialChange =
    result.managedFilesCreated.length > 0 ||
    result.managedFilesRefreshed.length > 0 ||
    result.changeFilesCreated.length > 0 ||
    result.updatedConfig.templateVersionChanged ||
    result.updatedConfig.changeStructureChanged;

  return createSuccessResult({
    command: "upgrade",
    cwd: repoRoot,
    data: result,
    human: {
      summary: flags.dryRun ? "已生成升级预览计划。" : hasMaterialChange ? "已完成仓模板升级。" : "当前仓已是最新模板。",
      sections: [
        {
          title: "支持范围评估",
          items: [
            `评估结果：${formatSupportLevel(result.supportAssessment?.level)}`,
            `结论：${result.supportAssessment?.summary ?? "当前无"}`
          ]
        },
        {
          title: "升级影响摘要",
          items: [
            `新建受管文件：${result.impactSummary?.managedFilesCreatedCount ?? 0}`,
            `刷新受管文件：${result.impactSummary?.managedFilesRefreshedCount ?? 0}`,
            `已纳入追踪文件：${result.impactSummary?.managedFilesTrackedCount ?? 0}`,
            `冲突文件：${result.impactSummary?.managedFilesConflictedCount ?? 0}`,
            `保护跳过文件：${result.impactSummary?.managedFilesSkippedCount ?? 0}`,
            `补齐 change 文件：${result.impactSummary?.changeFilesCreatedCount ?? 0}`,
            `.gitignore 已同步：${result.impactSummary?.gitignoreChanged ? "是" : "否"}`
          ]
        },
        {
          title: "版本信息",
          items: [`当前模板版本：${result.fromVersion}`, `目标模板版本：${result.toVersion}`]
        },
        {
          title: "版本迁移说明",
          items: result.migrationSummary?.notes?.length ? result.migrationSummary.notes : ["当前无"]
        },
        {
          title: "风险摘要",
          items: result.riskSummary?.length ? result.riskSummary.map((item) => `${item.code}（${item.level}）：${item.message}`) : ["当前无"]
        },
        {
          title: "需要人工补动作",
          items: result.manualActions?.length ? result.manualActions.map((item) => `${item.code}：${item.message}`) : ["当前无"]
        },
        {
          title: flags.dryRun ? "计划新建的受管文件" : "已新建的受管文件",
          items: result.managedFilesCreated.length ? result.managedFilesCreated : ["当前无"]
        },
        {
          title: flags.dryRun ? "计划刷新受管文件" : "已刷新受管文件",
          items: result.managedFilesRefreshed.length ? result.managedFilesRefreshed : ["当前无"]
        },
        {
          title: "已纳入追踪但未改写的文件",
          items: result.managedFilesTracked.length ? result.managedFilesTracked : ["当前无"]
        },
        {
          title: "需要人工处理的模板文件",
          items: result.managedFilesConflicted.length ? result.managedFilesConflicted : ["当前无"]
        },
        {
          title: "旧仓未纳入追踪而保守跳过的文件",
          items: result.managedFilesSkipped.length ? result.managedFilesSkipped : ["当前无"]
        },
        {
          title: flags.dryRun ? "计划补齐的 change 文件" : "已补齐的 change 文件",
          items: result.changeFilesCreated.length ? result.changeFilesCreated : ["当前无"]
        },
        {
          title: "配置更新",
          items: [
            `模板版本已更新：${result.updatedConfig.templateVersionChanged ? "是" : "否"}`,
            `change 结构已更新：${result.updatedConfig.changeStructureChanged ? "是" : "否"}`
          ]
        },
        {
          title: "受管文件差异预览",
          items: buildDiffPreviewItems(result.managedFileDiffs),
          preformatted: true
        }
      ]
    },
    warnings: [...result.skippedChanges],
    next: buildUpgradeNext(result, { dryRun: Boolean(flags.dryRun) })
  });
}

function buildDiffPreviewItems(diffs) {
  const groups = [
    ["created", "新建"],
    ["refreshed", "刷新"],
    ["conflicted", "冲突"],
    ["skipped", "跳过"]
  ];
  const lines = [];

  for (const [key, label] of groups) {
    const items = diffs?.[key] || [];
    if (!items.length) {
      continue;
    }
    lines.push(`${label}:`);
    for (const item of items.slice(0, 3)) {
      lines.push(`- ${item.target} (+${item.diff.addedCount} / -${item.diff.removedCount})`);
      const unifiedLines = (item.diff.unified || "")
        .split("\n")
        .filter(Boolean)
        .slice(0, 8);
      const detailLines = unifiedLines.length ? unifiedLines : item.diff.preview.slice(0, 6);
      for (const previewLine of detailLines) {
        lines.push(`  ${previewLine}`);
      }
    }
  }

  return lines.length ? lines : ["当前无"];
}

function buildUpgradeNext(result, { dryRun }) {
  const next = [];

  for (const action of result.manualActions || []) {
    if (action.command) {
      next.push(`执行 \`${action.command}\``);
    }
  }

  if (dryRun) {
    next.push("确认预览结果后执行 `specnfc upgrade`");
  } else {
    next.push("运行 `specnfc change list` 检查现有 change 的成熟度");
  }

  return Array.from(new Set(next));
}

function formatSupportLevel(level) {
  switch (level) {
    case "supported":
      return "支持自动升级";
    case "supported_with_manual_review":
      return "支持自动升级，但需人工复核";
    case "out_of_scope":
      return "超出安全升级范围";
    default:
      return "未评估";
  }
}
