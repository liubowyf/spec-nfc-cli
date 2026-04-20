import path from "node:path";
import { getPackageMeta } from "./meta.mjs";
import { PROJECT_ROOT, getModuleTemplateRoot, getRepoPaths, resolvePathWithin } from "./paths.mjs";
import { MODULES } from "./modules.mjs";
import { buildActiveRules } from "./rules.mjs";
import { readRepositoryGovernanceMode } from "./governance.mjs";
import { inspectRepositoryWaivers } from "./waivers.mjs";
import { inspectWritebackQueue, syncRuntimeLinksForRepo } from "./writeback.mjs";
import { inspectGovernanceRecords, syncGovernanceRuntimeArtifacts } from "./governance-records.mjs";
import { inspectGovernanceRegistries, syncGovernanceRegistries } from "./governance-registries.mjs";
import { inspectRuntimeAudit, syncRuntimeAuditArtifacts } from "./runtime-audit.mjs";
import { inspectExternalSkillImports } from "./external-skill-imports.mjs";
import {
  getBuiltInGovernanceSkillDefinitions,
  getBuiltInPlaybookDefinitions,
  getBuiltInPromptCatalogDefinitions,
  getBuiltInSupportSkillDefinitions,
  getBuiltInWorkflowSkillDefinitions,
  loadBuiltInSkillPackManifest,
  readBuiltInSkillPackSourceText
} from "./skill-pack-source.mjs";
import { createBaseConfig, enableModules, loadConfig, saveConfig } from "./config.mjs";
import { ensureSpecnfcGitignore } from "./gitignore.mjs";
import { hashManagedContent, trackManagedFiles } from "./managed-files.mjs";
import { deepMerge } from "../utils/json.mjs";
import { assertPathInsideRoot, ensureDir, isDirectory, listDir, pathExists, readJson, readText, writeJson, writeText } from "../utils/fs.mjs";
import { renderTemplate, toModuleListText } from "../utils/text.mjs";
import { DEFAULT_CHANGE_FILES, inspectChanges } from "../workflow/changes.mjs";
import { inspectIntegrations } from "../workflow/integrations.mjs";

export async function loadManifest(moduleName) {
  const root = getModuleTemplateRoot(moduleName);
  return readJson(path.join(root, "manifest.json"));
}

export async function installModules({
  repoRoot,
  moduleNames,
  profileName = "minimal",
  dryRun = false,
  force = false
}) {
  const packageMeta = await getPackageMeta();
  const repoPaths = getRepoPaths(repoRoot);
  const alreadyInitialized = await pathExists(repoPaths.configPath);

  let config =
    alreadyInitialized && !force
      ? await loadConfig(repoRoot)
      : createBaseConfig({ repoRoot, packageMeta, profileName });
  if (!alreadyInitialized || force) {
    config.repository.profile = profileName;
  }
  config = enableModules(config, moduleNames);

  const context = createRenderContext({
    repoRoot,
    packageMeta,
    config
  });

  const planned = [];
  const created = [];
  const skipped = [];
  const warnings = [];
  const managedHashes = {};

  for (const moduleName of moduleNames) {
    const manifest = await loadManifest(moduleName);
    const templateRoot = getModuleTemplateRoot(moduleName);

    for (const fileEntry of manifest.files) {
      const targetPath = resolvePathWithin(repoRoot, fileEntry.target);
      await assertPathInsideRoot(repoRoot, targetPath);

      if (fileEntry.mode === "ensure-dir") {
        planned.push({ moduleName, mode: "ensure-dir", targetPath, relativeTarget: fileEntry.target });
        if (!dryRun) {
          await ensureDir(targetPath);
        }
        created.push(fileEntry.target);
        continue;
      }

      const targetExists = await pathExists(targetPath);

      if (targetExists && fileEntry.mode === "skip-if-exists" && !force) {
        skipped.push(fileEntry.target);
        warnings.push(`已跳过已存在文件：${fileEntry.target}`);
        continue;
      }

      const sourcePath = resolvePathWithin(templateRoot, fileEntry.source);
      await assertPathInsideRoot(templateRoot, sourcePath);
      const rawSource = await readText(sourcePath);
      const rendered = renderTemplate(rawSource, context);
      planned.push({ moduleName, mode: fileEntry.mode, targetPath, relativeTarget: fileEntry.target });

      if (dryRun) {
        created.push(fileEntry.target);
        continue;
      }

      if (fileEntry.mode === "merge") {
        const templateJson = JSON.parse(rendered);
        const existing = (await pathExists(targetPath)) ? await readJson(targetPath) : {};
        const merged = deepMerge(existing, templateJson);
        await writeJson(targetPath, merged);
        created.push(fileEntry.target);
        continue;
      }

      await writeText(targetPath, rendered);
      created.push(fileEntry.target);
      managedHashes[fileEntry.target] = hashManagedContent(rendered);
    }
  }

  if (!dryRun) {
    await saveConfig(repoRoot, config);
    await buildActiveRules({ repoRoot, persist: true });
    const protocolManagedFiles = await refreshProtocolPlaneFiles({
      repoRoot,
      config,
      dryRun
    });
    const gitignoreSync = await ensureSpecnfcGitignore({ repoRoot, dryRun });
    const coreManagedHashes = await refreshManagedCoreFiles({ repoRoot, config });
    config = trackManagedFiles(config, {
      ...managedHashes,
      ...protocolManagedFiles.tracked,
      ...coreManagedHashes
    });
    await saveConfig(repoRoot, config);
    created.push(...protocolManagedFiles.created);
    if (gitignoreSync.changed) {
      created.push(gitignoreSync.path);
    }
  } else {
    const protocolManagedFiles = await refreshProtocolPlaneFiles({
      repoRoot,
      config,
      dryRun
    });
    const gitignoreSync = await ensureSpecnfcGitignore({ repoRoot, dryRun });
    created.push(...protocolManagedFiles.created);
    if (gitignoreSync.changed) {
      created.push(gitignoreSync.path);
    }
  }

  return {
    alreadyInitialized,
    installedModules: moduleNames,
    created: unique(created),
    skipped: unique(skipped),
    warnings: unique(warnings),
    planned
  };
}

export async function refreshProtocolPlaneFiles({ repoRoot, config, dryRun = false }) {
  const packageVersion = config.specnfc?.templateVersion ?? config.specnfc?.version ?? "0.0.0";
  const repositoryName = config.repository?.name ?? path.basename(repoRoot);
  const enabledModules = getEnabledModuleNames(config).sort();
  const repoPaths = getRepoPaths(repoRoot);
  const tracked = {};
  const created = [];
  const artifacts = await buildProtocolPlaneArtifacts({
    repositoryName,
    packageVersion,
    profileName: config.repository?.profile ?? "minimal",
    enabledModules
  });

  for (const artifact of artifacts) {
    const targetPath = resolvePathWithin(repoRoot, artifact.target);
    await assertPathInsideRoot(repoRoot, targetPath);

    if (artifact.kind === "dir") {
      if (!dryRun) {
        await ensureDir(targetPath);
      }
      created.push(artifact.target);
      continue;
    }

    if (!dryRun) {
      if (artifact.format === "json") {
        await writeJson(targetPath, artifact.content);
      } else {
        await writeText(targetPath, artifact.content);
      }
      tracked[artifact.target] = hashManagedContent(
        artifact.format === "json" ? `${JSON.stringify(artifact.content, null, 2)}\n` : artifact.content
      );
    }

    created.push(artifact.target);
  }

  return {
    tracked,
    created: unique(created)
  };
}

