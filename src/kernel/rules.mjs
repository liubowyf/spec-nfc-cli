import path from "node:path";
import { loadConfig } from "./config.mjs";
import { getModuleTemplateRoot, getRepoPaths } from "./paths.mjs";
import { ensureDir, readJson, writeJson } from "../utils/fs.mjs";

export async function buildActiveRules({ repoRoot, persist = true }) {
  const config = await loadConfig(repoRoot);
  const repoPaths = getRepoPaths(repoRoot);
  const enabledModules = Object.entries(config.modules ?? {})
    .filter(([, meta]) => meta?.enabled)
    .map(([name]) => name)
    .sort();

  const blockingRules = [];
  const advisoryRules = [];

  for (const moduleName of enabledModules) {
    const manifest = await readJson(path.join(getModuleTemplateRoot(moduleName), "manifest.json"));
    for (const rule of manifest.rules?.blocking ?? []) {
      blockingRules.push(normalizeRule({ moduleName, rule }));
    }
    for (const rule of manifest.rules?.advisory ?? []) {
      advisoryRules.push(normalizeRule({ moduleName, rule }));
    }
  }

  const payload = {
    path: ".specnfc/runtime/active-rules.json",
    generatedAt: new Date().toISOString(),
    repository: {
      name: config.repository?.name ?? path.basename(repoRoot),
      profile: config.repository?.profile ?? null,
      mode: config.repository?.mode ?? null
    },
    enabledModules,
    blockingScopes: unique(blockingRules.map((item) => item.scope)),
    advisoryScopes: unique(advisoryRules.map((item) => item.scope)),
    blockingRules,
    advisoryRules,
    summary: {
      blockingCount: blockingRules.length,
      advisoryCount: advisoryRules.length,
      requiresRuntimeRead: Boolean(blockingRules.length || advisoryRules.length)
    }
  };

  if (persist) {
    await ensureDir(repoPaths.runtimeRoot);
    await writeJson(repoPaths.activeRulesPath, payload);
  }

  return payload;
}

function normalizeRule({ moduleName, rule }) {
  return {
    module: moduleName,
    scope: String(rule.scope || "").trim() || "repository",
    code: String(rule.code || "").trim() || `${moduleName.toUpperCase()}_RULE`,
    message: String(rule.message || "").trim() || `${moduleName} 规则生效`,
    source: buildRuleSource(moduleName)
  };
}

function buildRuleSource(moduleName) {
  switch (moduleName) {
    case "core":
      return ".specnfc/README.md";
    case "design-api":
      return ".specnfc/design/api";
    case "design-db":
      return ".specnfc/design/db";
    case "integration-contract":
      return ".specnfc/integration-contract";
    default:
      return `.specnfc/${moduleName}`;
  }
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}
