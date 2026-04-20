import path from "node:path";
import { getPackageMeta } from "./meta.mjs";
import { loadConfig, saveConfig } from "./config.mjs";
import { ensureSpecnfcGitignore } from "./gitignore.mjs";
import { getManagedFileHashes, hashManagedContent, trackManagedFiles } from "./managed-files.mjs";
import { PROJECT_ROOT, getRepoPaths, resolvePathWithin } from "./paths.mjs";
import { inspectRepository, loadManifest, refreshProtocolPlaneFiles } from "./scaffold.mjs";
import { updateRepositoryIndexes } from "./indexes.mjs";
import { syncRuntimeLinksForRepo } from "./writeback.mjs";
import { assertPathInsideRoot, ensureDir, isDirectory, listDir, pathExists, readJson, readText, writeText } from "../utils/fs.mjs";
import { createUnifiedDiff, summarizeTextDiff } from "../utils/diff.mjs";
import { renderTemplate, toModuleListText } from "../utils/text.mjs";

const CHANGE_TEMPLATE_ROOT = path.join(PROJECT_ROOT, "src/workflow/templates/change");
const LATEST_CHANGE_STRUCTURE = [
  "01-需求与方案.md",
  "02-技术设计与选型.md",
  "03-任务计划与执行.md",
  "04-验收与交接.md"
];
const DELIVERY_CHANGE_FILES = ["commit-message.md", "delivery-checklist.md"];
const LATEST_CHANGE_STRUCTURE_SET = new Set(LATEST_CHANGE_STRUCTURE);
const MANAGED_CORE_FILES = [
  {
    target: ".specnfc/README.md",
    source: "src/templates/core/files/.specnfc/README.md"
  },
  {
    target: "AGENTS.md",
    source: "src/templates/core/files/AGENTS.md"
  },
  {
    target: "CLAUDE.md",
    source: "src/templates/core/files/CLAUDE.md"
  },
  {
    target: "opencode.json",
    source: "src/templates/core/files/opencode.json"
  },
  {
    target: ".trae/rules/project_rules.md",
    source: "src/templates/core/files/.trae/rules/project_rules.md"
  }
];

export async function upgradeRepository({ repoRoot, dryRun = false }) {
  const packageMeta = await getPackageMeta();
  const currentConfig = await loadConfig(repoRoot);
  let nextConfig = createUpgradedConfig(currentConfig, packageMeta.version);

  const moduleSync = await synchronizeModuleTemplates({
    repoRoot,
    config: nextConfig,
    packageMeta,
    dryRun
  });
  const protocolSync = await refreshProtocolPlaneFiles({
    repoRoot,
    config: nextConfig,
    dryRun
  });

  const changes = await backfillChangeFiles({
    repoRoot,
    config: nextConfig,
    packageMeta,
    dryRun
  });
  const integrations = await backfillIntegrationFiles({
    repoRoot,
    packageMeta,
    dryRun
  });
  const runtimeMigration = await migrateLegacyRuntime({
    repoRoot,
    dryRun
  });
  const gitignoreSync = await ensureSpecnfcGitignore({
    repoRoot,
    dryRun
  });

  if (!dryRun) {
    nextConfig = trackManagedFiles(nextConfig, {
      ...moduleSync.tracked,
      ...protocolSync.tracked,
      ...changes.tracked
    });
    await saveConfig(repoRoot, nextConfig);
    await syncRuntimeLinksForRepo({ repoRoot });
    await updateRepositoryIndexes({ repoRoot });
  }

  const fromVersion = currentConfig.specnfc?.templateVersion ?? currentConfig.specnfc?.version ?? "0.0.0";
  const updatedConfig = summarizeConfigChanges(currentConfig, nextConfig);
  const impactSummary = summarizeUpgradeImpact({ moduleSync, protocolSync, changes, integrations, runtimeMigration, gitignoreSync, updatedConfig });
  const migrationSummary = buildMigrationSummary({
    currentConfig,
    nextConfig,
    fromVersion,
    toVersion: packageMeta.version,
    updatedConfig,
    protocolSync,
    integrations,
    runtimeMigration,
    gitignoreSync
  });
  const supportAssessment = assessUpgradeSupport({ moduleSync, changes, integrations });
  const repositoryReport = await inspectRepository(repoRoot).catch(() => null);
  const riskSummary = buildUpgradeRiskSummary({ moduleSync, changes, integrations, supportAssessment, repositoryReport });
  const manualActions = buildUpgradeManualActions({
    dryRun,
    moduleSync,
    changes,
    integrations,
    supportAssessment,
    migrationSummary,
    runtimeMigration,
    repositoryReport
  });

  return {
    fromVersion,
    toVersion: packageMeta.version,
    dryRun,
    managedFilesCreated: moduleSync.created,
    managedFilesRefreshed: moduleSync.updated,
    managedFilesTracked: moduleSync.adopted,
    managedFilesConflicted: moduleSync.conflicts,
    managedFilesSkipped: moduleSync.legacySkipped,
    managedFileDiffs: moduleSync.diffs,
    protocolFilesCreated: protocolSync.created,
    changeFilesCreated: changes.created,
    integrationFilesCreated: integrations.created,
    skippedChanges: changes.skipped,
    skippedIntegrations: integrations.skipped,
    runtimeMigration,
    gitignoreSync,
    updatedConfig,
    impactSummary,
    migrationSummary,
    supportAssessment,
    riskSummary,
    manualActions
  };
}