async function buildProtocolPlaneArtifacts({ repositoryName, packageVersion, profileName, enabledModules }) {
  const now = new Date().toISOString();
  const designArtifacts = await loadProtocolDesignSchemaArtifacts();
  const designTargets = designArtifacts.map((item) => item.target);
  const workflowSkills = getWorkflowSkillDefinitions();
  const supportSkills = getSupportSkillDefinitions();
  const governanceSkills = getGovernanceSkillDefinitions();
  const promptCatalog = getPromptCatalogDefinitions();
  const runtimePlaybooks = getRuntimePlaybookDefinitions();
  const sourceManifest = {
    ...loadBuiltInSkillPackManifest(),
    version: packageVersion
  };
  const dirs = [
    ".specnfc/contract",
    ".specnfc/design",
    ".specnfc/indexes",
    ".specnfc/skill-packs",
    ".specnfc/skill-packs/active",
    ".specnfc/skill-packs/active/workflow",
    ".specnfc/skill-packs/active/support",
    ".specnfc/skill-packs/active/governance",
    ".specnfc/skill-packs/active/prompts",
    ".specnfc/skill-packs/active/playbooks",
    ".specnfc/skill-packs/active/templates",
    ".specnfc/projections",
    ".specnfc/projections/agents",
    ".specnfc/projections/claude",
    ".specnfc/projections/trae",
    ".specnfc/projections/opencode",
    ".specnfc/projections/generated",
    ".specnfc/governance/waivers",
    ".specnfc/governance/release-decisions",
    ".specnfc/governance/policies",
    ".specnfc/governance/stage-profiles",
    ".specnfc/governance/approvals",
    ".specnfc/governance/registries",
    ".specnfc/execution",
    ".nfc",
    ".nfc/context",
    ".nfc/interviews/active",
    ".nfc/interviews/archived",
    ".nfc/plans/active",
    ".nfc/plans/archived",
    ".nfc/state",
    ".nfc/logs/sessions",
    ".nfc/logs/actions",
    ".nfc/logs/escalations",
    ".nfc/handoffs/pending",
    ".nfc/handoffs/archived",
    ".nfc/notes",
    ".nfc/specs/derived",
    ".nfc/specs/scratch",
    ".nfc/sync",
    ".nfc/imports"
  ].map((target) => ({ kind: "dir", target }));

  const files = [
    {
      target: ".specnfc/contract/team-contract.ref.json",
      format: "json",
      content: {
        teamId: null,
        protocolVersion: packageVersion,
        skillPackCatalogRef: null,
        policyPackRef: null,
        glossaryRef: null,
        projectRegistryRef: null,
        reviewPolicyRef: null,
        approvalPolicyRef: null,
        releasePolicyRef: null,
        lastSyncedAt: null,
        digest: null,
        registryRefs: {
          policy: ".specnfc/governance/registries/team-policy-registry.json",
          skillPack: ".specnfc/governance/registries/team-skill-pack-registry.json",
          approval: ".specnfc/governance/registries/team-approval-registry.json",
          waiver: ".specnfc/governance/registries/team-waiver-registry.json",
          projectCatalog: ".specnfc/governance/registries/team-project-catalog.json"
        }
      }
    },
    {
      target: ".specnfc/contract/project.ref.json",
      format: "json",
      content: {
        projectId: null,
        teamId: null,
        repoRefs: [],
        sharedDocs: [],
        sharedAcceptanceRefs: [],
        integrationRegistryRef: null,
        activeWorkRefs: [],
        governanceProfile: null,
        requiredApprovalProfiles: [],
        protocolProfile: profileName,
        registryRefs: {
          repo: ".specnfc/governance/registries/project-repo-registry.json",
          integration: ".specnfc/governance/registries/project-integration-registry.json"
        }
      }
    },
    {
      target: ".specnfc/contract/repo.json",
      format: "json",
      content: {
        repoId: repositoryName,
        repoName: repositoryName,
        teamId: null,
        projectId: null,
        protocolVersion: packageVersion,
        governanceMode: "guided",
        activeSkillPack: {
          id: "specnfc-zh-cn-default",
          version: packageVersion,
          locale: "zh-CN"
        },
        entryProjectionVersion: packageVersion,
        runtimeVersion: packageVersion,
        currentProfile: profileName,
        currentStagePolicy: "canonical-v1",
        complianceLevel: "guided"
      }
    },
    {
      target: ".specnfc/contract/stage-machine.json",
      format: "json",
      content: {
        canonicalPhases: ["clarify", "design", "plan", "execute", "verify", "accept", "archive"],
        legacyAliases: {
          draft: "clarify",
          design: "design",
          ready: "plan",
          "in-progress": "execute",
          verifying: "verify",
          handoff: "accept",
          archived: "archive"
        }
      }
    },
    {
      target: ".specnfc/contract/governance-mode.json",
      format: "json",
      content: {
        mode: "guided",
        rules: {
          missingActiveChange: "soft_block_execute",
          missingRequiredSections: "soft_block_stage",
          projectionDrift: "warning",
          skillPackDrift: "warning",
          pendingWriteback: "soft_block_accept"
        },
        waiverPolicy: {
          allow: true,
          storage: ".specnfc/governance/waivers"
        }
      }
    },
    {
      target: ".specnfc/contract/projection-policy.json",
      format: "json",
      content: {
        sourceRefs: [
          ".specnfc/contract/repo.json",
          ".specnfc/contract/stage-machine.json",
          ".specnfc/skill-packs/active/manifest.json",
          ".specnfc/indexes/doc-index.json"
        ],
        generatedFiles: ["AGENTS.md", "CLAUDE.md", ".trae/rules/project_rules.md", "opencode.json"],
        allowManualSections: [],
        protectedBlocks: [],
        driftSeverity: {
          advisory: ["AGENTS.md", "CLAUDE.md"],
          strict: ["opencode.json", ".trae/rules/project_rules.md"]
        },
        regenerationPolicy: "managed",
        conflictPolicy: "preserve-user-edits-and-report"
      }
    },
    {
      target: ".specnfc/contract/skill-pack-policy.json",
      format: "json",
      content: {
        activePack: "specnfc-zh-cn-default",
        refreshStrategy: "snapshot",
        localOverridePolicy: "allow-local-runtime-only",
        driftPolicy: "warn"
      }
    },
    {
      target: ".specnfc/contract/compliance-policy.json",
      format: "json",
      content: {
        defaultMode: "guided",
        releaseRequiresCompliance: true,
        writebackRequiredForAccept: true,
        projectionDriftBlocksRelease: true
      }
    },
    {
      target: ".specnfc/indexes/repo-index.json",
      format: "json",
      content: {
        repoId: repositoryName,
        docs: [".specnfc/README.md", ".specnfc/contract/repo.json", ".specnfc/indexes/project-index.json", ...designTargets, "specs/README.md", "specs/project/README.md", "specs/project/summary.md"],
        modules: enabledModules,
        updatedAt: now
      }
    },
    {
      target: ".specnfc/indexes/project-index.json",
      format: "json",
      content: {
        projectId: repositoryName,
        teamId: null,
        teamContextRefs: [],
        projectDocs: {
          readme: "specs/project/README.md",
          summary: "specs/project/summary.md",
          readingPath: [
            "specs/project/summary.md",
            ".specnfc/indexes/project-index.json",
            ".specnfc/README.md",
            "specs/changes/<change-id>/"
          ]
        },
        changeRefs: [],
        integrationRefs: [],
        latestIterations: [],
        updatedAt: now
      }
    },
    {
      target: ".specnfc/indexes/change-index.json",
      format: "json",
      content: {
        items: [],
        updatedAt: now
      }
    },
    {
      target: ".specnfc/indexes/integration-index.json",
      format: "json",
      content: {
        items: [],
        updatedAt: now
      }
    },
    {
      target: ".specnfc/indexes/doc-index.json",
      format: "json",
      content: {
        repository: [
          ".specnfc/README.md",
          ".specnfc/contract/repo.json",
          ...designTargets,
          ".specnfc/runtime/active-rules.json",
          "specs/README.md",
          "specs/project/README.md",
          "specs/project/summary.md"
        ],
        project: {
          index: ".specnfc/indexes/project-index.json",
          docs: ["specs/project/README.md", "specs/project/summary.md"]
        },
        currentWork: [
          "specs/changes/<change-id>/meta.json",
          "specs/changes/<change-id>/01-需求与方案.md",
          "specs/changes/<change-id>/02-技术设计与选型.md",
          "specs/changes/<change-id>/03-任务计划与执行.md",
          "specs/changes/<change-id>/04-验收与交接.md",
          "specs/changes/<change-id>/runtime-links.json"
        ],
        runtime: [".nfc/README.md", ".nfc/runtime.json", ".nfc/state/runtime-ledger.json", ".nfc/logs/runtime-events.ndjson"],
        updatedAt: now
      }
    },
    {
      target: ".specnfc/indexes/runtime-index.json",
      format: "json",
      content: {
        runtimeRoot: ".nfc",
        trackedDomains: ["context", "interviews", "plans", "state", "logs", "handoffs", "notes", "sync", "imports"],
        auditFiles: [".nfc/state/runtime-ledger.json", ".nfc/logs/runtime-events.ndjson"],
        updatedAt: now
      }
    },
    {
      target: ".specnfc/indexes/handoff-index.json",
      format: "json",
      content: {
        pending: [],
        archived: [],
        updatedAt: now
      }
    },
    {
      target: ".specnfc/skill-packs/active/manifest.json",
      format: "json",
      content: sourceManifest
    },
    {
      target: ".specnfc/projections/generated/manifest.json",
      format: "json",
      content: {
        generatedAt: now,
        files: ["AGENTS.md", "CLAUDE.md", ".trae/rules/project_rules.md", "opencode.json"],
        source: ".specnfc/contract/projection-policy.json"
      }
    },
    {
      target: ".specnfc/execution/current.json",
      format: "json",
      content: {
        currentPhase: "clarify",
        activeChangeRef: null,
        activeIntegrationRef: null,
        updatedAt: now
      }
    },
    {
      target: ".specnfc/execution/active-change.ref.json",
      format: "json",
      content: {
        changeId: null,
        path: null,
        updatedAt: now
      }
    },
    {
      target: ".specnfc/execution/active-integration.ref.json",
      format: "json",
      content: {
        integrationId: null,
        path: null,
        updatedAt: now
      }
    },
    {
      target: ".specnfc/execution/next-step.json",
      format: "json",
      content: {
        currentPhase: "clarify",
        governanceMode: "guided",
        completed: ["repo protocol initialized"],
        missing: ["active change"],
        blocking: [],
        recommendedNext: [
          { type: "cli", value: "specnfc change create <change-id>" },
          { type: "cli", value: "specnfc doctor" }
        ],
        writebackRequired: false,
        projectionDrift: false,
        skillPackDrift: false,
        updatedAt: now
      }
    },
    {
      target: ".specnfc/governance/registries/team-policy-registry.json",
      format: "json",
      content: {
        registryType: "team-policy",
        scope: "team",
        teamId: null,
        policyPackRef: null,
        reviewPolicyRef: null,
        approvalPolicyRef: null,
        releasePolicyRef: null,
        glossaryRef: null,
        governanceMode: "guided",
        stagePolicyPath: ".specnfc/contract/stage-machine.json",
        updatedAt: now
      }
    },
    {
      target: ".specnfc/governance/registries/team-skill-pack-registry.json",
      format: "json",
      content: {
        registryType: "team-skill-pack",
        scope: "team",
        teamId: null,
        skillPackCatalogRef: null,
        activeSkillPackId: "specnfc-zh-cn-default",
        activeSkillPackManifestPath: ".specnfc/skill-packs/active/manifest.json",
        runtimeSkillAccess: {
          mode: "source-only",
          sourceRoot: ".specnfc/skill-packs/active",
          runtimeMirrorRoot: null
        },
        builtInSourceRoot: "skill-packs/specnfc-zh-cn-default",
        capabilityParityMatrixPath: "skill-packs/specnfc-zh-cn-default/capability-parity-matrix.md",
        externalImportRoot: ".nfc/imports",
        updatedAt: now
      }
    },
    {
      target: ".specnfc/governance/registries/team-approval-registry.json",
      format: "json",
      content: {
        registryType: "team-approval",
        scope: "team",
        teamId: null,
        requiredApprovalProfiles: [],
        releaseDecisionRoot: ".specnfc/governance/release-decisions",
        changeApprovalEvidenceRoot: "specs/changes/<change-id>/evidence/approvals",
        integrationApprovalEvidenceRoot: "specs/integrations/<integration-id>/evidence/approvals",
        updatedAt: now
      }
    },
    {
      target: ".specnfc/governance/registries/team-waiver-registry.json",
      format: "json",
      content: {
        registryType: "team-waiver",
        scope: "team",
        teamId: null,
        waiverRoot: ".specnfc/governance/waivers",
        waiverCatalogRef: null,
        activeWaiverCount: 0,
        updatedAt: now
      }
    },
    {
      target: ".specnfc/governance/registries/team-project-catalog.json",
      format: "json",
      content: {
        registryType: "team-project-catalog",
        scope: "team",
        teamId: null,
        projectRegistryRef: null,
        projects: [],
        updatedAt: now
      }
    },
    {
      target: ".specnfc/governance/registries/project-repo-registry.json",
      format: "json",
      content: {
        registryType: "project-repo",
        scope: "project",
        projectId: repositoryName,
        teamId: null,
        repos: [],
        updatedAt: now
      }
    },
    {
      target: ".specnfc/governance/registries/project-integration-registry.json",
      format: "json",
      content: {
        registryType: "project-integration",
        scope: "project",
        projectId: repositoryName,
        teamId: null,
        integrationRegistryRef: null,
        integrations: [],
        integrationCount: 0,
        changeRefCount: 0,
        updatedAt: now
      }
    },
    {
      target: ".nfc/README.md",
      format: "text",
      content: [
        "# nfc 运行时",
        "",
        "`.nfc/` 是 `specnfc` 的中文运行时与协作层，用于承载访谈、计划、中间稿、日志、handoff 与 writeback 队列。",
        "",
        "它服务于正式协议推进，但不替代 `.specnfc/` 和 `specs/` 下的正式文档。"
      ].join("\n") + "\n"
    },
    {
      target: "specs/project/README.md",
      format: "text",
      content: buildProjectReadmeDocument()
    },
    {
      target: "specs/project/summary.md",
      format: "text",
      content: buildProjectSummaryDocument({
        repositoryName,
        profileName,
        packageVersion,
        now
      })
    },
    {
      target: ".nfc/runtime.json",
      format: "json",
      content: {
        runtimeVersion: packageVersion,
        locale: "zh-CN",
        root: ".nfc",
        governanceMode: "guided",
        writebackTargetRoot: "specs",
        skillAccess: {
          mode: "source-only",
          sourceRoot: ".specnfc/skill-packs/active",
          runtimeMirrorRoot: null,
          externalImportRoot: ".nfc/imports"
        },
        updatedAt: now
      }
    },
    {
      target: ".nfc/notes/priority.md",
      format: "text",
      content: "# Priority Notes\n\n"
    },
    {
      target: ".nfc/notes/working.md",
      format: "text",
      content: "# Working Notes\n\n"
    },
    {
      target: ".nfc/notes/manual.md",
      format: "text",
      content: "# Manual Notes\n\n"
    },
    {
      target: ".nfc/state/current-mode.json",
      format: "json",
      content: {
        mode: "guided",
        updatedAt: now
      }
    },
    {
      target: ".nfc/state/current-stage.json",
      format: "json",
      content: {
        phase: "clarify",
        updatedAt: now
      }
    },
    {
      target: ".nfc/state/runtime-locks.json",
      format: "json",
      content: {
        locks: [],
        updatedAt: now
      }
    },
    {
      target: ".nfc/state/session-hints.json",
      format: "json",
      content: {
        hints: ["先读 .specnfc/README.md", "先创建或进入当前 change"],
        updatedAt: now
      }
    },
    {
      target: ".nfc/state/governance-index.json",
      format: "json",
      content: {
        runtimeRoot: ".nfc",
        recordCounts: {
          review: 0,
          approval: 0,
          verification: 0,
          waiver: 0,
          releaseDecision: 0
        },
        targets: [],
        updatedAt: now
      }
    },
    {
      target: ".nfc/state/runtime-ledger.json",
      format: "json",
      content: {
        status: "empty",
        runtimeRoot: ".nfc",
        sessionTrace: {
          mode: "guided",
          currentPhase: "clarify",
          activeChangeId: null,
          activeIntegrationId: null,
          hintCount: 2,
          activeLockCount: 0,
          updatedAt: now
        },
        governance: {
          status: "empty",
          recordCounts: {
            review: 0,
            approval: 0,
            verification: 0,
            waiver: 0,
            releaseDecision: 0,
            total: 0
          },
          invalidCount: 0
        },
        writeback: {
          status: "clean",
          pendingCount: 0,
          historyCount: 0,
          targetDocs: [],
          lastSyncedAt: null
        },
        stageDecisions: {
          decisionCount: 0,
          approvedCount: 0,
          latest: []
        },
        evidenceRefs: {
          totalRefs: 0,
          uniqueRefCount: 0,
          sampleRefs: [],
          latestRefs: []
        },
        runtimeLinks: {
          trackedTargetCount: 0,
          changeTargetCount: 0,
          integrationTargetCount: 0,
          pendingTargetCount: 0,
          pendingDocCount: 0,
          pendingDocs: []
        },
        eventStreams: {
          governanceEventCount: 0,
          runtimeEventCount: 0
        },
        updatedAt: now
      }
    },
    {
      target: ".nfc/sync/pending-writeback.json",
      format: "json",
      content: {
        items: [],
        updatedAt: now
      }
    },
    {
      target: ".nfc/sync/writeback-history.json",
      format: "json",
      content: {
        items: [],
        updatedAt: now
      }
    },
    {
      target: ".nfc/logs/governance-events.ndjson",
      format: "text",
      content: ""
    },
    {
      target: ".nfc/logs/runtime-events.ndjson",
      format: "text",
      content: ""
    }
  ].map((item) => ({ kind: "file", ...item }));

  const skillArtifacts = [
    ...workflowSkills.map((skill) => ({
      kind: "file",
      target: `.specnfc/skill-packs/active/workflow/${skill.slug}.md`,
      format: "text",
      content: readSkillPackSourceDocument(skill.sourcePath, { fallback: buildWorkflowSkillDocument(skill) })
    })),
    ...supportSkills.map((skill) => ({
      kind: "file",
      target: `.specnfc/skill-packs/active/support/${skill.slug}.md`,
      format: "text",
      content: readSkillPackSourceDocument(skill.sourcePath, { fallback: buildSupportSkillDocument(skill) })
    })),
    ...governanceSkills.map((skill) => ({
      kind: "file",
      target: `.specnfc/skill-packs/active/governance/${skill.slug}.md`,
      format: "text",
      content: readSkillPackSourceDocument(skill.sourcePath, { fallback: buildGovernanceSkillDocument(skill) })
    })),
    ...promptCatalog.map((prompt) => ({
      kind: "file",
      target: `.specnfc/skill-packs/active/prompts/${prompt.slug}.md`,
      format: "text",
      content: readSkillPackSourceDocument(prompt.sourcePath, { fallback: buildPromptCatalogDocument(prompt) })
    })),
    ...runtimePlaybooks.map((playbook) => ({
      kind: "file",
      target: `.specnfc/skill-packs/active/playbooks/${playbook.slug}.md`,
      format: "text",
      content: readSkillPackSourceDocument(playbook.sourcePath)
    }))
  ];

  return [...dirs, ...files, ...skillArtifacts, ...designArtifacts];
}

