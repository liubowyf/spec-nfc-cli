import path from "node:path";
import { pathExists, readJson, writeJson } from "../utils/fs.mjs";
import { getRepoPaths } from "./paths.mjs";
import { getAllModuleNames, MODULES } from "./modules.mjs";

export async function isInitialized(repoRoot) {
  const paths = getRepoPaths(repoRoot);
  return pathExists(paths.configPath);
}

export async function loadConfig(repoRoot) {
  const paths = getRepoPaths(repoRoot);
  return readJson(paths.configPath);
}

export async function saveConfig(repoRoot, config) {
  const paths = getRepoPaths(repoRoot);
  await writeJson(paths.configPath, config);
}

export function createBaseConfig({ repoRoot, packageMeta, profileName = "minimal" }) {
  const moduleStates = {};

  for (const name of getAllModuleNames()) {
    moduleStates[name] = {
      enabled: name === "core",
      ...(MODULES[name].required ? { required: true } : {})
    };
  }

  return {
    specnfc: {
      version: packageMeta.version,
      templateVersion: packageMeta.version,
      language: "zh-CN"
    },
    repository: {
      name: path.basename(repoRoot),
      mode: "brownfield",
      profile: profileName,
      initializedAt: new Date().toISOString()
    },
    modules: moduleStates,
    paths: {
      root: ".specnfc",
      specs: "specs",
      changes: "specs/changes",
      archive: "specs/archive",
      context: ".specnfc/context",
      execution: ".specnfc/execution",
      governance: ".specnfc/governance",
      designApi: ".specnfc/design/api",
      designDb: ".specnfc/design/db",
      quality: ".specnfc/quality",
      delivery: ".specnfc/delivery",
      integrationContract: ".specnfc/integration-contract",
      integrations: "specs/integrations"
    },
    defaults: {
      changeStructure: [
        "01-需求与方案.md",
        "02-技术设计与选型.md",
        "03-任务计划与执行.md",
        "04-验收与交接.md"
      ],
      outputMode: "human",
      agentOutputRule: "final-plus-context"
    },
    governance: {
      humanDecisionRequired: true,
      releaseOwnedByHuman: true,
      allowDirectAiRelease: false
    }
  };
}

export function enableModules(config, moduleNames) {
  const nextConfig = structuredClone(config);

  for (const moduleName of moduleNames) {
    nextConfig.modules[moduleName] = {
      ...nextConfig.modules[moduleName],
      enabled: true,
      ...(MODULES[moduleName].required ? { required: true } : {})
    };
  }

  return nextConfig;
}
