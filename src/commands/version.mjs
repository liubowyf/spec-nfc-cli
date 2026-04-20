import { createSuccessResult } from "../cli/output.mjs";
import { getPackageMeta } from "../kernel/meta.mjs";
import { resolveRepoRoot } from "../kernel/paths.mjs";

export async function runVersion({ flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);
  const packageMeta = await getPackageMeta();

  return createSuccessResult({
    command: "version",
    cwd: repoRoot,
    data: {
      specnfcVersion: packageMeta.version,
      templateVersion: packageMeta.version,
      protocolVersion: packageMeta.version
    },
    human: {
      summary: "版本信息",
      sections: [
        {
          title: "当前版本",
          items: [
            `Spec nfc：${packageMeta.version}`,
            `模板版本：${packageMeta.version}`,
            `协议版本：${packageMeta.version}`
          ]
        }
      ]
    },
    next: []
  });
}