async function loadProtocolDesignSchemaArtifacts() {
  const designRoot = resolvePathWithin(PROJECT_ROOT, ".specnfc/design");
  if (!(await pathExists(designRoot))) {
    return [];
  }

  const entries = (await listDir(designRoot)).filter((item) => item.endsWith(".json")).sort();
  const artifacts = [];

  for (const entry of entries) {
    const sourcePath = resolvePathWithin(designRoot, entry);
    await assertPathInsideRoot(PROJECT_ROOT, sourcePath);
    artifacts.push({
      kind: "file",
      target: `.specnfc/design/${entry}`,
      format: "json",
      content: await readJson(sourcePath)
    });
  }

  return artifacts;
}

export async function inspectRepository(repoRoot) {
  const repoPaths = getRepoPaths(repoRoot);
  const initialized = await pathExists(repoPaths.configPath);

  if (!initialized) {
    return {
      initialized: false,
      installedModules: [],
      healthy: [],
      missing: [],
      risks: [],
      runtimeRules: null,
      repositoryAdvisories: [],
      controlPlane: null
    };
  }

  let config;
  try {
    config = await loadConfig(repoRoot);
  } catch (error) {
    return {
      initialized: true,
      profile: null,
      installedModules: [],
      healthy: [],
      missing: [],
      risks: [
        {
          code: "INVALID_CONFIG",
          message: error instanceof Error ? `配置文件无法解析：${error.message}` : "配置文件无法解析"
        }
      ],
      changes: {
        active: 0,
        archived: 0
      },
      runtimeRules: null,
      repositoryAdvisories: [],
      controlPlane: null
    };
  }

  const installedModules = Object.entries(config.modules)
    .filter(([, meta]) => meta.enabled)
    .map(([name]) => name);

  await syncRuntimeLinksForRepo({ repoRoot });

  const healthy = [];
  const missing = [];
  const risks = [];

  for (const moduleName of installedModules) {
    const manifest = await loadManifest(moduleName);
    for (const fileEntry of manifest.files) {
      const targetPath = resolvePathWithin(repoRoot, fileEntry.target);
      await assertPathInsideRoot(repoRoot, targetPath);
      if (fileEntry.mode === "ensure-dir") {
        if (await isDirectory(targetPath)) {
          healthy.push(fileEntry.target);
        } else {
          missing.push(fileEntry.target);
        }
        continue;
      }

      if (await pathExists(targetPath)) {
        healthy.push(fileEntry.target);
      } else {
        missing.push(fileEntry.target);
      }
    }
  }

  for (const moduleName of installedModules) {
    if (!MODULES[moduleName]) {
      risks.push({
        code: "INVALID_CONFIG",
        message: `配置中存在未识别模块：${moduleName}`
      });
    }
  }

  if (config.modules.governance?.enabled) {
    const governancePath = resolvePathWithin(repoRoot, ".specnfc/governance");
    if (!(await pathExists(governancePath))) {
      risks.push({
        code: "DRIFT_DETECTED",
        message: "配置已启用 governance，但治理层目录不存在"
      });
    }
  }

  const entryPolicyReport = await inspectEntryPolicies({
    repoPaths,
    governanceEnabled: Boolean(config.modules.governance?.enabled)
  });
  risks.push(...entryPolicyReport.risks);

  const changeReport = await inspectChanges({ repoRoot });
  const integrationReport = await inspectIntegrations({ repoRoot });
  const runtimeRules = await buildActiveRules({ repoRoot });
  const repositoryAdvisories = await inspectRepositoryAdvisories({ repoRoot, runtimeRules, config });
  const projectMemory = await inspectProjectMemory({
    repoRoot,
    repoPaths,
    installedModules
  });
  const projectIndex = await inspectProjectIndex({
    repoRoot,
    repoPaths
  });
  const governanceRecords = await inspectGovernanceRecords({
    repoRoot,
    repoPaths
  });
  const externalSkillImports = await inspectExternalSkillImports({
    repoRoot,
    repoPaths
  });
  const governanceMode = await readRepositoryGovernanceMode(repoRoot, "guided");
  await syncGovernanceRegistries({
    repoRoot,
    repoPaths,
    config,
    projectIndex,
    integrations: integrationReport.integrations,
    governanceMode,
    governanceRecords,
    createMissing: false
  });
  const governanceRegistries = await inspectGovernanceRegistries({
    repoRoot,
    repoPaths
  });
  const controlPlane = await inspectControlPlane({
    repoRoot,
    repoPaths,
    config,
    entryPolicyReport,
    governanceRegistries
  });
  const waivers = await inspectRepositoryWaivers({
    repoRoot,
    issues: collectRepositoryWaiverIssues({ controlPlane })
  });
  healthy.push(...integrationReport.healthy);
  missing.push(...changeReport.missing);
  missing.push(...integrationReport.missing);
  risks.push(...changeReport.risks);
  risks.push(...integrationReport.risks);
  const nextStepProtocol = await readNextStepProtocol({ repoRoot });
  const compliance = buildComplianceReport({
    controlPlane,
    risks,
    missing: unique(missing).sort(),
    repositoryAdvisories,
    projectMemory,
    projectIndex,
    governanceRegistries,
    externalSkillImports,
    waivers,
    governanceRecords
  });
  await syncGovernanceRuntimeArtifacts({
    repoRoot,
    repoPaths,
    governanceRecords
  });
  let runtimeAudit = await inspectRuntimeAudit({
    repoRoot,
    repoPaths,
    governanceRecords
  });
  runtimeAudit = await syncRuntimeAuditArtifacts({
    repoRoot,
    repoPaths,
    runtimeAudit
  });
  controlPlane.runtimeAuditStatus = runtimeAudit.status;
  controlPlane.runtimeLedgerPath = ".nfc/state/runtime-ledger.json";
  controlPlane.runtimeEventCount = runtimeAudit.eventStreams?.runtimeEventCount ?? 0;

  return {
    initialized: true,
    profile: config.repository?.profile || "minimal",
    installedModules,
    healthy: unique(healthy).sort(),
    missing: unique(missing).sort(),
    risks,
    changes: {
      active: changeReport.changes.length,
      archived: await countDirectories(repoPaths.archiveRoot),
      delivery: summarizeDelivery(changeReport.changes),
      maturity: summarizeMaturity(changeReport.changes)
    },
    integrations: summarizeIntegrations(integrationReport.integrations),
    integrationDependencies: summarizeIntegrationDependencies(changeReport.changes),
    releaseReadiness: summarizeReleaseReadiness({
      changes: changeReport.changes,
      repositoryRisks: risks,
      repositoryAdvisories,
      compliance
    }),
    runtimeRules: summarizeRuntimeRules(runtimeRules),
    repositoryAdvisories,
    projectMemory,
    projectIndex,
    governanceRecords,
    governanceRegistries,
    externalSkillImports,
    runtimeAudit,
    controlPlane,
    nextStepProtocol,
    compliance
  };
}

export async function readGuide(moduleName) {
  const templateRoot = getModuleTemplateRoot(moduleName);
  return readText(resolvePathWithin(templateRoot, "guide.md"));
}

export async function refreshManagedCoreFiles({ repoRoot, config }) {
  const templateRoot = getModuleTemplateRoot("core");
  const context = createRenderContext({
    repoRoot,
    packageMeta: { version: config.specnfc?.version || config.specnfc?.templateVersion || "" },
    config
  });
  const managedHashes = {};
  const managedFiles = [
    {
      source: "files/.specnfc/README.md",
      target: ".specnfc/README.md"
    },
    {
      source: "files/AGENTS.md",
      target: "AGENTS.md"
    },
    {
      source: "files/CLAUDE.md",
      target: "CLAUDE.md"
    },
    {
      source: "files/opencode.json",
      target: "opencode.json"
    },
    {
      source: "files/.trae/rules/project_rules.md",
      target: ".trae/rules/project_rules.md"
    }
  ];

  for (const file of managedFiles) {
    const template = await readText(resolvePathWithin(templateRoot, file.source));
    const rendered = renderTemplate(template, context);
    const targetPath = resolvePathWithin(repoRoot, file.target);
    await assertPathInsideRoot(repoRoot, targetPath);
    await writeText(targetPath, rendered);
    managedHashes[file.target] = hashManagedContent(rendered);
  }

  return managedHashes;
}

function createRenderContext({ repoRoot, packageMeta, config }) {
  const enabledModules = getEnabledModuleNames(config);
  const requiredReadPaths = buildRequiredReadPaths(enabledModules);
  const optionalModuleDocs = getOptionalModuleDocs(enabledModules);
  const preflightCommands = buildPreflightCommands(enabledModules);

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
    requiredReadListMarkdown: toOrderedList(requiredReadPaths),
    requiredReadSentence: toChineseJoin(requiredReadPaths.map((item) => `\`${item}\``)),
    preflightCommandListMarkdown: preflightCommands.map((item) => `- \`${item}\``).join("\n"),
    preflightCommandSentence: toChineseJoin(preflightCommands.map((item) => `\`${item}\``)),
    memoryIndexBlock: renderProjectMemoryIndexMarkdown(buildProjectMemoryIndex(enabledModules)),
    optionalReadBlock: buildOptionalReadBlock(optionalModuleDocs),
    optionalReadLine: buildOptionalReadLine(optionalModuleDocs),
    moduleGuideListMarkdown: buildModuleGuideListMarkdown(enabledModules),
    opencodeInstructionsJson: JSON.stringify(buildOpencodeInstructions(enabledModules), null, 2)
  };
}

function buildProjectReadmeDocument() {
  return [
    '# 项目层文档入口',
    '',
    '## 作用',
    '`specs/project/` 用于承载项目层正式摘要、项目索引入口和迭代汇总。',
    '',
    '## 固定文件',
    '- `specs/project/README.md`：项目层文档导航与维护规则。',
    '- `specs/project/summary.md`：项目总览、迭代结果、风险与下一步。',
    '- `.specnfc/indexes/project-index.json`：机器可读的项目级索引。',
    '',
    '## 维护规则',
    '1. `specnfc init / upgrade` 自动创建或补齐。',
    '2. `status / doctor` 读取并汇总该目录的关键信息。',
    '3. `change / integration` 的关键结果需要回流到项目层摘要。',
    '',
    '## 读取建议',
    '1. 先读 `specs/project/summary.md`。',
    '2. 再读 `.specnfc/indexes/project-index.json`。',
    '3. 再按需进入具体 `change / integration` dossier。',
    '',
    '## 边界说明',
    '- 本目录不替代 `.specnfc/` control plane。',
    '- 本目录不承载 `.nfc/` 运行时草稿。',
    '- 团队级上下文只做 ref / digest / path 引用。',
    ''
  ].join('\n');
}

