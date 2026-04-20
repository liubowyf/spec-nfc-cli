import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_ROOT, resolvePathWithin } from "./paths.mjs";

export const DEFAULT_SKILL_PACK_ID = "specnfc-zh-cn-default";

const manifestCache = new Map();

export function getBuiltInSkillPackRoot(packId = DEFAULT_SKILL_PACK_ID) {
  return resolvePathWithin(PROJECT_ROOT, "skill-packs", packId);
}

export function getBuiltInSkillPackManifestPath(packId = DEFAULT_SKILL_PACK_ID) {
  return path.join(getBuiltInSkillPackRoot(packId), "manifest.json");
}

export function loadBuiltInSkillPackManifest(packId = DEFAULT_SKILL_PACK_ID) {
  if (manifestCache.has(packId)) {
    return manifestCache.get(packId);
  }

  const manifestPath = getBuiltInSkillPackManifestPath(packId);
  if (!existsSync(manifestPath)) {
    throw new Error(`内置 skill-pack manifest 不存在：${manifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifestCache.set(packId, manifest);
  return manifest;
}

export function readBuiltInSkillPackSourceText(sourcePath, packId = DEFAULT_SKILL_PACK_ID) {
  const packRoot = getBuiltInSkillPackRoot(packId);
  const targetPath = resolvePathWithin(packRoot, sourcePath);

  if (!existsSync(targetPath)) {
    throw new Error(`内置 skill-pack 源文件不存在：${targetPath}`);
  }

  return readFileSync(targetPath, "utf8");
}

export function getBuiltInWorkflowSkillDefinitions(packId = DEFAULT_SKILL_PACK_ID) {
  return loadBuiltInSkillPackManifest(packId).workflowSkillCatalog || [];
}

export function getBuiltInSupportSkillDefinitions(packId = DEFAULT_SKILL_PACK_ID) {
  return loadBuiltInSkillPackManifest(packId).supportSkillCatalog || [];
}

export function getBuiltInGovernanceSkillDefinitions(packId = DEFAULT_SKILL_PACK_ID) {
  return loadBuiltInSkillPackManifest(packId).governanceSkillCatalog || [];
}

export function getBuiltInPromptCatalogDefinitions(packId = DEFAULT_SKILL_PACK_ID) {
  return loadBuiltInSkillPackManifest(packId).promptCatalogEntries || [];
}

export function getBuiltInPlaybookDefinitions(packId = DEFAULT_SKILL_PACK_ID) {
  return loadBuiltInSkillPackManifest(packId).playbooks || [];
}
