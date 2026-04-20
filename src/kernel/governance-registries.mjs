import { getRepoPaths } from "./paths.mjs";
import { ensureDir, pathExists, readJson, writeJson } from "../utils/fs.mjs";

const REQUIRED_REGISTRIES = [
  { type: "team", name: "policy", pathKey: "teamPolicyRegistryPath", label: ".specnfc/governance/registries/team-policy-registry.json" },
  { type: "team", name: "skillPack", pathKey: "teamSkillPackRegistryPath", label: ".specnfc/governance/registries/team-skill-pack-registry.json" },
  { type: "team", name: "approval", pathKey: "teamApprovalRegistryPath", label: ".specnfc/governance/registries/team-approval-registry.json" },
  { type: "team", name: "waiver", pathKey: "teamWaiverRegistryPath", label: ".specnfc/governance/registries/team-waiver-registry.json" },
  { type: "team", name: "projectCatalog", pathKey: "teamProjectCatalogPath", label: ".specnfc/governance/registries/team-project-catalog.json" },
  { type: "project", name: "repo", pathKey: "projectRepoRegistryPath", label: ".specnfc/governance/registries/project-repo-registry.json" },
  { type: "project", name: "integration", pathKey: "projectIntegrationRegistryPath", label: ".specnfc/governance/registries/project-integration-registry.json" }
];

export async function syncGovernanceRegistries({
  repoRoot,
  repoPaths = getRepoPaths(repoRoot),
  config,
  projectIndex,
  integrations,
  governanceMode,
  governanceRecords,
  createMissing = true
}) {
  const now = new Date().toISOString();
  const teamRef = await readOptionalJson(repoPaths.teamContractRefPath);
  const projectRef = await readOptionalJson(repoPaths.projectRefPath);
  const repoContract = await readOptionalJson(repoPaths.repoContractPath);
  const integrationItems = Array.isArray(integrations?.items) ? integrations.items : [];
  const activeSkillPackId = repoContract?.activeSkillPack?.id ?? "specnfc-zh-cn-default";
  const teamId = teamRef?.teamId ?? projectRef?.teamId ?? repoContract?.teamId ?? null;
  const projectId = projectRef?.projectId ?? repoContract?.projectId ?? config.repository?.name ?? null;
  const waiverCount = governanceRecords?.recordCounts?.waiver ?? 0;

  const payloads = [
    {
      path: repoPaths.teamPolicyRegistryPath,
      content: {
        registryType: "team-policy",
        scope: "team",
        teamId,
        policyPackRef: teamRef?.policyPackRef ?? null,
        reviewPolicyRef: teamRef?.reviewPolicyRef ?? null,
        approvalPolicyRef: teamRef?.approvalPolicyRef ?? null,
        releasePolicyRef: teamRef?.releasePolicyRef ?? null,
        glossaryRef: teamRef?.glossaryRef ?? null,
        governanceMode,
        stagePolicyPath: ".specnfc/contract/stage-machine.json",
        updatedAt: now
      }
    },
    {
      path: repoPaths.teamSkillPackRegistryPath,
      content: {
        registryType: "team-skill-pack",
        scope: "team",
        teamId,
        skillPackCatalogRef: teamRef?.skillPackCatalogRef ?? null,
        activeSkillPackId,
        activeSkillPackManifestPath: ".specnfc/skill-packs/active/manifest.json",
        builtInSourceRoot: `skill-packs/${activeSkillPackId}`,
        capabilityParityMatrixPath: `skill-packs/${activeSkillPackId}/capability-parity-matrix.md`,
        runtimeSkillAccess: {
          mode: "source-only",
          sourceRoot: ".specnfc/skill-packs/active",
          runtimeMirrorRoot: null
        },
        externalImportRoot: ".nfc/imports",
        updatedAt: now
      }
    },
    {
      path: repoPaths.teamApprovalRegistryPath,
      content: {
        registryType: "team-approval",
        scope: "team",
        teamId,
        requiredApprovalProfiles: Array.isArray(projectRef?.requiredApprovalProfiles) ? projectRef.requiredApprovalProfiles : [],
        releaseDecisionRoot: ".specnfc/governance/release-decisions",
        changeApprovalEvidenceRoot: "specs/changes/<change-id>/evidence/approvals",
        integrationApprovalEvidenceRoot: "specs/integrations/<integration-id>/evidence/approvals",
        updatedAt: now
      }
    },
    {
      path: repoPaths.teamWaiverRegistryPath,
      content: {
        registryType: "team-waiver",
        scope: "team",
        teamId,
        waiverRoot: ".specnfc/governance/waivers",
        waiverCatalogRef: null,
        activeWaiverCount: waiverCount,
        updatedAt: now
      }
    },
    {
      path: repoPaths.teamProjectCatalogPath,
      content: {
        registryType: "team-project-catalog",
        scope: "team",
        teamId,
        projectRegistryRef: teamRef?.projectRegistryRef ?? null,
        projects: [
          {
            projectId,
            protocolProfile: projectRef?.protocolProfile ?? config.repository?.profile ?? "minimal",
            repoRefCount: Array.isArray(projectRef?.repoRefs) ? projectRef.repoRefs.length : 0,
            integrationRegistryRef: projectRef?.integrationRegistryRef ?? null,
            activeWorkRefCount: Array.isArray(projectRef?.activeWorkRefs) ? projectRef.activeWorkRefs.length : 0
          }
        ],
        updatedAt: now
      }
    },
    {
      path: repoPaths.projectRepoRegistryPath,
      content: {
        registryType: "project-repo",
        scope: "project",
        projectId,
        teamId,
        repos: [
          {
            repoId: repoContract?.repoId ?? config.repository?.name ?? null,
            repoName: repoContract?.repoName ?? config.repository?.name ?? null,
            profile: config.repository?.profile ?? "minimal",
            governanceMode,
            repoContractPath: ".specnfc/contract/repo.json",
            projectIndexPath: ".specnfc/indexes/project-index.json"
          }
        ],
        updatedAt: now
      }
    },
    {
      path: repoPaths.projectIntegrationRegistryPath,
      content: {
        registryType: "project-integration",
        scope: "project",
        projectId,
        teamId,
        integrationRegistryRef: projectRef?.integrationRegistryRef ?? null,
        integrations: integrationItems.map((item) => ({
          id: item.id,
          status: item.status,
          canonicalStage: item.canonicalStage,
          path: item.path
        })),
        integrationCount: integrationItems.length,
        changeRefCount: projectIndex?.changeRefCount ?? 0,
        updatedAt: now
      }
    }
  ];

  for (const item of payloads) {
    if (!createMissing && !(await pathExists(item.path))) {
      continue;
    }
    await ensureDir(repoPaths.governanceRegistryRoot);
    await writeJson(item.path, item.content);
  }

  return {
    registryRoot: ".specnfc/governance/registries",
    fileCount: payloads.length,
    updatedAt: now
  };
}