function buildProjectSummaryDocument({ repositoryName, profileName, packageVersion, now }) {
  return [
    '# 项目汇总',
    '',
    '## 项目标识',
    `- 项目 ID：${repositoryName}`,
    '- 团队标识：待绑定',
    `- 协议版本：${packageVersion}`,
    '',
    '## 协议概况',
    `- 当前仓档位：${profileName}`,
    '- 当前治理模式：guided',
    '- 当前主阶段：clarify',
    '',
    '## 团队级上下文引用',
    '- 来源索引：待绑定',
    '- 文档索引 / 摘要路径：待绑定',
    '- 最新 digest：待绑定',
    '',
    '## 当前仓与模块',
    `- 当前仓：${repositoryName}`,
    '- 已启用模块：由 status / doctor 自动汇总',
    '',
    '## 活跃 Change 摘要',
    '- 当前活跃 change：当前无',
    '- 最近完成 change：当前无',
    '',
    '## 活跃 Integration 摘要',
    '- 当前活跃 integration：当前无',
    '- 关键依赖 / 阻断：当前无',
    '',
    '## 最近迭代结果',
    '- 迭代结果摘要：当前无',
    '- 关键交付物：当前无',
    '- 关键决策：当前无',
    '',
    '## 风险与阻断',
    '- 当前风险：当前无',
    '- 当前阻断：当前无',
    '',
    '## 下一步',
    '- 推荐下一步：运行 `specnfc change create <change-id>` 创建第一项 change',
    '- 待补写回：当前无',
    '',
    `> 初始化时间：${now}`
  ].join('\n');
}

const REQUIRED_PROJECT_SUMMARY_SECTIONS = [
  "项目标识",
  "协议概况",
  "团队级上下文引用",
  "活跃 Change 摘要",
  "最近迭代结果",
  "风险与阻断",
  "下一步"
];

const PROJECT_SUMMARY_PLACEHOLDER_MARKERS = [
  "- 团队标识：待绑定",
  "- 来源索引：待绑定",
  "- 文档索引 / 摘要路径：待绑定",
  "- 最新 digest：待绑定",
  "- 已启用模块：由 status / doctor 自动汇总"
];

function unique(items) {
  return Array.from(new Set(items));
}

function toRelative(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath).split(path.sep).join("/");
}

function getEnabledModuleNames(config) {
  return Object.entries(config.modules)
    .filter(([, meta]) => meta.enabled)
    .map(([name]) => name);
}

function buildRequiredReadPaths(enabledModules) {
  const items = [".specnfc/README.md", ".specnfc/runtime/active-rules.json", ".specnfc/indexes/project-index.json", "specs/README.md", "specs/project/summary.md"];

  if (enabledModules.includes("context")) {
    items.push(".specnfc/context/");
  }

  if (enabledModules.includes("execution")) {
    items.push(".specnfc/execution/");
  }

  if (enabledModules.includes("governance")) {
    items.push(".specnfc/governance/");
  }

  items.push("specs/changes/<change-id>/");
  return items;
}

function buildPreflightCommands(enabledModules) {
  const items = ["specnfc status --json", "specnfc change check <change-id>"];

  if (enabledModules.includes("integration-contract")) {
    items.push("specnfc integration check <integration-id>");
  }

  return items;
}

function getOptionalModuleDocs(enabledModules) {
  const items = [];

  if (enabledModules.includes("design-api")) {
    items.push({
      label: "接口设计",
      path: ".specnfc/design/api/"
    });
  }

  if (enabledModules.includes("design-db")) {
    items.push({
      label: "数据库设计",
      path: ".specnfc/design/db/"
    });
  }

  if (enabledModules.includes("quality")) {
    items.push({
      label: "质量与测试",
      path: ".specnfc/quality/"
    });
  }

  if (enabledModules.includes("delivery")) {
    items.push({
      label: "交付与集成",
      path: ".specnfc/delivery/"
    });
  }

  if (enabledModules.includes("integration-contract")) {
    items.push({
      label: "多人对接",
      path: ".specnfc/integration-contract/"
    });
  }

  return items;
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

function buildProjectMemoryIndex(enabledModules) {
  const repositoryMemory = [
    { label: "仓级总览", paths: [".specnfc/README.md"] },
    { label: "当前生效规则", paths: [".specnfc/runtime/active-rules.json"] },
    { label: "项目层入口与索引", paths: [".specnfc/indexes/project-index.json", "specs/project/README.md"] },
    { label: "项目总览与迭代汇总", paths: ["specs/project/summary.md"] }
  ];

  if (enabledModules.includes("context")) {
    repositoryMemory.push({ label: "系统定位与外部边界", paths: [".specnfc/context/system.md"] });
    repositoryMemory.push({ label: "架构边界与禁改区", paths: [".specnfc/context/architecture.md"] });
    repositoryMemory.push({ label: "领域术语与业务规则", paths: [".specnfc/context/domain.md"] });
    repositoryMemory.push({ label: "编码、测试与协作约束", paths: [".specnfc/context/coding-rules.md"] });
  }

  if (enabledModules.includes("governance")) {
    repositoryMemory.push({ label: "裁决点与高风险边界", paths: [".specnfc/governance/decision-gates.md"] });
    repositoryMemory.push({ label: "安全边界", paths: [".specnfc/governance/security-boundaries.md"] });
    repositoryMemory.push({ label: "风险分级", paths: [".specnfc/governance/risk-matrix.md"] });
    repositoryMemory.push({ label: "个人 Skills 边界", paths: [".specnfc/governance/personal-skills.md"] });
  }

  const currentWorkMemory = [
    { label: "当前 change 结构化事实", paths: ["specs/changes/<change-id>/meta.json"] },
    {
      label: "change 需求与方案",
      paths: ["specs/changes/<change-id>/01-需求与方案.md", "specs/changes/<change-id>/02-技术设计与选型.md"]
    },
    {
      label: "change 执行与交付",
      paths: ["specs/changes/<change-id>/03-任务计划与执行.md", "specs/changes/<change-id>/04-验收与交接.md"]
    }
  ];

  if (enabledModules.includes("integration-contract")) {
    currentWorkMemory.push({
      label: "当前 integration 契约与状态",
      paths: [
        "specs/integrations/<integration-id>/contract.md",
        "specs/integrations/<integration-id>/decisions.md",
        "specs/integrations/<integration-id>/status.md"
      ]
    });
  }

  return {
    repository: repositoryMemory,
    currentWork: currentWorkMemory,
    precedence: [
      {
        label: "入口文件只负责导航，不替代正式文档",
        paths: ["AGENTS.md", "CLAUDE.md", ".trae/rules/project_rules.md"]
      },
      {
        label: "信息冲突时优先级",
        paths: [".specnfc 正式规则 / 治理边界 > 当前 change / integration 正式文件 > 入口提示文案"]
      }
    ]
  };
}

function renderProjectMemoryIndexMarkdown(index) {
  return [
    "### 仓级长期事实",
    ...index.repository.map((item) => `- ${item.label}：${item.paths.map((pathItem) => `\`${pathItem}\``).join("、")}`),
    "",
    "### 当前变更 / 对接事实",
    ...index.currentWork.map((item) => `- ${item.label}：${item.paths.map((pathItem) => `\`${pathItem}\``).join("、")}`),
    "",
    "### 读取顺序与冲突处理",
    ...index.precedence.map((item) => `- ${item.label}：${item.paths.map((pathItem) => `\`${pathItem}\``).join("、")}`)
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

  if (enabledModules.includes("context")) {
    items.push("- 阅读 `.specnfc/context/README.md` 与 `.specnfc/context/AGENT.md`");
  }

  if (enabledModules.includes("execution")) {
    items.push("- 阅读 `.specnfc/execution/README.md` 与 `.specnfc/execution/AGENT.md`");
  }

  if (enabledModules.includes("governance")) {
    items.push("- 阅读 `.specnfc/governance/README.md` 与 `.specnfc/governance/AGENT.md`");
  }

  if (enabledModules.includes("design-api")) {
    items.push("- 涉及接口契约时，阅读 `.specnfc/design/api/README.md` 与 `.specnfc/design/api/AGENT.md`");
  }

  if (enabledModules.includes("design-db")) {
    items.push("- 涉及数据库变更时，阅读 `.specnfc/design/db/README.md` 与 `.specnfc/design/db/AGENT.md`");
  }

  if (enabledModules.includes("quality")) {
    items.push("- 涉及测试补齐、回归和发布验证时，阅读 `.specnfc/quality/README.md` 与 `.specnfc/quality/AGENT.md`");
  }

  if (enabledModules.includes("delivery")) {
    items.push("- 涉及 Git 提交、推送和交付约束时，阅读 `.specnfc/delivery/README.md` 与 `.specnfc/delivery/AGENT.md`");
  }

  if (enabledModules.includes("integration-contract")) {
    items.push("- 涉及多人接口 / service 对接时，阅读 `.specnfc/integration-contract/README.md` 与 `.specnfc/integration-contract/AGENT.md`");
  }

  if (!items.length) {
    items.push("- 当前只启用 `core`，如需统一上下文、执行和治理，运行 `specnfc add context execution governance`");
  }

  return items.join("\n");
}

function buildOpencodeInstructions(enabledModules) {
  const instructions = ["AGENTS.md", ".specnfc/README.md", ".specnfc/runtime/active-rules.json", ".specnfc/indexes/project-index.json", "specs/README.md", "specs/project/**/*.md"];

  if (enabledModules.includes("context")) {
    instructions.push(".specnfc/context/**/*.md");
  }

  if (enabledModules.includes("execution")) {
    instructions.push(".specnfc/execution/**/*.md");
  }

  if (enabledModules.includes("governance")) {
    instructions.push(".specnfc/governance/**/*.md");
  }

  if (enabledModules.includes("design-api")) {
    instructions.push(".specnfc/design/api/**/*.md");
  }

  if (enabledModules.includes("design-db")) {
    instructions.push(".specnfc/design/db/**/*.md");
  }

  if (enabledModules.includes("quality")) {
    instructions.push(".specnfc/quality/**/*.md");
  }

  if (enabledModules.includes("delivery")) {
    instructions.push(".specnfc/delivery/**/*.md");
  }

  if (enabledModules.includes("integration-contract")) {
    instructions.push(".specnfc/integration-contract/**/*.md");
    instructions.push("specs/integrations/**/*.md");
  }

  instructions.push("specs/changes/**/*.md");
  return instructions;
}

function toOrderedList(items) {
  return items.map((item, index) => `${index + 1}. \`${item}\``).join("\n");
}

