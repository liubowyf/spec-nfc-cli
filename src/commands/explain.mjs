import path from "node:path";
import { createErrorResult, createSuccessResult } from "../cli/output.mjs";
import { getAllModuleNames, MODULES } from "../kernel/modules.mjs";
import { getHelpPath, resolveRepoRoot } from "../kernel/paths.mjs";
import { inspectRepository, readGuide } from "../kernel/scaffold.mjs";
import { readText } from "../utils/fs.mjs";

export async function runExplain({ args, flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);
  const topic = args[0];

  if (!topic) {
    const overview = await readText(getHelpPath("concepts", "overview.md"));
    const report = await inspectRepository(repoRoot).catch(() => null);
    const statusLine = report?.initialized
      ? `当前仓已初始化，已安装模块：${report.installedModules.join("、") || "当前无"}`
      : "当前仓尚未初始化。";

    return createSuccessResult({
      command: "explain",
      cwd: repoRoot,
      data: {
        topic: "overview",
        content: overview,
        initialized: report?.initialized ?? false
      },
      human: {
        summary: "Spec nfc 总览",
        sections: [
          {
            title: "当前仓状态",
            items: [statusLine]
          },
          {
            title: "说明内容",
            items: overview.trim().split("\n"),
            preformatted: true
          }
        ]
      },
      next: ["运行 `specnfc explain modules` 查看模块说明", "运行 `specnfc explain tools` 查看多工具接入说明"]
    });
  }

  if (topic === "modules") {
    const items = getAllModuleNames().map((name) => `${name}：${MODULES[name].description}`);
    return createSuccessResult({
      command: "explain",
      cwd: repoRoot,
      data: {
        topic,
        modules: items
      },
      human: {
        summary: "当前支持的模块",
        sections: [
          {
            title: "模块列表",
            items
          }
        ]
      },
      next: ["运行 `specnfc explain <模块名>` 查看单个模块说明"]
    });
  }

  if (MODULES[topic]) {
    const guide = await readGuide(topic);
    return createSuccessResult({
      command: "explain",
      cwd: repoRoot,
      data: {
        topic,
        content: guide
      },
      human: {
        summary: `${topic} 模块说明`,
        sections: [
          {
            title: "说明内容",
            items: guide.trim().split("\n"),
            preformatted: true
          }
        ]
      },
      next: [`运行 \`specnfc add ${topic}\` 安装该模块`]
    });
  }

  const conceptHelpPath = getHelpPath("concepts", `${topic}.md`);
  try {
    const content = await readText(conceptHelpPath);
    return createSuccessResult({
      command: "explain",
      cwd: repoRoot,
      data: {
        topic,
        content
      },
      human: {
        summary: `${topic} 说明`,
        sections: [
          {
            title: "说明内容",
            items: content.trim().split("\n"),
            preformatted: true
          }
        ]
      },
      next: []
    });
  } catch {}

  const commandHelpPath = getHelpPath("commands", `${topic}.md`);
  try {
    const content = await readText(commandHelpPath);
    return createSuccessResult({
      command: "explain",
      cwd: repoRoot,
      data: {
        topic,
        content
      },
      human: {
        summary: `${topic} 命令说明`,
        sections: [
          {
            title: "说明内容",
            items: content.trim().split("\n"),
            preformatted: true
          }
        ]
      },
      next: []
    });
  } catch {
    return createErrorResult({
      command: "explain",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: `未找到说明主题：${topic}`,
      next: ["运行 `specnfc explain` 查看总览", "运行 `specnfc explain modules` 查看模块清单"]
    });
  }
}