export async function inspectGovernanceRegistries({ repoRoot, repoPaths = getRepoPaths(repoRoot) }) {
  const advisories = [];
  const registries = [];
  let missingCount = 0;
  let invalidCount = 0;

  for (const definition of REQUIRED_REGISTRIES) {
    const targetPath = repoPaths[definition.pathKey];
    if (!(await pathExists(targetPath))) {
      missingCount += 1;
      advisories.push({
        code: "GOVERNANCE_REGISTRY_MISSING",
        file: definition.label,
        message: `治理注册中心文件缺失：${definition.label}`,
        action: "运行 `specnfc upgrade` 或重新初始化协议控制面"
      });
      registries.push({
        type: definition.type,
        name: definition.name,
        file: definition.label,
        status: "missing"
      });
      continue;
    }

    try {
      const payload = await readJson(targetPath);
      registries.push({
        type: definition.type,
        name: definition.name,
        file: definition.label,
        status: "complete",
        registryType: payload?.registryType ?? null,
        updatedAt: payload?.updatedAt ?? null
      });
    } catch {
      invalidCount += 1;
      advisories.push({
        code: "GOVERNANCE_REGISTRY_INVALID",
        file: definition.label,
        message: `治理注册中心文件无法解析：${definition.label}`,
        action: "修复 JSON 结构后重新运行 `specnfc doctor`"
      });
      registries.push({
        type: definition.type,
        name: definition.name,
        file: definition.label,
        status: "invalid"
      });
    }
  }

  const teamRegistryCount = registries.filter((item) => item.type === "team" && item.status === "complete").length;
  const projectRegistryCount = registries.filter((item) => item.type === "project" && item.status === "complete").length;

  return {
    status: missingCount + invalidCount === 0 ? "complete" : missingCount === REQUIRED_REGISTRIES.length ? "missing" : "partial",
    registryRoot: ".specnfc/governance/registries",
    requiredCount: REQUIRED_REGISTRIES.length,
    teamRegistryCount,
    projectRegistryCount,
    missingCount,
    invalidCount,
    advisoryCount: advisories.length,
    advisories,
    registries
  };
}

async function readOptionalJson(targetPath) {
  if (!(await pathExists(targetPath))) {
    return null;
  }
  try {
    return await readJson(targetPath);
  } catch {
    return null;
  }
}