function toChineseJoin(items) {
  if (!items.length) {
    return "";
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} 和 ${items[1]}`;
  }

  return `${items.slice(0, -1).join("、")} 和 ${items.at(-1)}`;
}

async function countDirectories(rootPath) {
  if (!(await pathExists(rootPath))) {
    return 0;
  }

  const names = await listDir(rootPath);
  let count = 0;

  for (const name of names) {
    if (await isDirectory(path.join(rootPath, name))) {
      count += 1;
    }
  }

  return count;
}

function summarizeDelivery(changes) {
  const summary = {
    enabled: 0,
    ready: 0,
    prepared: 0,
    archived: 0,
    missing: 0,
    out_of_sync: 0,
    blocked: []
  };

  for (const change of changes) {
    const delivery = change.delivery;
    if (!delivery?.enabled) {
      continue;
    }

    summary.enabled += 1;
    if (delivery.status in summary) {
      summary[delivery.status] += 1;
    }

    if (delivery.action && delivery.action !== "当前无") {
      summary.blocked.push({
        id: change.id,
        action: delivery.action
      });
    }
  }

  return summary;
}

function summarizeMaturity(changes) {
  const summary = {
    ready: 0,
    draft: 0,
    incomplete: 0,
    implementation: 0,
    handoff: 0,
    archived: 0,
    broken: 0,
    unknown: 0,
    blocked: [],
    gapSummary: {},
    priority: []
  };

  for (const change of changes) {
    const maturity = change.maturity;
    if (!maturity) {
      continue;
    }

    if (maturity.status in summary) {
      summary[maturity.status] += 1;
    }

    for (const gap of maturity.gaps || []) {
      if (!gap?.code) {
        continue;
      }
      summary.gapSummary[gap.code] = (summary.gapSummary[gap.code] || 0) + 1;
    }

    if (maturity.action && maturity.action !== "当前无") {
      summary.blocked.push({
        id: change.id,
        action: maturity.action
      });

      summary.priority.push({
        id: change.id,
        title: change.title,
        status: maturity.status,
        action: maturity.action,
        gaps: maturity.gaps || []
      });
    }
  }

  summary.priority.sort((left, right) => {
    const statusDiff = getMaturityPriorityWeight(left.status) - getMaturityPriorityWeight(right.status);
    if (statusDiff !== 0) {
      return statusDiff;
    }

    const gapDiff = (right.gaps?.length || 0) - (left.gaps?.length || 0);
    if (gapDiff !== 0) {
      return gapDiff;
    }

    return String(left.id).localeCompare(String(right.id));
  });
  summary.priority = summary.priority.slice(0, 5);

  return summary;
}

function getMaturityPriorityWeight(status) {
  switch (status) {
    case "broken":
      return 0;
    case "draft":
      return 1;
    case "incomplete":
      return 2;
    case "implementation":
      return 3;
    case "handoff":
      return 4;
    case "ready":
      return 5;
    case "archived":
      return 6;
    default:
      return 7;
  }
}

function summarizeIntegrations(integrations) {
  const summary = {
    total: 0,
    draft: 0,
    aligned: 0,
    implementing: 0,
    integrating: 0,
    blocked: 0,
    done: 0,
    ready: 0,
    unknown: 0,
    blockedItems: [],
    blockedAffectedChanges: []
  };

  for (const integration of integrations ?? []) {
    summary.total += 1;

    if (integration.status in summary) {
      summary[integration.status] += 1;
    } else {
      summary.unknown += 1;
    }

    if (["aligned", "implementing", "integrating", "done"].includes(integration.status)) {
      summary.ready += 1;
    }

    if (shouldTreatIntegrationAsBlocked(integration)) {
      summary.blockedItems.push({
        id: integration.id,
        status: integration.status,
        action: integration.action,
        changes: integration.changes || []
      });
      summary.blockedAffectedChanges.push(...(integration.changes || []));
    }
  }

  summary.blockedAffectedChanges = unique(summary.blockedAffectedChanges).sort();
  return summary;
}

function shouldTreatIntegrationAsBlocked(integration) {
  return (
    integration?.status === "blocked" ||
    Boolean(integration?.missing?.length) ||
    Boolean(integration?.risks?.length)
  );
}

function summarizeIntegrationDependencies(changes) {
  const refs = new Set();
  const blockedRefs = new Set();
  const changesWithRefs = new Set();
  const changesBlockedByIntegration = new Set();

  for (const change of changes ?? []) {
    for (const ref of change.integrations?.refs || []) {
      refs.add(ref);
      changesWithRefs.add(change.id);
    }

    for (const blocked of change.integrations?.blocked || []) {
      if (blocked?.id) {
        blockedRefs.add(blocked.id);
      }
      changesBlockedByIntegration.add(change.id);
    }
  }

  return {
    totalRefs: refs.size,
    changesWithRefs: Array.from(changesWithRefs).sort(),
    changesWithRefsCount: changesWithRefs.size,
    blockedIntegrationRefs: Array.from(blockedRefs).sort(),
    blockedIntegrationRefCount: blockedRefs.size,
    changesBlockedByIntegration: Array.from(changesBlockedByIntegration).sort(),
    changesBlockedByIntegrationCount: changesBlockedByIntegration.size
  };
}

function summarizeReleaseReadiness({ changes, repositoryRisks, repositoryAdvisories, compliance }) {
  const handoffReadyChanges = [];
  const blockedChanges = [];
  const blockedIntegrationRefs = new Set();
  const repositoryProtocolBlockers = [];

  for (const change of changes ?? []) {
    if (["verifying", "handoff"].includes(change.stage)) {
      handoffReadyChanges.push(change.id);
    }

    if ((change.risks?.length || 0) > 0 || (change.missing?.length || 0) > 0) {
      blockedChanges.push(change.id);
    }

    for (const blocked of change.integrations?.blocked || []) {
      if (blocked?.id) {
        blockedIntegrationRefs.add(blocked.id);
      }
    }
  }

  for (const issue of compliance?.blockingIssues || []) {
    if (issue.startsWith("CONTROL_PLANE_MISSING") || issue.startsWith("WAIVER_INVALID") || issue.startsWith("WAIVER_EXPIRED")) {
      repositoryProtocolBlockers.push(issue);
    }
  }

  for (const issue of compliance?.advisoryIssues || []) {
    if (issue === "PROJECTION_DRIFT" || issue.startsWith("SKILL_PACK_")) {
      repositoryProtocolBlockers.push(issue);
    }
  }

  const blockerCount =
    unique(blockedChanges).length +
    blockedIntegrationRefs.size +
    (repositoryRisks?.length || 0) +
    repositoryProtocolBlockers.length;

  return {
    status: blockerCount > 0 ? "blocked" : handoffReadyChanges.length ? "ready" : "not_ready",
    handoffReadyChanges: unique(handoffReadyChanges).sort(),
    handoffReadyChangeCount: unique(handoffReadyChanges).length,
    blockedChanges: unique(blockedChanges).sort(),
    blockedChangeCount: unique(blockedChanges).length,
    blockedIntegrationRefs: Array.from(blockedIntegrationRefs).sort(),
    blockedIntegrationRefCount: blockedIntegrationRefs.size,
    repositoryRiskCount: repositoryRisks?.length || 0,
    repositoryProtocolBlockers: Array.from(new Set(repositoryProtocolBlockers)).sort(),
    repositoryProtocolBlockerCount: Array.from(new Set(repositoryProtocolBlockers)).length,
    advisoryCount: repositoryAdvisories?.length || 0,
    blockerCount
  };
}

function summarizeRuntimeRules(runtimeRules) {
  if (!runtimeRules) {
    return null;
  }

  return {
    path: runtimeRules.path,
    enabledModules: runtimeRules.enabledModules,
    blockingScopes: runtimeRules.blockingScopes,
    advisoryScopes: runtimeRules.advisoryScopes,
    blockingCount: runtimeRules.summary?.blockingCount ?? runtimeRules.blockingRules?.length ?? 0,
    advisoryCount: runtimeRules.summary?.advisoryCount ?? runtimeRules.advisoryRules?.length ?? 0
  };
}

async function inspectControlPlane({ repoRoot, repoPaths, config, entryPolicyReport, governanceRegistries }) {
  const governanceMode = await readRepositoryGovernanceMode(repoRoot, "guided");
  const designSchemaTargets = await loadProtocolDesignSchemaTargets();
  const checks = {
    contract: [
      ".specnfc/contract/repo.json",
      ".specnfc/contract/stage-machine.json",
      ".specnfc/contract/governance-mode.json",
      ".specnfc/contract/projection-policy.json"
    ],
    design: designSchemaTargets,
    indexes: [
      ".specnfc/indexes/repo-index.json",
      ".specnfc/indexes/change-index.json",
      ".specnfc/indexes/integration-index.json",
      ".specnfc/indexes/doc-index.json",
      ".specnfc/indexes/runtime-index.json",
      ".specnfc/indexes/handoff-index.json"
    ],
    skillPack: getSkillPackArtifactTargets(),
    governanceRegistries: [
      ".specnfc/governance/registries/team-policy-registry.json",
      ".specnfc/governance/registries/team-skill-pack-registry.json",
      ".specnfc/governance/registries/team-approval-registry.json",
      ".specnfc/governance/registries/team-waiver-registry.json",
      ".specnfc/governance/registries/team-project-catalog.json",
      ".specnfc/governance/registries/project-repo-registry.json",
      ".specnfc/governance/registries/project-integration-registry.json"
    ],
    execution: [
      ".specnfc/execution/current.json",
      ".specnfc/execution/next-step.json"
    ],
    runtime: [".nfc/README.md", ".nfc/runtime.json", ...getRuntimeArtifactTargets()]
  };

  const result = {};
  let missingTotal = 0;

  for (const [key, targets] of Object.entries(checks)) {
    const missing = [];

    for (const target of targets) {
      const targetPath = resolvePathWithin(repoRoot, target);
      if (!(await pathExists(targetPath))) {
        missing.push(target);
      }
    }

    missingTotal += missing.length;
    result[key] = {
      status: missing.length ? "partial" : "complete",
      requiredCount: targets.length,
      missingCount: missing.length,
      missing
    };
  }

  const skillPackManifestPath = resolvePathWithin(repoRoot, ".specnfc/skill-packs/active/manifest.json");
  let skillPackStatus = "missing";
  if (await pathExists(skillPackManifestPath)) {
    try {
      const manifest = await readJson(skillPackManifestPath);
      skillPackStatus =
        manifest?.id === "specnfc-zh-cn-default" &&
        manifest?.version === (config.specnfc?.templateVersion ?? config.specnfc?.version ?? "")
          ? "synced"
          : "drifted";
    } catch {
      skillPackStatus = "invalid";
    }
  }

  const writebackQueue = await inspectWritebackQueue({ repoRoot });
  const runtimeSyncStatus = writebackQueue.status;
  const pendingWritebackCount = writebackQueue.count;

  return {
    status: missingTotal ? "partial" : "complete",
    repoContractPath: ".specnfc/contract/repo.json",
    governanceMode,
    activeSkillPack: "specnfc-zh-cn-default",
    projectionStatus: entryPolicyReport?.summary?.status ?? "unknown",
    projectionHealth: entryPolicyReport?.summary ?? {
      status: "unknown",
      checkedCount: 0,
      missingCount: 0,
      driftCount: 0,
      invalidCount: 0,
      items: []
    },
    skillPackStatus,
    runtimeSyncStatus,
    pendingWritebackCount,
    writebackTargets: writebackQueue.targetDocs,
    writebackItems: writebackQueue.items,
    governanceRegistryStatus: governanceRegistries?.status ?? "unknown",
    governanceRegistryCount: governanceRegistries?.requiredCount ?? 0,
    governanceRegistryMissingCount: governanceRegistries?.missingCount ?? 0,
    nfcRuntimeRoot: ".nfc",
    missingCount: missingTotal,
    checks: result
  };
}

async function loadProtocolDesignSchemaTargets() {
  const artifacts = await loadProtocolDesignSchemaArtifacts();
  return artifacts.map((item) => item.target);
}

function getWorkflowSkillDefinitions() {
  return getBuiltInWorkflowSkillDefinitions();
}

function getSupportSkillDefinitions() {
  return getBuiltInSupportSkillDefinitions();
}

function getGovernanceSkillDefinitions() {
  return getBuiltInGovernanceSkillDefinitions();
}

function getPromptCatalogDefinitions() {
  return getBuiltInPromptCatalogDefinitions();
}

function getRuntimePlaybookDefinitions() {
  return getBuiltInPlaybookDefinitions();
}

function getSkillPackArtifactTargets() {
  return [
    ".specnfc/skill-packs/active/manifest.json",
    ...getWorkflowSkillDefinitions().map((item) => `.specnfc/skill-packs/active/workflow/${item.slug}.md`),
    ...getSupportSkillDefinitions().map((item) => `.specnfc/skill-packs/active/support/${item.slug}.md`),
    ...getGovernanceSkillDefinitions().map((item) => `.specnfc/skill-packs/active/governance/${item.slug}.md`),
    ...getPromptCatalogDefinitions().map((item) => `.specnfc/skill-packs/active/prompts/${item.slug}.md`),
    ...getRuntimePlaybookDefinitions().map((item) => `.specnfc/skill-packs/active/playbooks/${item.slug}.md`)
  ];
}

function getRuntimeArtifactTargets() {
  return [
    ".nfc/state/runtime-ledger.json",
    ".nfc/logs/runtime-events.ndjson",
    ".nfc/logs/governance-events.ndjson",
    ".nfc/state/current-mode.json",
    ".nfc/state/current-stage.json",
    ".nfc/state/runtime-locks.json",
    ".nfc/state/session-hints.json",
    ".nfc/sync/pending-writeback.json",
    ".nfc/sync/writeback-history.json"
  ];
}

function buildWorkflowSkillDocument(skill) {
  return [
    `# 工作流技能：${skill.name}（${skill.slug}）`,
    "",
    `- canonical phase：\`${skill.phase}\``,
    `- 触发条件：${skill.trigger}`,
    "",
    "## 全局阶段顺序",
    "- 唯一正式顺序：`clarify → design → plan → execute → verify → accept → archive`",
    "- 未完成上游阶段，不得跳过进入下游阶段。",
    "- 所有正式开发、验证、交付动作必须绑定当前 change / integration dossier。",
    "",
    "## 前置条件",
    ...skill.prerequisites.map((item) => `- ${item}`),
    "",
    "## 输入",
    ...skill.inputs.map((item) => `- ${item}`),
    "",
    "## 输出",
    ...skill.outputs.map((item) => `- ${item}`),
    "",
    "## 阶段门禁",
    "### 必需文档",
    ...skill.gate.requiredDocs.map((item) => `- ${item}`),
    "",
    "### 必需证据",
    ...(skill.gate.requiredEvidence.length ? skill.gate.requiredEvidence.map((item) => `- ${item}`) : ["- 当前无硬性证据要求"]),
    "",
    "### 阻断条件",
    ...skill.gate.blocking.map((item) => `- ${item}`),
    "",
    "### 完成判定",
    ...skill.gate.completeWhen.map((item) => `- ${item}`),
    "",
    "## 必须写入的正式文档",
    ...skill.writebacks.map((item) => `- ${item}`),
    "",
    "## writeback 规则",
    `- 队列：\`${skill.writebackPolicy.queue}\``,
    `- 历史：\`${skill.writebackPolicy.history}\``,
    `- 阶段退出前必须完成写回：${skill.writebackPolicy.requiredBeforeStageExit ? "是" : "否"}`,
    "",
    "## 运行时对象",
    ...skill.runtimeObjects.map((item) => `- ${item}`),
    "",
    "## 建议 CLI",
    `- \`${skill.cli}\``,
    "",
    "## 完成后必须输出",
    "1. 当前阶段",
    "2. 已完成",
    "3. 缺失 / 阻断",
    "4. 推荐下一步",
    "5. 是否需要 writeback",
    "6. 是否存在 projection / skill-pack drift",
    "",
    "## 治理模式差异",
    "- advisory：提示为主，不直接阻断。",
    "- guided：缺正式文档或关键 section 时给出强提示。",
    "- strict：缺 gate 或未写回时可软阻断阶段推进。",
    "- locked：不得绕过当前阶段与正式 dossier。"
  ].join("\n") + "\n";
}

