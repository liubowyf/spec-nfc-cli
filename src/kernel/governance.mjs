import { getRepoPaths } from "./paths.mjs";
import { pathExists, readJson } from "../utils/fs.mjs";

export const GOVERNANCE_MODES = ["advisory", "guided", "strict", "locked"];

export function normalizeGovernanceMode(value, fallback = "guided") {
  return GOVERNANCE_MODES.includes(value) ? value : fallback;
}

export async function readRepositoryGovernanceMode(repoRoot, fallback = "guided") {
  const repoPaths = getRepoPaths(repoRoot);

  if (await pathExists(repoPaths.repoContractPath)) {
    try {
      const repoContract = await readJson(repoPaths.repoContractPath);
      const mode = normalizeGovernanceMode(repoContract?.governanceMode, null);
      if (mode) {
        return mode;
      }
    } catch {
      // ignore invalid repo contract and fall back to governance-mode.json
    }
  }

  if (await pathExists(repoPaths.governanceModePath)) {
    try {
      const governanceMode = await readJson(repoPaths.governanceModePath);
      const mode = normalizeGovernanceMode(governanceMode?.mode, null);
      if (mode) {
        return mode;
      }
    } catch {
      // ignore invalid governance file and use fallback
    }
  }

  return fallback;
}
