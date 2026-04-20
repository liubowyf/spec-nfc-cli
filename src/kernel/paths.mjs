import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

export const PROJECT_ROOT = path.resolve(currentDir, "../../");
export const TEMPLATE_ROOT = path.join(PROJECT_ROOT, "src/templates");
export const HELP_ROOT = path.join(PROJECT_ROOT, "src/help");
export const SKILL_PACK_SOURCE_ROOT = path.join(PROJECT_ROOT, "skill-packs");

export function resolveRepoRoot(cwdArg, runtimeCwd) {
  if (!cwdArg) {
    return path.resolve(runtimeCwd);
  }

  return path.resolve(runtimeCwd, cwdArg);
}

export function getRepoPaths(repoRoot) {
  return {
    repoRoot,
    gitignorePath: path.join(repoRoot, ".gitignore"),
    specnfcRoot: path.join(repoRoot, ".specnfc"),
    runtimeRoot: path.join(repoRoot, ".specnfc/runtime"),
    nfcRoot: path.join(repoRoot, ".nfc"),
    importsRoot: path.join(repoRoot, ".nfc/imports"),
    externalSkillMirrorRoot: path.join(repoRoot, ".nfc/skills/external"),
    configPath: path.join(repoRoot, ".specnfc/config.json"),
    teamContractRefPath: path.join(repoRoot, ".specnfc/contract/team-contract.ref.json"),
    projectRefPath: path.join(repoRoot, ".specnfc/contract/project.ref.json"),
    repoContractPath: path.join(repoRoot, ".specnfc/contract/repo.json"),
    governanceModePath: path.join(repoRoot, ".specnfc/contract/governance-mode.json"),
    waiverRoot: path.join(repoRoot, ".specnfc/governance/waivers"),
    releaseDecisionsRoot: path.join(repoRoot, ".specnfc/governance/release-decisions"),
    governanceRegistryRoot: path.join(repoRoot, ".specnfc/governance/registries"),
    teamPolicyRegistryPath: path.join(repoRoot, ".specnfc/governance/registries/team-policy-registry.json"),
    teamSkillPackRegistryPath: path.join(repoRoot, ".specnfc/governance/registries/team-skill-pack-registry.json"),
    teamApprovalRegistryPath: path.join(repoRoot, ".specnfc/governance/registries/team-approval-registry.json"),
    teamWaiverRegistryPath: path.join(repoRoot, ".specnfc/governance/registries/team-waiver-registry.json"),
    teamProjectCatalogPath: path.join(repoRoot, ".specnfc/governance/registries/team-project-catalog.json"),
    projectRepoRegistryPath: path.join(repoRoot, ".specnfc/governance/registries/project-repo-registry.json"),
    projectIntegrationRegistryPath: path.join(repoRoot, ".specnfc/governance/registries/project-integration-registry.json"),
    activeRulesPath: path.join(repoRoot, ".specnfc/runtime/active-rules.json"),
    runtimeIndexPath: path.join(repoRoot, ".specnfc/indexes/runtime-index.json"),
    governanceIndexPath: path.join(repoRoot, ".nfc/state/governance-index.json"),
    governanceEventsLogPath: path.join(repoRoot, ".nfc/logs/governance-events.ndjson"),
    runtimeLedgerPath: path.join(repoRoot, ".nfc/state/runtime-ledger.json"),
    runtimeEventsLogPath: path.join(repoRoot, ".nfc/logs/runtime-events.ndjson"),
    currentModePath: path.join(repoRoot, ".nfc/state/current-mode.json"),
    currentStagePath: path.join(repoRoot, ".nfc/state/current-stage.json"),
    runtimeLocksPath: path.join(repoRoot, ".nfc/state/runtime-locks.json"),
    sessionHintsPath: path.join(repoRoot, ".nfc/state/session-hints.json"),
    writebackQueuePath: path.join(repoRoot, ".nfc/sync/pending-writeback.json"),
    writebackHistoryPath: path.join(repoRoot, ".nfc/sync/writeback-history.json"),
    specnfcReadmePath: path.join(repoRoot, ".specnfc/README.md"),
    claudePath: path.join(repoRoot, "CLAUDE.md"),
    traeRulesPath: path.join(repoRoot, ".trae/rules/project_rules.md"),
    opencodePath: path.join(repoRoot, "opencode.json"),
    specsRoot: path.join(repoRoot, "specs"),
    specsReadmePath: path.join(repoRoot, "specs/README.md"),
    projectDocsRoot: path.join(repoRoot, "specs/project"),
    projectReadmePath: path.join(repoRoot, "specs/project/README.md"),
    projectSummaryPath: path.join(repoRoot, "specs/project/summary.md"),
    projectIndexPath: path.join(repoRoot, ".specnfc/indexes/project-index.json"),
    changesRoot: path.join(repoRoot, "specs/changes"),
    archiveRoot: path.join(repoRoot, "specs/archive"),
    integrationsRoot: path.join(repoRoot, "specs/integrations"),
    agentsPath: path.join(repoRoot, "AGENTS.md")
  };
}

export function getModuleTemplateRoot(moduleName) {
  return path.join(TEMPLATE_ROOT, moduleName);
}

export function getHelpPath(...parts) {
  return path.join(HELP_ROOT, ...parts);
}

export function resolvePathWithin(rootPath, ...parts) {
  const normalizedRoot = path.resolve(rootPath);
  const resolvedPath = path.resolve(normalizedRoot, ...parts);
  const relative = path.relative(normalizedRoot, resolvedPath);

  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolvedPath;
  }

  throw new Error(`路径超出允许边界：${resolvedPath}`);
}