function buildSupportSkillDocument(skill) {
  return [
    `# 辅助技能：${skill.name}（${skill.slug}）`,
    "",
    `- 分类：${skill.category}`,
    `- 目的：${skill.purpose}`,
    "",
    "## 触发条件",
    `- ${skill.trigger}`,
    "",
    "## 前置条件",
    ...skill.prerequisites.map((item) => `- ${item}`),
    "",
    "## 输出",
    ...skill.outputs.map((item) => `- ${item}`),
    "",
    "## 默认写入",
    ...skill.writebacks.map((item) => `- ${item}`),
    "",
    "## 建议 CLI",
    `- \`${skill.recommendedCli}\``,
    "",
    "## 共通规则",
    "- 不得替代 `.specnfc/` 与正式 dossier 的真相源地位。",
    "- 若生成运行时中间稿，必须登记 writeback 目标。",
    "- 输出结尾必须补一段“推荐下一步”。",
    "- 在 strict / locked 模式下，行为纪律类技能未完成时不得跳过进入下游阶段。"
  ].join("\n") + "\n";
}

function buildGovernanceSkillDocument(skill) {
  return [
    `# 治理技能：${skill.name}（${skill.slug}）`,
    "",
    `- layer：${skill.layer || "governance"}`,
    `- namespace：${skill.namespace || "specnfc.official"}`,
    `- trust-tier：${skill.trustTier || "governed"}`,
    `- trigger：${skill.trigger}`,
    "",
    "## prerequisites",
    ...(skill.prerequisites || []).map((item) => `- ${item}`),
    "",
    "## outputs",
    ...(skill.outputs || []).map((item) => `- ${item}`),
    "",
    "## writebacks",
    ...(skill.writebacks || []).map((item) => `- ${item}`),
    "",
    "## evidence-required",
    ...((skill.evidenceRequired || []).length ? skill.evidenceRequired.map((item) => `- ${item}`) : ["- 当前无"]),
    "",
    "## record-types",
    ...((skill.recordTypes || []).length ? skill.recordTypes.map((item) => `- ${item}`) : ["- 当前无"]),
    "",
    "## hard-gate",
    ...((skill.hardGate || []).length ? skill.hardGate.map((item) => `- ${item}`) : ["- 当前无"]),
    "",
    "## allowed-next",
    ...((skill.allowedNext || []).length ? skill.allowedNext.map((item) => `- ${item}`) : ["- 当前无"]),
    "",
    "## block-on-failure",
    `- ${skill.blockOnFailure ? "是" : "否"}`,
    "",
    "## conflict-resolution",
    `- ${skill.conflictResolution || "正式 record 优先"}`
  ].join("\n") + "\n";
}

function buildPromptCatalogDocument(prompt) {
  return [
    `# ${prompt.name}`,
    "",
    "## 使用目的",
    "- 为中文 `nfc` skill-pack 提供稳定的角色 / 阶段 / 辅助提示词目录。",
    "- 提示词服务于当前阶段推进，不得自建独立流程真相。",
    "",
    "## 目录条目",
    ...prompt.entries.map((item) => `- ${item}`),
    "",
    "## 共通输出要求",
    "- 当前阶段",
    "- 已完成",
    "- 缺失 / 阻断",
    "- 推荐下一步",
    "- 是否需要 writeback",
    "- 是否存在 projection / skill-pack drift"
  ].join("\n") + "\n";
}

function buildRuntimeSkillDocument({ kind, sourcePath, title, body }) {
  return [
    `# nfc 运行时镜像：${title}`,
    "",
    `- 类型：${kind}`,
    `- canonical source：\`${sourcePath}\``,
    "- 本文件供运行时直接读取；正式定义仍以 `.specnfc/skill-packs/active/` 下的版本为准。",
    "",
    "## 使用约束",
    "- 执行前先确认当前阶段与正式 dossier。",
    "- 运行中间稿先进入 `.nfc`，正式结论必须按 writeback 规则回写。",
    "- 不得绕过 `.specnfc/execution/next-step.json` 与阶段 gate。",
    "",
    "## 内容快照",
    "",
    body.trimEnd()
  ].join("\n") + "\n";
}

function buildRuntimePlaybookDocument(playbook) {
  return [
    `# 运行时 Playbook：${playbook.name}`,
    "",
    "## 最小执行步骤",
    ...playbook.steps.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## 共通约束",
    "- 正式真相源始终是 `.specnfc/` 与 `specs/`。",
    "- playbook 只能指导执行，不得取代阶段门禁。",
    "- 需要写回时必须更新 `.nfc/sync/*`。"
  ].join("\n") + "\n";
}

function readSkillPackSourceDocument(sourcePath, { fallback = "" } = {}) {
  if (!sourcePath) {
    return typeof fallback === "string" ? fallback : "";
  }

  try {
    return readBuiltInSkillPackSourceText(sourcePath);
  } catch {
    return typeof fallback === "string" ? fallback : "";
  }
}

function buildWorkflowSkillManifestEntry(skill) {
  return {
    slug: skill.slug,
    name: skill.name,
    phase: skill.phase,
    trigger: skill.trigger,
    prerequisites: skill.prerequisites,
    inputs: skill.inputs,
    outputs: skill.outputs,
    recommendedCli: skill.cli,
    writebacks: skill.writebacks,
    runtimeObjects: skill.runtimeObjects,
    gate: skill.gate,
    writebackPolicy: skill.writebackPolicy
  };
}

function buildSupportSkillManifestEntry(skill) {
  return {
    slug: skill.slug,
    name: skill.name,
    category: skill.category,
    purpose: skill.purpose,
    trigger: skill.trigger,
    prerequisites: skill.prerequisites,
    outputs: skill.outputs,
    writebacks: skill.writebacks,
    recommendedCli: skill.recommendedCli
  };
}

function buildPromptCatalogManifestEntry(prompt) {
  return {
    slug: prompt.slug,
    name: prompt.name,
    entries: prompt.entries
  };
}

function buildPhaseCoverage(workflowSkills) {
  const coverage = {};

  for (const skill of workflowSkills) {
    if (!coverage[skill.phase]) {
      coverage[skill.phase] = [];
    }
    coverage[skill.phase].push(skill.slug);
  }

  return coverage;
}

async function readNextStepProtocol({ repoRoot }) {
  const targetPath = resolvePathWithin(repoRoot, ".specnfc/execution/next-step.json");
  if (!(await pathExists(targetPath))) {
    return null;
  }

  try {
    return await readJson(targetPath);
  } catch {
    return null;
  }
}

function buildComplianceReport({
  controlPlane,
  risks,
  missing,
  repositoryAdvisories,
  projectMemory,
  projectIndex,
  governanceRegistries,
  externalSkillImports,
  waivers,
  governanceRecords
}) {
  const blockingIssues = [];
  const rawAdvisoryIssues = [];

  if (controlPlane?.missingCount) {
    blockingIssues.push(`CONTROL_PLANE_MISSING:${controlPlane.missingCount}`);
  }
  if (controlPlane?.projectionStatus === "drifted") {
    rawAdvisoryIssues.push("PROJECTION_DRIFT");
  }
  if (controlPlane?.skillPackStatus && controlPlane.skillPackStatus !== "synced") {
    rawAdvisoryIssues.push(`SKILL_PACK_${controlPlane.skillPackStatus.toUpperCase()}`);
  }
  if (controlPlane?.runtimeSyncStatus === "pending") {
    rawAdvisoryIssues.push("RUNTIME_WRITEBACK_PENDING");
    for (const targetDoc of controlPlane?.writebackTargets || []) {
      rawAdvisoryIssues.push(`RUNTIME_WRITEBACK_TARGET:${targetDoc}`);
    }
  } else if (controlPlane?.runtimeSyncStatus === "invalid") {
    blockingIssues.push("RUNTIME_WRITEBACK_INVALID");
  }
  for (const item of risks || []) {
    blockingIssues.push(`${item.code}:${item.message}`);
  }
  for (const item of repositoryAdvisories || []) {
    rawAdvisoryIssues.push(`${item.code}:${item.message}`);
  }
  for (const item of projectMemory?.advisories || []) {
    rawAdvisoryIssues.push(`${item.code}:${item.message}`);
  }
  for (const item of projectIndex?.advisories || []) {
    rawAdvisoryIssues.push(`${item.code}:${item.message}`);
  }
  for (const item of governanceRegistries?.advisories || []) {
    rawAdvisoryIssues.push(`${item.code}:${item.message}`);
  }
  for (const item of externalSkillImports?.advisories || []) {
    const issue = `${item.code}:${item.message}`;
    if (
      item.code === "EXTERNAL_SKILL_IMPORT_INVALID" ||
      item.code === "EXTERNAL_SKILL_SECURITY_POLICY_VIOLATION" ||
      item.code === "EXTERNAL_SKILL_RETENTION_EXPIRED" ||
      item.code === "EXTERNAL_SKILL_GOVERNED_PENDING_WRITEBACK"
    ) {
      blockingIssues.push(issue);
    } else {
      rawAdvisoryIssues.push(issue);
    }
  }
  if ((waivers?.invalidCount || 0) > 0) {
    blockingIssues.push(`WAIVER_INVALID:${waivers.invalidCount}`);
  }
  if ((waivers?.expiredCount || 0) > 0) {
    blockingIssues.push(`WAIVER_EXPIRED:${waivers.expiredCount}`);
  }
  if ((governanceRecords?.invalidCount || 0) > 0) {
    blockingIssues.push(`GOVERNANCE_INVALID:${governanceRecords.invalidCount}`);
  }

  const waivedIssueCodes = new Set(waivers?.appliedIssueCodes || []);
  const advisoryIssues = rawAdvisoryIssues.filter((issue) => !waivedIssueCodes.has(issue));

  const complianceLevel = blockingIssues.length ? "blocking" : advisoryIssues.length ? "advisory" : "clean";

  return {
    scope: "repository",
    complianceLevel,
    blockingIssues: Array.from(new Set(blockingIssues)),
    advisoryIssues: Array.from(new Set(advisoryIssues)),
    waivers: {
      status: waivers?.status ?? "clean",
      directoryPresent: waivers?.directoryPresent ?? false,
      totalCount: waivers?.totalCount ?? 0,
      validCount: waivers?.validCount ?? 0,
      expiredCount: waivers?.expiredCount ?? 0,
      invalidCount: waivers?.invalidCount ?? 0,
      activeWaiverIds: waivers?.activeWaiverIds ?? [],
      appliedIssueCodes: waivers?.appliedIssueCodes ?? []
    },
    missingDocs: missing,
    projectionStatus: controlPlane?.projectionStatus ?? "unknown",
    stageStatus: controlPlane?.status ?? "unknown",
    runtimeSyncStatus: controlPlane?.runtimeSyncStatus ?? "unknown",
    writebackTargets: controlPlane?.writebackTargets ?? [],
    recommendedActions: buildComplianceRecommendedActions({ complianceLevel, blockingIssues, advisoryIssues }),
    generatedAt: new Date().toISOString()
  };
}

function collectRepositoryWaiverIssues({ controlPlane }) {
  const issues = [];

  if (controlPlane?.projectionStatus === "drifted") {
    issues.push({
      scope: "repository",
      target: "projectionStatus",
      code: "PROJECTION_DRIFT"
    });
  }

  if (controlPlane?.skillPackStatus && controlPlane.skillPackStatus !== "synced") {
    issues.push({
      scope: "repository",
      target: "skillPackStatus",
      code: `SKILL_PACK_${controlPlane.skillPackStatus.toUpperCase()}`
    });
  }

  if (controlPlane?.runtimeSyncStatus === "pending") {
    issues.push({
      scope: "repository",
      target: "runtimeSyncStatus",
      code: "RUNTIME_WRITEBACK_PENDING"
    });
  }

  return issues;
}

