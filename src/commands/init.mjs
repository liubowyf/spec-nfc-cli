import { createErrorResult, createSuccessResult } from "../cli/output.mjs";
import { getPackageMeta } from "../kernel/meta.mjs";
import { expandModuleDependencies, parseModuleList, validateModules } from "../kernel/modules.mjs";
import { getProfile, getProfileNames, isValidProfile, normalizeProfileName } from "../kernel/profiles.mjs";
import { resolvePathWithin, resolveRepoRoot } from "../kernel/paths.mjs";
import { isInitialized } from "../kernel/config.mjs";
import { installModules } from "../kernel/scaffold.mjs";
import { buildCommandNextStep } from "./next-step.mjs";
import { writeJson } from "../utils/fs.mjs";

export async function runInit({ args, flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);
  const profileName = normalizeProfileName(flags.profile);
  if (!isValidProfile(profileName)) {
    return createErrorResult({
      command: "init",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: `未识别的 profile：${profileName}`,
      next: [`支持的 profile：${getProfileNames().join("、")}`]
    });
  }

  const requested = parseModuleList(flags.with);
  const profileModules = getProfile(profileName).modules;
  const combinedModules = [...profileModules, ...requested];
  const validation = validateModules(requested);

  if (!validation.valid) {
    return createErrorResult({
      command: "init",
      cwd: repoRoot,
      code: "MODULE_NOT_FOUND",
      message: `未识别的模块：${validation.invalid.join(", ")}`,
      next: ["运行 `specnfc explain modules` 查看当前支持的模块"]
    });
  }

  const moduleNames = expandModuleDependencies(combinedModules);
  const initialized = await isInitialized(repoRoot);
  if (initialized && !flags.force) {
    return createErrorResult({
      command: "init",
      cwd: repoRoot,
      code: "ALREADY_INITIALIZED",
      message: "当前仓库已经初始化过，如需重建请显式传入 --force",
      next: ["运行 `specnfc doctor` 检查当前状态", "如确需重建，运行 `specnfc init --force`"]
    });
  }

  const result = await installModules({
    repoRoot,
    moduleNames,
    profileName,
    dryRun: Boolean(flags.dryRun),
    force: Boolean(flags.force)
  });

  const packageMeta = await getPackageMeta();
  const nextStep = {
    ...buildCommandNextStep({
      currentPhase: "clarify",
      step: "status_entry",
      stepLabel: "先查看仓库协议状态",
      primaryAction: "specnfc status",
      primaryDoc: ".specnfc/execution/next-step.json",
      primaryGoal: "先查看当前仓的协议状态，再按主链路进入第一个 change",
      requiredSections: ["active change 状态", "项目摘要占位情况", "下一步主动作"],
      doNotDoYet: [
        "不要把 doctor / explain / add 当作默认起手动作",
        "不要在未创建 change 前直接开始补多份文档或写代码"
      ],
      exitCriteria: ["已执行 `specnfc status`", "已看到当前唯一主动作"],
      afterPrimaryAction: "如果 status 显示当前无 active change，再执行 `specnfc change create <change-id>`",
      completed: ["repo protocol initialized"],
      missing: ["active change"],
      recommendedNext: [{ type: "cli", value: "specnfc status" }],
      stepAware: true
    })
  };

  if (!flags.dryRun) {
    await writeJson(resolvePathWithin(repoRoot, ".specnfc/execution/next-step.json"), nextStep);
  }

  return createSuccessResult({
    command: "init",
    cwd: repoRoot,
    data: {
      specnfcVersion: packageMeta.version,
      profile: profileName,
      installedModules: result.installedModules,
      created: result.created,
      skipped: result.skipped,
      protocolAdopted: true,
      repoContract: ".specnfc/contract/repo.json",
      skillPack: {
        id: "specnfc-zh-cn-default",
        version: packageMeta.version,
        locale: "zh-CN"
      },
      projectionStatus: "managed",
      nfcRuntimeRoot: ".nfc",
      nextStep,
      nextStepProtocolReady: true,
      dryRun: Boolean(flags.dryRun)
    },
    human: {
      summary: flags.dryRun ? "已生成初始化预览计划。" : "已完成 Specnfc 仓库初始化。",
      sections: [
        {
          title: "主链路起点",
          items: [
            "当前阶段：需求澄清",
            "当前步骤：先查看仓库协议状态",
            "当前主动作：运行 `specnfc status`",
            "当前聚焦文档：`.specnfc/execution/next-step.json`",
            "当前不该做：不要先把 doctor / explain / add 当作默认起手动作",
            "完成后下一步：若 status 显示无 active change，再运行 `specnfc change create <change-id>`"
          ]
        },
        {
          title: "初始化 Profile",
          items: [profileName]
        },
        {
          title: "已安装模块",
          items: result.installedModules
        },
        {
          title: flags.dryRun ? "计划创建" : "已创建",
          items: result.created
        }
      ]
    },
    warnings: result.warnings,
    next: ["运行 `specnfc status`"]
  });
}