function createUpgradedConfig(config, templateVersion) {
  const nextConfig = structuredClone(config);
  nextConfig.specnfc = {
    ...nextConfig.specnfc,
    version: templateVersion,
    templateVersion,
    language: nextConfig.specnfc?.language ?? "zh-CN"
  };
  nextConfig.defaults = {
    ...nextConfig.defaults,
    changeStructure: [...LATEST_CHANGE_STRUCTURE],
    outputMode: nextConfig.defaults?.outputMode ?? "human",
    agentOutputRule: nextConfig.defaults?.agentOutputRule ?? "final-plus-context"
  };
  return nextConfig;
}

async function synchronizeModuleTemplates({ repoRoot, config, packageMeta, dryRun }) {
  const trackedHashes = getManagedFileHashes(config);
  const created = [];
  const updated = [];
  const adopted = [];
  const conflicts = [];
  const legacySkipped = [];
  const tracked = {};
  const diffs = {
    created: [],
    refreshed: [],
    conflicted: [],
    skipped: []
  };

  const templateFiles = await buildManagedTemplateFiles({ repoRoot, config, packageMeta });

  for (const file of templateFiles) {
    const targetPath = resolvePathWithin(repoRoot, file.target);
    await assertPathInsideRoot(repoRoot, targetPath);

    if (file.mode === "ensure-dir") {
      if (!dryRun) {
        await ensureDir(targetPath);
      }
      continue;
    }

    const latestHash = hashManagedContent(file.content);
    const trackedHash = trackedHashes[file.target];
    const exists = await pathExists(targetPath);

    if (!exists) {
      if (!dryRun) {
        await writeText(targetPath, file.content);
      }
      created.push(file.target);
      tracked[file.target] = latestHash;
      diffs.created.push({
        target: file.target,
        diff: createManagedFileDiff({
          target: file.target,
          beforeText: "",
          afterText: file.content
        })
      });
      continue;
    }

    const currentContent = await readText(targetPath);
    const currentHash = hashManagedContent(currentContent);

    if (trackedHash) {
      if (currentHash === latestHash) {
        tracked[file.target] = latestHash;
        continue;
      }

      if (currentHash === trackedHash) {
        if (!dryRun) {
          await writeText(targetPath, file.content);
        }
        updated.push(file.target);
        tracked[file.target] = latestHash;
        diffs.refreshed.push({
          target: file.target,
          diff: createManagedFileDiff({
            target: file.target,
            beforeText: currentContent,
            afterText: file.content
          })
        });
        continue;
      }

      conflicts.push(file.target);
      diffs.conflicted.push({
        target: file.target,
        diff: createManagedFileDiff({
          target: file.target,
          beforeText: currentContent,
          afterText: file.content
        })
      });
      continue;
    }

    if (currentHash === latestHash) {
      adopted.push(file.target);
      tracked[file.target] = latestHash;
      continue;
    }

    legacySkipped.push(file.target);
    diffs.skipped.push({
      target: file.target,
      diff: createManagedFileDiff({
        target: file.target,
        beforeText: currentContent,
        afterText: file.content
      })
    });
  }

  return {
    created,
    updated,
    adopted,
    conflicts,
    legacySkipped,
    tracked,
    diffs
  };
}

function createManagedFileDiff({ target, beforeText, afterText }) {
  const summary = summarizeTextDiff(beforeText, afterText);
  return {
    ...summary,
    unified: createUnifiedDiff(beforeText, afterText, {
      beforeLabel: `a/${target}`,
      afterLabel: `b/${target}`
    })
  };
}

async function buildManagedTemplateFiles({ repoRoot, config, packageMeta }) {
  const context = createRenderContext({ repoRoot, config, packageMeta });
  const files = [];

  for (const file of MANAGED_CORE_FILES) {
    const sourcePath = resolvePathWithin(PROJECT_ROOT, file.source);
    files.push({
      target: file.target,
      mode: "managed",
      content: renderTemplate(await readText(sourcePath), context)
    });
  }

  for (const [moduleName, moduleConfig] of Object.entries(config.modules || {})) {
    if (!moduleConfig.enabled || moduleName === "core") {
      continue;
    }

    const manifest = await loadManifest(moduleName);
    const templateRoot = resolvePathWithin(PROJECT_ROOT, "src/templates", moduleName);

    for (const fileEntry of manifest.files) {
      if (fileEntry.mode === "ensure-dir") {
        files.push({
          target: fileEntry.target,
          mode: "ensure-dir"
        });
        continue;
      }

      const sourcePath = resolvePathWithin(templateRoot, fileEntry.source);
      files.push({
        target: fileEntry.target,
        mode: fileEntry.mode,
        content: renderTemplate(await readText(sourcePath), context)
      });
    }
  }

  return files;
}