function buildComplianceRecommendedActions({ complianceLevel, blockingIssues, advisoryIssues }) {
  const actions = [];

  if (blockingIssues.some((item) => item.startsWith("CONTROL_PLANE_MISSING"))) {
    actions.push("运行 `specnfc upgrade` 补齐 control-plane 文件后，再运行 `specnfc doctor`");
  }

  if (blockingIssues.some((item) => item.startsWith("WAIVER_INVALID"))) {
    actions.push("修复 `.specnfc/governance/waivers/` 下的无效 waiver JSON 后，再运行 `specnfc doctor`");
  }

  if (blockingIssues.some((item) => item.startsWith("WAIVER_EXPIRED"))) {
    actions.push("续期或删除 `.specnfc/governance/waivers/` 下已过期 waiver 后，再运行 `specnfc doctor`");
  }

  if (blockingIssues.some((item) => item.startsWith("GOVERNANCE_INVALID"))) {
    actions.push("修复治理记录 JSON、scope/target 或关联引用后，再运行 `specnfc doctor`");
  }

  if (blockingIssues.some((item) => item.startsWith("EXTERNAL_SKILL_IMPORT_INVALID"))) {
    actions.push("修复 `.nfc/imports/<run-id>/` 下缺失或损坏的导入结构后，再重新运行 `specnfc doctor`");
  }

  if (blockingIssues.some((item) => item.startsWith("EXTERNAL_SKILL_GOVERNED_PENDING_WRITEBACK"))) {
    actions.push("先完成 governed 外部 skill 导入物的正式写回，再重新运行 `specnfc doctor` 或执行发布");
  }

  if (blockingIssues.some((item) => item.startsWith("EXTERNAL_SKILL_RETENTION_EXPIRED"))) {
    actions.push("清理或续期已过保留期的 `.nfc/imports/<run-id>/security-label.json` 后，再重新运行 `specnfc doctor`");
  }

  if (blockingIssues.some((item) => item.startsWith("EXTERNAL_SKILL_SECURITY_POLICY_VIOLATION"))) {
    actions.push("处理外部 skill 导入物的敏感信息留存问题，必要时改为脱敏摘要后再继续");
  }

  if (advisoryIssues.includes("PROJECTION_DRIFT")) {
    actions.push("优先检查 `AGENTS.md`、`CLAUDE.md`、`.trae/rules/project_rules.md`、`opencode.json` 的漂移；必要时运行 `specnfc upgrade`");
  }

  if (advisoryIssues.some((item) => item.startsWith("SKILL_PACK_"))) {
    actions.push("检查 `.specnfc/skill-packs/active/manifest.json` 与 skill-pack 主文档是否漂移；必要时运行 `specnfc upgrade`");
  }

  if (advisoryIssues.includes("RUNTIME_WRITEBACK_PENDING")) {
    actions.push("先处理 `.nfc/sync/pending-writeback.json` 中待回写项，再重新运行 `specnfc doctor`");
  }

  if (blockingIssues.some((item) => item.startsWith("RUNTIME_WRITEBACK_INVALID"))) {
    actions.push("修复 `.nfc/sync/pending-writeback.json` 的 JSON 结构或重建该文件后，再重新运行 `specnfc doctor`");
  }

  if (advisoryIssues.some((item) => item.startsWith("PROJECT_MEMORY_"))) {
    actions.push("补齐入口索引与项目长期事实文档后，再重新运行 `specnfc doctor`");
  }

  if (advisoryIssues.some((item) => item.startsWith("PROJECT_INDEX_") || item.startsWith("PROJECT_DOC_"))) {
    actions.push("补齐 `project-index.json` 与 `specs/project/summary.md` 后，再重新运行 `specnfc doctor`");
  }

  if (advisoryIssues.some((item) => item.startsWith("PROJECT_SUMMARY_"))) {
    actions.push("补齐 `specs/project/summary.md` 的必填章节与实际项目内容后，再重新运行 `specnfc doctor`");
  }

  if (advisoryIssues.some((item) => item.startsWith("GOVERNANCE_REGISTRY_"))) {
    actions.push("补齐 `.specnfc/governance/registries/` 下的团队 / 项目注册中心文件后，再重新运行 `specnfc doctor`");
  }

  if (advisoryIssues.some((item) => item.startsWith("REPOSITORY_DOC_"))) {
    actions.push("补齐仓级长期文档正式内容后，再重新运行 `specnfc doctor`");
  }

  if (advisoryIssues.some((item) => item.startsWith("CHANGE_STRUCTURE_DRIFT"))) {
    actions.push("运行 `specnfc upgrade` 将 `.specnfc/config.json` 的 change 结构升级到 3.1 四主文档，或手动修正 `defaults.changeStructure`");
  }

  if (complianceLevel === "blocking") {
    actions.push("先修复 blocking issues 后再推进阶段或发布");
    actions.push("运行 `specnfc doctor` 复查协议状态");
    return Array.from(new Set(actions));
  }
  if (advisoryIssues.length) {
    actions.push("按 advisory issues 补齐投影、记忆或运行时写回");
    actions.push("运行 `specnfc status` 查看下一步建议");
    return Array.from(new Set(actions));
  }
  return ["当前仓协议状态健康，可继续推进当前阶段"];
}

async function inspectRepositoryAdvisories({ repoRoot, runtimeRules, config }) {
  const advisories = [];
  advisories.push(...inspectConfiguredChangeStructure(repoRoot, config));
  const advisorySources = Array.from(
    new Set(
      (runtimeRules?.advisoryRules ?? [])
        .filter((rule) => rule.scope === "repository")
        .map((rule) => rule.source)
        .filter(Boolean)
    )
  );

  for (const source of advisorySources) {
    const targetPath = resolvePathWithin(repoRoot, source);
    await assertPathInsideRoot(repoRoot, targetPath);

    if (!(await pathExists(targetPath))) {
      continue;
    }

    if (await isDirectory(targetPath)) {
      const markdownFiles = await collectMarkdownFiles(targetPath);
      for (const filePath of markdownFiles) {
        advisories.push(...(await inspectRepositoryDoc({ repoRoot, targetPath: filePath })));
      }
      continue;
    }

    if (targetPath.endsWith(".md")) {
      advisories.push(...(await inspectRepositoryDoc({ repoRoot, targetPath })));
    }
  }

  return uniqueRepositoryAdvisories(advisories);
}

function inspectConfiguredChangeStructure(repoRoot, config) {
  const structure = Array.isArray(config?.defaults?.changeStructure) ? config.defaults.changeStructure : [];
  if (!structure.length || isCanonicalChangeStructure(structure)) {
    return [];
  }

  return [
    {
      code: "CHANGE_STRUCTURE_DRIFT",
      file: ".specnfc/config.json",
      message: `defaults.changeStructure 仍为非 3.1 四主文档结构：${structure.join("、")}`,
      action: "运行 `specnfc upgrade` 或手动修正 `.specnfc/config.json` 中的 defaults.changeStructure"
    }
  ];
}

function isCanonicalChangeStructure(structure) {
  return (
    structure.length === DEFAULT_CHANGE_FILES.length &&
    structure.every((fileName, index) => fileName === DEFAULT_CHANGE_FILES[index])
  );
}

async function inspectProjectMemory({ repoRoot, repoPaths, installedModules }) {
  const index = buildProjectMemoryIndex(installedModules);
  const advisories = [];

  const entryChecks = [
    {
      path: repoPaths.agentsPath,
      file: "AGENTS.md",
      markers: ["## 项目记忆索引", ".specnfc/README.md", "specs/project/summary.md", "specs/changes/<change-id>/meta.json"]
    },
    {
      path: repoPaths.claudePath,
      file: "CLAUDE.md",
      markers: ["项目记忆索引如下", ".specnfc/README.md", "specs/project/summary.md", "specs/changes/<change-id>/01-需求与方案.md"]
    },
    {
      path: repoPaths.traeRulesPath,
      file: ".trae/rules/project_rules.md",
      markers: ["## 项目记忆索引", ".specnfc/README.md", "specs/project/summary.md", "change 需求与方案"]
    }
  ];

  const entrySummary = {
    checked: [],
    missing: [],
    drifted: []
  };

  for (const check of entryChecks) {
    entrySummary.checked.push(check.file);
    if (!(await pathExists(check.path))) {
      entrySummary.missing.push(check.file);
      advisories.push({
        code: "PROJECT_MEMORY_ENTRY_MISSING",
        file: check.file,
        message: `${check.file} 缺少项目记忆入口，Agent 可能无法快速定位项目事实`,
        action: "补齐入口文件并重新生成项目记忆索引"
      });
      continue;
    }

    const content = await readText(check.path);
    const missingMarkers = check.markers.filter((marker) => !content.includes(marker));
    if (missingMarkers.length) {
      entrySummary.drifted.push(check.file);
      advisories.push({
        code: "PROJECT_MEMORY_INDEX_MISSING",
        file: check.file,
        message: `${check.file} 缺少项目记忆索引或关键索引项，Agent 读取路径可能不完整`,
        action: "运行 `specnfc upgrade` 或手工补齐项目记忆索引"
      });
    }
  }

  const repositoryPaths = unique(
    index.repository
      .flatMap((item) => item.paths)
      .filter((item) => !item.includes("<change-id>") && !item.includes("<integration-id>"))
  );
  const repositorySummary = {
    checked: repositoryPaths,
    missing: [],
    placeholders: []
  };

  for (const relativePath of repositoryPaths) {
    const targetPath = resolvePathWithin(repoRoot, relativePath);
    if (!(await pathExists(targetPath))) {
      repositorySummary.missing.push(relativePath);
      advisories.push({
        code: "PROJECT_MEMORY_DOC_MISSING",
        file: relativePath,
        message: `项目长期记忆文档缺失：${relativePath}`,
        action: "补齐项目长期记忆对应的正式文档"
      });
      continue;
    }

    if (targetPath.endsWith(".md")) {
      const content = await readText(targetPath);
      if (containsRepositoryPlaceholder(content)) {
        repositorySummary.placeholders.push(relativePath);
        advisories.push({
          code: "PROJECT_MEMORY_DOC_PLACEHOLDER",
          file: relativePath,
          message: `项目长期记忆文档仍是占位内容：${relativePath}`,
          action: "补齐项目长期记忆正式内容"
        });
      }
    }
  }

  let opencode = {
    status: "missing",
    missing: []
  };
  if (await pathExists(repoPaths.opencodePath)) {
    try {
      const opencodeConfig = await readJson(repoPaths.opencodePath);
      const instructions = Array.isArray(opencodeConfig.instructions) ? opencodeConfig.instructions : [];
      const requiredInstructions = [".specnfc/README.md", ".specnfc/runtime/active-rules.json", ".specnfc/indexes/project-index.json", "specs/project/**/*.md", "specs/changes/**/*.md"];
      if (installedModules.includes("context")) requiredInstructions.push(".specnfc/context/**/*.md");
      if (installedModules.includes("governance")) requiredInstructions.push(".specnfc/governance/**/*.md");
      if (installedModules.includes("integration-contract")) requiredInstructions.push("specs/integrations/**/*.md");
      const missingInstructions = requiredInstructions.filter((item) => !instructions.includes(item));
      opencode = {
        status: missingInstructions.length ? "partial" : "complete",
        missing: missingInstructions
      };
      for (const item of missingInstructions) {
        advisories.push({
          code: "PROJECT_MEMORY_OPENCODE_INDEX_MISSING",
          file: "opencode.json",
          message: `opencode.json 缺少项目记忆相关指令：${item}`,
          action: "同步 OpenCode 入口指令，确保能读取项目记忆来源"
        });
      }
    } catch {
      opencode = {
        status: "invalid",
        missing: []
      };
    }
  }

  const status = advisories.length
    ? entrySummary.missing.length || repositorySummary.missing.length ? "missing" : "partial"
    : "complete";

  return {
    status,
    index,
    coverage: {
      repositoryFactCount: repositorySummary.checked.length,
      repositoryFactMissingCount: repositorySummary.missing.length,
      repositoryFactPlaceholderCount: repositorySummary.placeholders.length,
      entryFileCheckedCount: entrySummary.checked.length,
      entryFileMissingCount: entrySummary.missing.length,
      entryFileDriftCount: entrySummary.drifted.length,
      opencodeMissingInstructionCount: opencode.missing.length
    },
    entryIndex: {
      status: entrySummary.missing.length ? "missing" : entrySummary.drifted.length ? "partial" : "complete",
      checkedCount: entrySummary.checked.length,
      missing: entrySummary.missing,
      drifted: entrySummary.drifted
    },
    repositoryFacts: {
      status: repositorySummary.missing.length ? "missing" : repositorySummary.placeholders.length ? "partial" : "complete",
      checkedCount: repositorySummary.checked.length,
      missing: repositorySummary.missing,
      placeholders: repositorySummary.placeholders
    },
    opencode,
    advisoryCount: advisories.length,
    advisories
  };
}

