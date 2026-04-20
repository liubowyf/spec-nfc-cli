import { getRepoPaths, resolvePathWithin } from './paths.mjs';
import { pathExists, readJson, writeJson } from '../utils/fs.mjs';

export async function updateExecutionPointers({ repoRoot, changeRef, integrationRef, currentPhase }) {
  const repoPaths = getRepoPaths(repoRoot);
  const currentPath = resolvePathWithin(repoRoot, '.specnfc/execution/current.json');
  const activeChangePath = resolvePathWithin(repoRoot, '.specnfc/execution/active-change.ref.json');
  const activeIntegrationPath = resolvePathWithin(repoRoot, '.specnfc/execution/active-integration.ref.json');
  const now = new Date().toISOString();

  const current = (await readJsonIfExists(currentPath)) || {};
  const nextCurrent = {
    currentPhase: currentPhase ?? current.currentPhase ?? 'clarify',
    activeChangeRef: changeRef ?? current.activeChangeRef ?? null,
    activeIntegrationRef: integrationRef ?? current.activeIntegrationRef ?? null,
    updatedAt: now
  };

  await writeJson(currentPath, nextCurrent);
  await writeJson(repoPaths.currentStagePath, {
    phase: nextCurrent.currentPhase,
    currentPhase: nextCurrent.currentPhase,
    activeChangeId: nextCurrent.activeChangeRef?.changeId ?? null,
    activeIntegrationId: nextCurrent.activeIntegrationRef?.integrationId ?? null,
    updatedAt: now
  });

  if (changeRef !== undefined) {
    await writeJson(activeChangePath, {
      changeId: changeRef?.changeId ?? null,
      path: changeRef?.path ?? null,
      updatedAt: now
    });
  }

  if (integrationRef !== undefined) {
    await writeJson(activeIntegrationPath, {
      integrationId: integrationRef?.integrationId ?? null,
      path: integrationRef?.path ?? null,
      updatedAt: now
    });
  }

  return nextCurrent;
}

async function readJsonIfExists(targetPath) {
  if (!(await pathExists(targetPath))) {
    return null;
  }
  try {
    return await readJson(targetPath);
  } catch {
    return null;
  }
}