async function backfillChangeFiles({ repoRoot, config, packageMeta, dryRun }) {
  const repoPaths = getRepoPaths(repoRoot);
  const created = [];
  const skipped = [];
  const tracked = {};

  if (!(await pathExists(repoPaths.changesRoot))) {
    return { created, skipped, tracked };
  }

  const changeIds = await listChangeIds(repoPaths.changesRoot);
  const requiredFiles = [
    ...LATEST_CHANGE_STRUCTURE,
    "runtime-links.json",
    ...(shouldBackfillDeliveryFiles(config) ? DELIVERY_CHANGE_FILES : [])
  ];

  for (const changeId of changeIds) {
    const changeRoot = resolvePathWithin(repoPaths.changesRoot, changeId);
    const metaPath = resolvePathWithin(changeRoot, "meta.json");

    let meta;
    try {
      meta = await readJson(metaPath);
    } catch {
      skipped.push(`${path.relative(repoRoot, changeRoot).split(path.sep).join("/")}: meta.json 无法解析，已跳过`);
      continue;
    }

    const normalizedStage = meta.stage ?? "draft";
    const context = {
      changeId: meta.id ?? changeId,
      changeTitle: meta.title ?? changeId,
      changeType: meta.type ?? "feature",
      changeStage: normalizedStage,
      changeCanonicalStage: mapLegacyChangeStageToCanonical(normalizedStage),
      createdAt: meta.createdAt ?? new Date().toISOString(),
      updatedAt: meta.updatedAt ?? meta.createdAt ?? new Date().toISOString(),
      templateVersion: packageMeta.version,
      repositoryName: config.repository?.name ?? path.basename(repoRoot)
    };

    if (!dryRun) {
      const nextMeta = {
        ...meta,
        stage: normalizedStage,
        legacyStage: meta.legacyStage ?? normalizedStage,
        canonicalStage: meta.canonicalStage ?? mapLegacyChangeStageToCanonical(normalizedStage)
      };
      await writeText(metaPath, `${JSON.stringify(nextMeta, null, 2)}\n`);
      tracked[path.relative(repoRoot, metaPath).split(path.sep).join("/")] = hashManagedContent(
        `${JSON.stringify(nextMeta, null, 2)}\n`
      );
      const runtimeLinksPath = resolvePathWithin(changeRoot, "runtime-links.json");
      if (!(await pathExists(runtimeLinksPath))) {
        await writeText(
          runtimeLinksPath,
          `${JSON.stringify({
            scope: "change",
            targetId: meta.id ?? changeId,
            targetPath: path.relative(repoRoot, changeRoot).split(path.sep).join("/"),
            pendingCount: 0,
            targetDocs: [],
            items: [],
            updatedAt: new Date().toISOString()
          }, null, 2)}\n`
        );
      }
    }

    for (const fileName of requiredFiles) {
      const targetPath = resolvePathWithin(changeRoot, fileName);
      await assertPathInsideRoot(repoRoot, targetPath);

      if (await pathExists(targetPath)) {
        continue;
      }

      const sourcePath = resolvePathWithin(CHANGE_TEMPLATE_ROOT, fileName);
      const rendered = renderTemplate(await readText(sourcePath), context);
      if (!dryRun) {
        await writeText(targetPath, rendered);
      }
      const relativeTarget = path.relative(repoRoot, targetPath).split(path.sep).join("/");
      created.push(relativeTarget);
      tracked[relativeTarget] = hashManagedContent(rendered);
    }
  }

  return { created, skipped, tracked };
}

function shouldBackfillDeliveryFiles(config) {
  if (!config.modules?.delivery?.enabled) {
    return false;
  }

  const structure = Array.isArray(config.defaults?.changeStructure) ? config.defaults.changeStructure : [];
  return !(structure.length === LATEST_CHANGE_STRUCTURE.length && structure.every((fileName) => LATEST_CHANGE_STRUCTURE_SET.has(fileName)));
}

async function backfillIntegrationFiles({ repoRoot, packageMeta, dryRun }) {
  const repoPaths = getRepoPaths(repoRoot);
  const created = [];
  const skipped = [];

  if (!(await pathExists(repoPaths.integrationsRoot))) {
    return { created, skipped };
  }

  const entries = await listDir(repoPaths.integrationsRoot);
  for (const entry of entries) {
    const integrationRoot = resolvePathWithin(repoPaths.integrationsRoot, entry);
    if (!(await isDirectory(integrationRoot))) {
      continue;
    }
    const metaPath = resolvePathWithin(integrationRoot, "meta.json");
    if (!(await pathExists(metaPath))) {
      skipped.push(`${path.relative(repoRoot, integrationRoot).split(path.sep).join("/")}: meta.json 缺失`);
      continue;
    }

    let meta;
    try {
      meta = await readJson(metaPath);
    } catch {
      skipped.push(`${path.relative(repoRoot, integrationRoot).split(path.sep).join("/")}: meta.json 无法解析`);
      continue;
    }

    const status = meta.status ?? "draft";
    const nextMeta = {
      ...meta,
      status,
      legacyStage: meta.legacyStage ?? status,
      canonicalStage: meta.canonicalStage ?? mapIntegrationStateToCanonical(status),
      upgradedAt: dryRun ? meta.upgradedAt ?? null : new Date().toISOString(),
      templateVersion: packageMeta.version
    };

    if (!dryRun) {
      await writeText(metaPath, `${JSON.stringify(nextMeta, null, 2)}\n`);
      const runtimeLinksPath = resolvePathWithin(integrationRoot, "runtime-links.json");
      if (!(await pathExists(runtimeLinksPath))) {
        await writeText(
          runtimeLinksPath,
          `${JSON.stringify({
            scope: "integration",
            targetId: meta.id ?? entry,
            targetPath: path.relative(repoRoot, integrationRoot).split(path.sep).join("/"),
            pendingCount: 0,
            targetDocs: [],
            items: [],
            updatedAt: new Date().toISOString()
          }, null, 2)}\n`
        );
        created.push(path.relative(repoRoot, runtimeLinksPath).split(path.sep).join("/"));
      }
    }
    created.push(path.relative(repoRoot, metaPath).split(path.sep).join("/"));
  }

  return {
    created,
    skipped
  };
}