async function inspectProjectIndex({ repoRoot, repoPaths }) {
  const advisories = [];
  const missing = [];
  const files = [
    { path: repoPaths.projectIndexPath, label: '.specnfc/indexes/project-index.json' },
    { path: repoPaths.projectReadmePath, label: 'specs/project/README.md' },
    { path: repoPaths.projectSummaryPath, label: 'specs/project/summary.md' }
  ];

  for (const file of files) {
    if (!(await pathExists(file.path))) {
      missing.push(file.label);
      advisories.push({
        code: file.label.endsWith('.json') ? 'PROJECT_INDEX_MISSING' : 'PROJECT_DOC_MISSING',
        file: file.label,
        message: `项目层固定文件缺失：${file.label}`,
        action: '运行 `specnfc upgrade` 或补齐 project-level canonical path'
      });
    }
  }

  let index = null;
  let summaryContract = {
    status: "unknown",
    requiredSections: [...REQUIRED_PROJECT_SUMMARY_SECTIONS],
    missingSections: [],
    placeholderMarkers: []
  };
  if (await pathExists(repoPaths.projectIndexPath)) {
    try {
      index = await readJson(repoPaths.projectIndexPath);
    } catch {
      advisories.push({
        code: 'PROJECT_INDEX_INVALID',
        file: '.specnfc/indexes/project-index.json',
        message: 'project-index.json 无法解析',
        action: '修复 project-index.json 的 JSON 结构后重新运行 `specnfc doctor`'
      });
    }
  }

  if (index) {
    if (index?.projectDocs?.readme !== 'specs/project/README.md' || index?.projectDocs?.summary !== 'specs/project/summary.md') {
      advisories.push({
        code: 'PROJECT_INDEX_PATH_DRIFT',
        file: '.specnfc/indexes/project-index.json',
        message: 'project-index.json 中的 canonical path 与约定不一致',
        action: '修复 project-index.json 中的 projectDocs.readme / summary 指向'
      });
    }

    if (!Array.isArray(index?.projectDocs?.readingPath) || !index.projectDocs.readingPath.length) {
      advisories.push({
        code: 'PROJECT_INDEX_READING_PATH_MISSING',
        file: '.specnfc/indexes/project-index.json',
        message: 'project-index.json 缺少 readingPath，AI agent 无法按需读取项目摘要',
        action: '补齐 project-index.json 的 projectDocs.readingPath'
      });
    }
  }

  if (await pathExists(repoPaths.projectSummaryPath)) {
    const projectSummaryContent = await readText(repoPaths.projectSummaryPath);
    summaryContract = inspectProjectSummaryContent(projectSummaryContent);
    advisories.push(...summaryContract.advisories);
  } else {
    summaryContract = {
      status: "missing",
      requiredSections: [...REQUIRED_PROJECT_SUMMARY_SECTIONS],
      missingSections: [...REQUIRED_PROJECT_SUMMARY_SECTIONS],
      placeholderMarkers: []
    };
  }

  const status = advisories.length ? (missing.length === files.length ? 'missing' : 'partial') : 'complete';

  return {
    status,
    indexPath: '.specnfc/indexes/project-index.json',
    summaryPath: 'specs/project/summary.md',
    readmePath: 'specs/project/README.md',
    projectId: index?.projectId ?? null,
    teamId: index?.teamId ?? null,
    teamContextRefCount: index?.teamContextRefs?.length ?? 0,
    changeRefCount: index?.changeRefs?.length ?? 0,
    integrationRefCount: index?.integrationRefs?.length ?? 0,
    latestIterationCount: index?.latestIterations?.length ?? 0,
    readingPath: index?.projectDocs?.readingPath ?? [],
    summaryContract: {
      status: summaryContract.status,
      requiredSections: summaryContract.requiredSections,
      missingSections: summaryContract.missingSections,
      placeholderMarkers: summaryContract.placeholderMarkers
    },
    missingFiles: missing,
    advisoryCount: advisories.length,
    advisories
  };
}

function inspectProjectSummaryContent(content) {
  const normalized = String(content ?? "");
  const trimmed = normalized.trim();

  if (!trimmed) {
    return {
      status: "partial",
      requiredSections: [...REQUIRED_PROJECT_SUMMARY_SECTIONS],
      missingSections: [...REQUIRED_PROJECT_SUMMARY_SECTIONS],
      placeholderMarkers: [],
      advisories: [
        {
          code: "PROJECT_SUMMARY_EMPTY",
          file: "specs/project/summary.md",
          message: "project summary 为空，无法为 AI agent 与团队成员提供项目级上下文入口",
          action: "补齐 `specs/project/summary.md` 的必填章节与实际项目内容"
        }
      ]
    };
  }

  const advisories = [];
  const missingSections = REQUIRED_PROJECT_SUMMARY_SECTIONS.filter((section) => !normalized.includes(`## ${section}`));
  const placeholderMarkers = PROJECT_SUMMARY_PLACEHOLDER_MARKERS.filter((marker) => normalized.includes(marker));

  if (missingSections.length) {
    advisories.push({
      code: "PROJECT_SUMMARY_SECTION_MISSING",
      file: "specs/project/summary.md",
      message: `project summary 缺少必填章节：${missingSections.join("、")}`,
      action: "补齐 `specs/project/summary.md` 的必填章节后重新运行 `specnfc doctor`"
    });
  }

  if (placeholderMarkers.length) {
    advisories.push({
      code: "PROJECT_SUMMARY_PLACEHOLDER",
      file: "specs/project/summary.md",
      message: `project summary 仍保留初始化占位内容：${placeholderMarkers.join("；")}`,
      action: "把团队归属、上下文引用与模块摘要等初始化占位替换为真实项目信息"
    });
  }

  return {
    status: advisories.length ? "partial" : "complete",
    requiredSections: [...REQUIRED_PROJECT_SUMMARY_SECTIONS],
    missingSections,
    placeholderMarkers,
    advisories
  };
}

async function inspectRepositoryDoc({ repoRoot, targetPath }) {
  const content = await readText(targetPath);
  const relative = toRelative(repoRoot, targetPath);
  const advisories = [];

  if (containsRepositoryPlaceholder(content)) {
    advisories.push({
      code: "REPOSITORY_DOC_PLACEHOLDER",
      file: relative,
      message: `仓级长期文档仍是占位内容：${relative}`,
      action: "补齐仓级长期文档正式内容"
    });
  }

  return advisories;
}

async function collectMarkdownFiles(rootPath) {
  const results = [];
  const entries = await listDir(rootPath);

  for (const entry of entries) {
    const targetPath = path.join(rootPath, entry);
    if (await isDirectory(targetPath)) {
      results.push(...(await collectMarkdownFiles(targetPath)));
      continue;
    }

    if (targetPath.endsWith(".md")) {
      results.push(targetPath);
    }
  }

  return results;
}

function containsRepositoryPlaceholder(content) {
  const normalized = String(content ?? "");
  return /\bTODO\b/i.test(normalized) || normalized.includes("待补充") || normalized.includes("占位");
}

function uniqueRepositoryAdvisories(items) {
  const seen = new Set();
  const uniqueItems = [];

  for (const item of items) {
    const key = `${item.code}:${item.file}:${item.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueItems.push(item);
  }

  return uniqueItems;
}

async function inspectEntryPolicies({ repoPaths, governanceEnabled }) {
  const risks = [];
  const items = [];
  const entryChecks = [
    {
      path: repoPaths.agentsPath,
      label: "AGENTS.md",
      markers: [
        "## 个人 Skills 兼容规则",
        "以仓内正式规范、`.specnfc/` 和当前 change 为准",
        "clarify → design → plan → execute → verify → accept → archive",
        "`specs/project/summary.md`",
        "不得进入 `execute`"
      ]
    },
    {
      path: repoPaths.claudePath,
      label: "CLAUDE.md",
      markers: [
        "## 个人 Skills 兼容规则",
        "以仓内正式规范、`.specnfc/` 和当前 change 为准",
        "clarify → design → plan → execute → verify → accept → archive",
        "`specs/project/summary.md`",
        "不得进入 `execute`"
      ]
    },
    {
      path: repoPaths.traeRulesPath,
      label: ".trae/rules/project_rules.md",
      markers: [
        "## 个人 Skills 兼容规则",
        "以仓内正式规范、`.specnfc/` 和当前 change 为准",
        "clarify → design → plan → execute → verify → accept → archive",
        "`specs/project/summary.md`",
        "不得进入 `execute`"
      ]
    }
  ];

  for (const check of entryChecks) {
    if (!(await pathExists(check.path))) {
      items.push({
        file: check.label,
        status: "missing",
        missingMarkers: check.markers
      });
      risks.push({
        code: "ENTRY_FILE_MISSING",
        message: `${check.label} 缺失，入口投影不完整`
      });
      continue;
    }

    const content = await readText(check.path);
    const missingMarkers = check.markers.filter((marker) => !content.includes(marker));
    if (missingMarkers.length) {
      items.push({
        file: check.label,
        status: "drifted",
        missingMarkers
      });
      risks.push({
        code: "ENTRY_POLICY_MISSING",
        message: `${check.label} 缺少个人 Skills 兼容规则，仓内规范可能被个人 skill 覆盖`
      });
    } else {
      items.push({
        file: check.label,
        status: "synced",
        missingMarkers: []
      });
    }
  }

  let opencodeStatus = "missing";
  let opencodeMissingInstructions = [];

  if (await pathExists(repoPaths.opencodePath)) {
    try {
      const opencode = await readJson(repoPaths.opencodePath);
      const instructions = Array.isArray(opencode.instructions) ? opencode.instructions : [];
      const requiredInstructions = [
        "AGENTS.md",
        ".specnfc/README.md",
        ".specnfc/runtime/active-rules.json",
        ".specnfc/indexes/project-index.json",
        "specs/project/**/*.md",
        "specs/changes/**/*.md"
      ];
      if (governanceEnabled && !instructions.includes(".specnfc/governance/**/*.md")) {
        opencodeMissingInstructions.push(".specnfc/governance/**/*.md");
        risks.push({
          code: "OPENCODE_POLICY_MISSING",
          message: "opencode.json 未纳入治理层规则，OpenCode 可能读不到个人 Skills 兼容约束"
        });
      }
      const stillMissing = requiredInstructions.filter((item) => !instructions.includes(item));
      opencodeMissingInstructions.push(...stillMissing);
      if (opencodeMissingInstructions.length) {
        opencodeStatus = "drifted";
      } else {
        opencodeStatus = "synced";
      }
    } catch (error) {
      opencodeStatus = "invalid";
      risks.push({
        code: "INVALID_OPENCODE_CONFIG",
        message: error instanceof Error ? `opencode.json 无法解析：${error.message}` : "opencode.json 无法解析"
      });
    }
  } else {
    risks.push({
      code: "OPENCODE_CONFIG_MISSING",
      message: "opencode.json 缺失，OpenCode 入口投影不完整"
    });
  }

  items.push({
    file: "opencode.json",
    status: opencodeStatus,
    missingMarkers: opencodeMissingInstructions
  });

  if (!governanceEnabled) {
    return {
      risks,
      summary: summarizeProjectionHealth(items)
    };
  }

  const skillPolicyPath = path.join(repoPaths.specnfcRoot, "governance/personal-skills.md");
  if (await pathExists(skillPolicyPath)) {
    const content = await readText(skillPolicyPath);
    const requiredMarkers = ["## 不可被覆盖的事项", "## 冲突处理", "## 交接要求"];
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));
    if (missingMarkers.length) {
      risks.push({
        code: "SKILL_POLICY_DRIFT",
        message: ".specnfc/governance/personal-skills.md 缺少关键约束，个人 skills 边界不完整"
      });
    }
  } else {
    risks.push({
      code: "SKILL_POLICY_MISSING",
      message: "治理层已启用，但缺少 .specnfc/governance/personal-skills.md"
    });
  }

  return {
    risks,
    summary: summarizeProjectionHealth(items)
  };
}

function summarizeProjectionHealth(items) {
  const missingCount = items.filter((item) => item.status === "missing").length;
  const driftCount = items.filter((item) => item.status === "drifted").length;
  const invalidCount = items.filter((item) => item.status === "invalid").length;
  const checkedCount = items.length;
  const status = missingCount || invalidCount || driftCount ? "drifted" : "synced";

  return {
    status,
    checkedCount,
    missingCount,
    driftCount,
    invalidCount,
    items
  };
}