async function migrateLegacyRuntime({ repoRoot, dryRun }) {
  const legacyRoot = resolvePathWithin(repoRoot, ".omx");
  const targetPath = resolvePathWithin(repoRoot, ".nfc/migration-from-omx.json");
  const exists = await pathExists(legacyRoot);
  const payload = {
    legacyRoot: ".omx",
    targetRoot: ".nfc",
    detected: exists,
    migratedDomains: exists ? ["context", "interviews", "plans", "logs", "state"] : [],
    strategy: "report-only-minimal",
    updatedAt: new Date().toISOString()
  };

  if (exists && !dryRun) {
    await writeText(targetPath, `${JSON.stringify(payload, null, 2)}\n`);
  }

  return {
    detected: exists,
    reportPath: exists ? ".nfc/migration-from-omx.json" : null
  };
}

async function listChangeIds(changesRoot) {
  const entries = await listDir(changesRoot);
  const changeIds = [];

  for (const entry of entries) {
    if (await isDirectory(path.join(changesRoot, entry))) {
      changeIds.push(entry);
    }
  }

  return changeIds.sort();
}

function summarizeConfigChanges(currentConfig, nextConfig) {
  return {
    templateVersionChanged:
      (currentConfig.specnfc?.templateVersion ?? currentConfig.specnfc?.version ?? null) !== nextConfig.specnfc.templateVersion,
    changeStructureChanged:
      JSON.stringify(currentConfig.defaults?.changeStructure ?? []) !== JSON.stringify(nextConfig.defaults.changeStructure)
  };
}

function summarizeUpgradeImpact({ moduleSync, protocolSync, changes, integrations, runtimeMigration, gitignoreSync, updatedConfig }) {
  return {
    managedFilesCreatedCount: moduleSync.created.length,
    managedFilesRefreshedCount: moduleSync.updated.length,
    managedFilesTrackedCount: moduleSync.adopted.length,
    managedFilesConflictedCount: moduleSync.conflicts.length,
    managedFilesSkippedCount: moduleSync.legacySkipped.length,
    protocolFilesCreatedCount: protocolSync.created.length,
    changeFilesCreatedCount: changes.created.length,
    integrationFilesCreatedCount: integrations.created.length,
    skippedChangesCount: changes.skipped.length,
    skippedIntegrationsCount: integrations.skipped.length,
    gitignoreChanged: Boolean(gitignoreSync?.changed),
    legacyRuntimeDetected: runtimeMigration.detected,
    templateVersionChanged: updatedConfig.templateVersionChanged,
    changeStructureChanged: updatedConfig.changeStructureChanged
  };
}

function buildMigrationSummary({ currentConfig, nextConfig, fromVersion, toVersion, updatedConfig, protocolSync, integrations, runtimeMigration, gitignoreSync }) {
  const previousStructure = currentConfig.defaults?.changeStructure ?? [];
  const nextStructure = nextConfig.defaults?.changeStructure ?? [];
  const addedFiles = nextStructure.filter((item) => !previousStructure.includes(item));
  const removedFiles = previousStructure.filter((item) => !nextStructure.includes(item));
  const notes = [];

  if (updatedConfig.templateVersionChanged) {
    notes.push(`模板版本将从 ${fromVersion} 升级到 ${toVersion}`);
  }
  if (addedFiles.length) {
    notes.push(`change 默认结构将补齐：${addedFiles.join("、")}`);
  }
  if (currentConfig.modules?.delivery?.enabled) {
    notes.push("当前仓启用了 delivery，升级时会继续维持交付文件要求");
  }
  if (protocolSync.created.length) {
    notes.push(`协议控制面新增文件：${protocolSync.created.length} 个`);
  }
  if (integrations.created.length) {
    notes.push(`integration 元信息已回填 canonical 字段：${integrations.created.length} 个`);
  }
  if (runtimeMigration.detected) {
    notes.push("检测到 legacy .omx 运行时，已生成最小迁移报告");
  }
  if (gitignoreSync?.changed) {
    notes.push("已同步 .gitignore，默认忽略本地 .nfc 运行时目录");
  }
  if (!notes.length) {
    notes.push("当前仓模板结构已与最新版本对齐，仅做受管文件校验");
  }

  return {
    fromVersion,
    toVersion,
    templateVersionChanged: updatedConfig.templateVersionChanged,
    changeStructureChanged: updatedConfig.changeStructureChanged,
    changeStructure: {
      previousFiles: previousStructure,
      latestFiles: nextStructure,
      addedFiles,
      removedFiles
    },
    deliveryEnabled: Boolean(currentConfig.modules?.delivery?.enabled),
    notes
  };
}

function assessUpgradeSupport({ moduleSync, changes, integrations }) {
  const protectedCustomizationCount = moduleSync.conflicts.length + moduleSync.legacySkipped.length;
  const reasons = [];

  if (moduleSync.conflicts.length) {
    reasons.push({
      code: "CONFLICTED_MANAGED_FILES",
      message: `发现 ${moduleSync.conflicts.length} 个受追踪模板文件已被手工改动`
    });
  }

  if (moduleSync.legacySkipped.length) {
    reasons.push({
      code: "LEGACY_UNTRACKED_CUSTOMIZATIONS",
      message: `发现 ${moduleSync.legacySkipped.length} 个未纳入追踪的本地模板定制`
    });
  }

  if (changes.skipped.length) {
    reasons.push({
      code: "UNREADABLE_LEGACY_CHANGES",
      message: `发现 ${changes.skipped.length} 条 legacy change 无法自动补齐`
    });
  }
  if (integrations.skipped.length) {
    reasons.push({
      code: "UNREADABLE_LEGACY_INTEGRATIONS",
      message: `发现 ${integrations.skipped.length} 条 legacy integration 无法自动回填`
    });
  }

  if (changes.skipped.length || integrations.skipped.length || protectedCustomizationCount >= 4) {
    return {
      level: "out_of_scope",
      reviewRequired: true,
      protectedCustomizationCount,
      summary: "当前仓超出 v2.0.0 自动升级的安全范围，建议按输出清单人工处理后再升级。",
      reasons
    };
  }

  if (protectedCustomizationCount > 0) {
    return {
      level: "supported_with_manual_review",
      reviewRequired: true,
      protectedCustomizationCount,
      summary: "当前仓仍在支持范围内，但存在少量定制内容，需要人工复核后再完成升级。",
      reasons
    };
  }

  return {
    level: "supported",
    reviewRequired: false,
    protectedCustomizationCount: 0,
    summary: "当前仓在 v2.0.0 支持范围内，可按标准流程执行升级。",
    reasons
  };
}

function buildUpgradeRiskSummary({ moduleSync, changes, integrations, supportAssessment, repositoryReport }) {
  const risks = [];
  const releaseGateIssues = getRepositoryReleaseGateIssues(repositoryReport);

  if (moduleSync.conflicts.length) {
    risks.push({
      code: "MANAGED_FILE_CONFLICT",
      level: "advisory",
      message: `有 ${moduleSync.conflicts.length} 个受追踪模板文件与本地改动冲突，升级不会直接覆盖。`,
      files: moduleSync.conflicts
    });
  }

  if (moduleSync.legacySkipped.length) {
    risks.push({
      code: "LEGACY_CUSTOMIZATION_PROTECTED",
      level: supportAssessment.level === "out_of_scope" ? "blocking" : "advisory",
      message: `有 ${moduleSync.legacySkipped.length} 个未纳入追踪的本地模板文件已被保护跳过。`,
      files: moduleSync.legacySkipped
    });
  }

  if (changes.skipped.length) {
    risks.push({
      code: "CHANGE_BACKFILL_SKIPPED",
      level: "blocking",
      message: `有 ${changes.skipped.length} 条历史 change 无法自动补齐，需先修复元信息或手工处理。`,
      details: changes.skipped
    });
  }
  if (integrations.skipped.length) {
    risks.push({
      code: "INTEGRATION_BACKFILL_SKIPPED",
      level: "blocking",
      message: `有 ${integrations.skipped.length} 条历史 integration 无法自动回填，需先修复元信息或手工处理。`,
      details: integrations.skipped
    });
  }

  if (supportAssessment.level === "out_of_scope") {
    risks.push({
      code: "UPGRADE_SCOPE_EXCEEDED",
      level: "blocking",
      message: supportAssessment.summary,
      reasons: supportAssessment.reasons
    });
  }

  if (hasBlockingIssue(repositoryReport, "WAIVER_INVALID")) {
    risks.push({
      code: "WAIVER_INVALID",
      level: "blocking",
      message: "当前仓存在无效 waiver，升级后仍需修复或删除无效豁免。"
    });
  }

  if (hasBlockingIssue(repositoryReport, "WAIVER_EXPIRED")) {
    risks.push({
      code: "WAIVER_EXPIRED",
      level: "blocking",
      message: "当前仓存在已过期 waiver，升级后仍需续期或移除。"
    });
  }

  if (hasBlockingIssue(repositoryReport, "GOVERNANCE_INVALID")) {
    risks.push({
      code: "GOVERNANCE_INVALID",
      level: "blocking",
      message: "当前仓存在无效治理记录，升级后仍需修复 JSON、scope/target 或关联引用。"
    });
  }

  if (releaseGateIssues.projectionDrift) {
    risks.push({
      code: "PROJECTION_DRIFT_REVIEW",
      level: "advisory",
      message: "当前仓入口投影存在漂移，升级后仍需确认是否重生成或手工合并。"
    });
  }

  if (releaseGateIssues.skillPackDrift) {
    risks.push({
      code: "SKILL_PACK_DRIFT_REVIEW",
      level: "advisory",
      message: "当前仓技能包快照未同步，升级后仍需确认 active skill-pack 与 .nfc 运行时镜像。"
    });
  }

  return risks;
}

function buildUpgradeManualActions({
  dryRun,
  moduleSync,
  changes,
  integrations,
  supportAssessment,
  migrationSummary,
  runtimeMigration,
  repositoryReport
}) {
  const actions = [];
  const releaseGateIssues = getRepositoryReleaseGateIssues(repositoryReport);

  if (changes.created.length) {
    actions.push({
      code: "REVIEW_BACKFILLED_CHANGE_FILES",
      message: `检查自动补齐的 ${changes.created.length} 个 change 文件是否符合当前仓语义。`,
      command: dryRun ? "specnfc upgrade" : "specnfc change list"
    });
  }

  if (moduleSync.conflicts.length) {
    actions.push({
      code: "RESOLVE_CONFLICTED_FILES",
      message: `逐个处理 ${moduleSync.conflicts.length} 个冲突模板文件，确认保留本地定制还是手工合并新模板。`,
      command: "specnfc upgrade --dry-run --json"
    });
  }

  if (moduleSync.legacySkipped.length) {
    actions.push({
      code: "REVIEW_PROTECTED_CUSTOMIZATIONS",
      message: `复核 ${moduleSync.legacySkipped.length} 个受保护跳过的本地模板文件，必要时手工迁移到新模板。`,
      command: "specnfc doctor"
    });
  }

  if (changes.skipped.length) {
    actions.push({
      code: "REPAIR_LEGACY_CHANGE_META",
      message: "修复无法解析的历史 change 元信息后，再重新执行升级。",
      command: "specnfc upgrade --dry-run --json"
    });
  }
  if (integrations.skipped.length) {
    actions.push({
      code: "REPAIR_LEGACY_INTEGRATION_META",
      message: "修复无法解析的历史 integration 元信息后，再重新执行升级。",
      command: "specnfc upgrade --dry-run --json"
    });
  }
  if (runtimeMigration.detected) {
    actions.push({
      code: "REVIEW_LEGACY_RUNTIME_MIGRATION",
      message: "检查 `.nfc/migration-from-omx.json`，确认 legacy 运行时迁移策略。",
      command: "specnfc doctor"
    });
  }

  if (hasBlockingIssue(repositoryReport, "WAIVER_INVALID")) {
    actions.push({
      code: "REVIEW_INVALID_WAIVERS",
      message: "修复无效 waiver JSON，避免豁免失效但仍被误以为已覆盖。",
      command: "specnfc doctor"
    });
  }

  if (hasBlockingIssue(repositoryReport, "WAIVER_EXPIRED")) {
    actions.push({
      code: "RENEW_EXPIRED_WAIVERS",
      message: "为已过期 waiver 续期或直接删除，再重新检查协议状态。",
      command: "specnfc doctor"
    });
  }

  if (hasBlockingIssue(repositoryReport, "GOVERNANCE_INVALID")) {
    actions.push({
      code: "REPAIR_INVALID_GOVERNANCE_RECORDS",
      message: "修复无效治理记录的 JSON、scope/target 或关联引用，再重新检查协议状态。",
      command: "specnfc doctor"
    });
  }

  if (releaseGateIssues.projectionDrift) {
    actions.push({
      code: "PROJECTION_DRIFT_REVIEW",
      message: "复核 AGENTS.md / CLAUDE.md / .trae / opencode 的漂移项，必要时重新生成或手工合并。",
      command: "specnfc doctor"
    });
  }

  if (releaseGateIssues.skillPackDrift) {
    actions.push({
      code: "SKILL_PACK_DRIFT_REVIEW",
      message: "复核 `.specnfc/skill-packs/active` 主文档与 manifest 是否仍存在本地漂移。",
      command: "specnfc doctor"
    });
  }

  if (supportAssessment.level === "out_of_scope") {
    actions.push({
      code: "MANUAL_UPGRADE_REQUIRED",
      message: "当前仓不适合直接自动升级，先按风险清单人工收敛本地定制与历史漂移。",
      command: "specnfc doctor"
    });
  }

  if (migrationSummary.notes.length) {
    actions.push({
      code: "REVIEW_MIGRATION_NOTES",
      message: "确认版本迁移说明中的变化点是否已被团队接受并同步到当前仓。",
      command: "specnfc status"
    });
  }

  actions.push({
    code: "RUN_POST_UPGRADE_CHECKS",
    message: dryRun ? "确认预览结果后执行正式升级，并在升级后运行仓级检查。" : "升级后立即运行仓级检查，确认无遗留阻塞。",
    command: dryRun ? "specnfc upgrade && specnfc doctor && specnfc status" : "specnfc doctor && specnfc status"
  });

  return actions;
}

function hasBlockingIssue(repositoryReport, prefix) {
  return (repositoryReport?.compliance?.blockingIssues || []).some((item) => item.startsWith(prefix));
}

function getRepositoryReleaseGateIssues(repositoryReport) {
  const advisoryIssues = repositoryReport?.compliance?.advisoryIssues || [];
  return {
    projectionDrift: advisoryIssues.includes("PROJECTION_DRIFT"),
    skillPackDrift: advisoryIssues.some((item) => item.startsWith("SKILL_PACK_"))
  };
}

function mapLegacyChangeStageToCanonical(stage) {
  switch (stage) {
    case "draft":
      return "clarify";
    case "design":
      return "design";
    case "ready":
      return "plan";
    case "in-progress":
      return "execute";
    case "verifying":
      return "verify";
    case "handoff":
      return "accept";
    case "archived":
      return "archive";
    default:
      return "clarify";
  }
}

function mapIntegrationStateToCanonical(state) {
  switch (state) {
    case "draft":
      return "clarify";
    case "aligned":
      return "plan";
    case "implementing":
      return "execute";
    case "integrating":
      return "verify";
    case "done":
      return "accept";
    case "blocked":
      return "plan";
    default:
      return "clarify";
  }
}

function createRenderContext({ repoRoot, config, packageMeta }) {
  const enabledModules = Object.entries(config.modules || {})
    .filter(([, meta]) => meta.enabled)
    .map(([name]) => name);
  const requiredReadPaths = [".specnfc/README.md", ".specnfc/runtime/active-rules.json", "specs/README.md"];
  const preflightCommands = ["specnfc status --json", "specnfc change check <change-id>"];

  if (enabledModules.includes("context")) requiredReadPaths.push(".specnfc/context/");
  if (enabledModules.includes("execution")) requiredReadPaths.push(".specnfc/execution/");
  if (enabledModules.includes("governance")) requiredReadPaths.push(".specnfc/governance/");
  requiredReadPaths.push("specs/changes/<change-id>/");

  const optionalModuleDocs = [];
  if (enabledModules.includes("design-api")) optionalModuleDocs.push({ label: "接口设计", path: ".specnfc/design/api/" });
  if (enabledModules.includes("design-db")) optionalModuleDocs.push({ label: "数据库设计", path: ".specnfc/design/db/" });
  if (enabledModules.includes("quality")) optionalModuleDocs.push({ label: "质量与测试", path: ".specnfc/quality/" });
  if (enabledModules.includes("delivery")) optionalModuleDocs.push({ label: "交付与集成", path: ".specnfc/delivery/" });
  if (enabledModules.includes("integration-contract")) {
    optionalModuleDocs.push({ label: "多人对接", path: ".specnfc/integration-contract/" });
    preflightCommands.push("specnfc integration check <integration-id>");
  }

  return {
    specnfcVersion: packageMeta.version || config.specnfc?.version || "",
    templateVersion: packageMeta.version || config.specnfc?.templateVersion || "",
    initializedAt: config.repository.initializedAt,
    profileName: config.repository.profile || "minimal",
    repositoryName: path.basename(repoRoot),
    enabledModulesMarkdown: toModuleListText(enabledModules),
    toolEntryMappingMarkdown: [
      "- Codex / OpenCode：`AGENTS.md`",
      "- Claude Code：`CLAUDE.md`",
      "- Trae：`.trae/rules/project_rules.md`"
    ].join("\n"),
    requiredReadListMarkdown: requiredReadPaths.map((item, index) => `${index + 1}. \`${item}\``).join("\n"),
    requiredReadSentence: toChineseJoin(requiredReadPaths.map((item) => `\`${item}\``)),
    preflightCommandListMarkdown: preflightCommands.map((item) => `- \`${item}\``).join("\n"),
    preflightCommandSentence: toChineseJoin(preflightCommands.map((item) => `\`${item}\``)),
    memoryIndexBlock: buildMemoryIndexBlock(enabledModules),
    optionalReadBlock: buildOptionalReadBlock(optionalModuleDocs),
    optionalReadLine: buildOptionalReadLine(optionalModuleDocs),
    moduleGuideListMarkdown: buildModuleGuideListMarkdown(enabledModules),
    opencodeInstructionsJson: JSON.stringify(buildOpencodeInstructions(enabledModules), null, 2)
  };
}

function buildMemoryIndexBlock(enabledModules) {
  const repositoryMemory = [
    "- 仓级总览：`.specnfc/README.md`",
    "- 当前生效规则：`.specnfc/runtime/active-rules.json`"
  ];

  if (enabledModules.includes("context")) {
    repositoryMemory.push("- 系统定位与外部边界：`.specnfc/context/system.md`");
    repositoryMemory.push("- 架构边界与禁改区：`.specnfc/context/architecture.md`");
    repositoryMemory.push("- 领域术语与业务规则：`.specnfc/context/domain.md`");
    repositoryMemory.push("- 编码、测试与协作约束：`.specnfc/context/coding-rules.md`");
  }

  if (enabledModules.includes("governance")) {
    repositoryMemory.push("- 裁决点与高风险边界：`.specnfc/governance/decision-gates.md`");
    repositoryMemory.push("- 安全边界：`.specnfc/governance/security-boundaries.md`");
    repositoryMemory.push("- 风险分级：`.specnfc/governance/risk-matrix.md`");
    repositoryMemory.push("- 个人 Skills 边界：`.specnfc/governance/personal-skills.md`");
  }

  const currentWorkMemory = [
    "- 当前 change 结构化事实：`specs/changes/<change-id>/meta.json`",
    "- change 需求与方案：`specs/changes/<change-id>/01-需求与方案.md`、`02-技术设计与选型.md`",
    "- change 执行与交付：`specs/changes/<change-id>/03-任务计划与执行.md`、`04-验收与交接.md`"
  ];

  if (enabledModules.includes("integration-contract")) {
    currentWorkMemory.push(
      "- 当前 integration 契约与状态：`specs/integrations/<integration-id>/contract.md`、`decisions.md`、`status.md`"
    );
  }

  return [
    "### 仓级长期事实",
    ...repositoryMemory,
    "",
    "### 当前变更 / 对接事实",
    ...currentWorkMemory,
    "",
    "### 读取顺序与冲突处理",
    "- 入口文件只负责导航，不替代正式文档：`AGENTS.md`、`CLAUDE.md`、`.trae/rules/project_rules.md`",
    "- 信息冲突时，先以 `.specnfc/` 中的正式规则和治理边界为准，再以当前 `change / integration` 正式文件为准，最后才参考入口提示文案"
  ].join("\n");
}

function buildOptionalReadBlock(optionalModuleDocs) {
  if (!optionalModuleDocs.length) {
    return "";
  }

  return [
    "## 按任务补读的专项模块",
    ...optionalModuleDocs.map((item) => `- 涉及${item.label}时，再读取 \`${item.path}\``)
  ].join("\n");
}

function buildOptionalReadLine(optionalModuleDocs) {
  if (!optionalModuleDocs.length) {
    return "";
  }

  return `- 如任务涉及${toChineseJoin(optionalModuleDocs.map((item) => item.label))}，再补读 ${toChineseJoin(
    optionalModuleDocs.map((item) => `\`${item.path}\``)
  )}。`;
}

function buildModuleGuideListMarkdown(enabledModules) {
  const items = [];

  if (enabledModules.includes("context")) items.push("- 阅读 `.specnfc/context/README.md` 与 `.specnfc/context/AGENT.md`");
  if (enabledModules.includes("execution")) items.push("- 阅读 `.specnfc/execution/README.md` 与 `.specnfc/execution/AGENT.md`");
  if (enabledModules.includes("governance")) items.push("- 阅读 `.specnfc/governance/README.md` 与 `.specnfc/governance/AGENT.md`");
  if (enabledModules.includes("design-api")) items.push("- 涉及接口契约时，阅读 `.specnfc/design/api/README.md` 与 `.specnfc/design/api/AGENT.md`");
  if (enabledModules.includes("design-db")) items.push("- 涉及数据库变更时，阅读 `.specnfc/design/db/README.md` 与 `.specnfc/design/db/AGENT.md`");
  if (enabledModules.includes("quality")) items.push("- 涉及测试补齐、回归和发布验证时，阅读 `.specnfc/quality/README.md` 与 `.specnfc/quality/AGENT.md`");
  if (enabledModules.includes("delivery")) items.push("- 涉及 Git 提交、推送和交付约束时，阅读 `.specnfc/delivery/README.md` 与 `.specnfc/delivery/AGENT.md`");
  if (enabledModules.includes("integration-contract")) items.push("- 涉及多人接口 / service 对接时，阅读 `.specnfc/integration-contract/README.md` 与 `.specnfc/integration-contract/AGENT.md`");
  if (!items.length) items.push("- 当前只启用 `core`，如需统一上下文、执行和治理，运行 `specnfc add context execution governance`");

  return items.join("\n");
}

function buildOpencodeInstructions(enabledModules) {
  const instructions = ["AGENTS.md", ".specnfc/README.md", ".specnfc/runtime/active-rules.json", "specs/README.md"];
  if (enabledModules.includes("context")) instructions.push(".specnfc/context/**/*.md");
  if (enabledModules.includes("execution")) instructions.push(".specnfc/execution/**/*.md");
  if (enabledModules.includes("governance")) instructions.push(".specnfc/governance/**/*.md");
  if (enabledModules.includes("design-api")) instructions.push(".specnfc/design/api/**/*.md");
  if (enabledModules.includes("design-db")) instructions.push(".specnfc/design/db/**/*.md");
  if (enabledModules.includes("quality")) instructions.push(".specnfc/quality/**/*.md");
  if (enabledModules.includes("delivery")) instructions.push(".specnfc/delivery/**/*.md");
  if (enabledModules.includes("integration-contract")) {
    instructions.push(".specnfc/integration-contract/**/*.md");
    instructions.push("specs/integrations/**/*.md");
  }
  instructions.push("specs/changes/**/*.md");
  return instructions;
}

function toChineseJoin(items) {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} 和 ${items[1]}`;
  return `${items.slice(0, -1).join("、")} 和 ${items.at(-1)}`;
}
