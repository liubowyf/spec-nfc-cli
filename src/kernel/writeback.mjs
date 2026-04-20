import { resolvePathWithin } from './paths.mjs';
import { ensureDir, isDirectory, listDir, pathExists, readJson, writeJson } from '../utils/fs.mjs';
import path from 'node:path';

export async function inspectWritebackQueue({ repoRoot }) {
  const queuePath = resolvePathWithin(repoRoot, '.nfc/sync/pending-writeback.json');
  if (!(await pathExists(queuePath))) {
    return {
      status: 'missing',
      count: 0,
      items: [],
      targetDocs: []
    };
  }

  try {
    const payload = await readJson(queuePath);
    const items = Array.isArray(payload?.items) ? payload.items.map(normalizeWritebackItem) : [];
    const pendingItems = items.filter((item) => item.syncState === 'pending' || item.syncState === 'blocked');
    const targetDocs = Array.from(new Set(pendingItems.map((item) => item.targetDocPath).filter(Boolean))).sort();

    return {
      status: pendingItems.length ? 'pending' : 'clean',
      count: pendingItems.length,
      items: pendingItems,
      targetDocs
    };
  } catch {
    return {
      status: 'invalid',
      count: 0,
      items: [],
      targetDocs: []
    };
  }
}

export function filterWritebackQueue(queue, { scope, targetId }) {
  const items = (queue?.items || []).filter((item) => {
    if (scope && item.scope !== scope) {
      return false;
    }
    if (targetId && item.targetId !== targetId) {
      return false;
    }
    return true;
  });

  return {
    status: items.length ? "pending" : queue?.status === "invalid" ? "invalid" : "clean",
    count: items.length,
    items,
    targetDocs: Array.from(new Set(items.map((item) => item.targetDocPath).filter(Boolean))).sort()
  };
}

export async function syncRuntimeLinksForRepo({ repoRoot }) {
  const queue = await inspectWritebackQueue({ repoRoot });
  await syncRuntimeLinksForScope({ repoRoot, rootDir: 'specs/changes', scope: 'change', queue });
  await syncRuntimeLinksForScope({ repoRoot, rootDir: 'specs/integrations', scope: 'integration', queue });
  return queue;
}

function normalizeWritebackItem(item) {
  const runtimeArtifactId = String(item?.runtimeArtifactId || item?.id || 'unknown');
  const runtimePath = String(item?.runtimePath || item?.path || item?.runtime_path || '');
  const targetDocPath = String(item?.targetDocPath || item?.target || item?.target_path || '');
  const writebackType = String(item?.writebackType || item?.type || 'update');
  const syncState = String(item?.syncState || item?.state || 'pending');
  const scope = String(item?.scope || inferScopeFromTarget(targetDocPath));
  const targetId = String(item?.targetId || inferTargetId(targetDocPath, scope));
  const requiredSections = Array.isArray(item?.requiredSections) ? item.requiredSections : [];

  return {
    runtimeArtifactId,
    runtimePath,
    targetDocPath,
    writebackType,
    syncState,
    scope,
    targetId,
    requiredSections,
    syncOwner: item?.syncOwner || null,
    lastAttemptAt: item?.lastAttemptAt || null,
    lastSyncedAt: item?.lastSyncedAt || null
  };
}

function inferScopeFromTarget(targetDocPath) {
  if (targetDocPath.includes('specs/changes/')) return 'change';
  if (targetDocPath.includes('specs/integrations/')) return 'integration';
  return 'repository';
}

function inferTargetId(targetDocPath, scope) {
  const parts = targetDocPath.split('/');
  if (scope === 'change') {
    const idx = parts.indexOf('changes');
    return idx >= 0 ? parts[idx + 1] || '' : '';
  }
  if (scope === 'integration') {
    const idx = parts.indexOf('integrations');
    return idx >= 0 ? parts[idx + 1] || '' : '';
  }
  return '';
}

async function syncRuntimeLinksForScope({ repoRoot, rootDir, scope, queue }) {
  const rootPath = resolvePathWithin(repoRoot, rootDir);
  if (!(await pathExists(rootPath))) {
    return;
  }

  const entries = await listDir(rootPath);
  for (const entry of entries) {
    const itemRoot = path.join(rootPath, entry);
    if (!(await isDirectory(itemRoot))) {
      continue;
    }

    const scoped = filterWritebackQueue(queue, { scope, targetId: entry });
    const targetPath = path.join(itemRoot, 'runtime-links.json');
    await ensureDir(path.dirname(targetPath));
    await writeJson(targetPath, {
      scope,
      targetId: entry,
      targetPath: path.relative(repoRoot, itemRoot).split(path.sep).join('/'),
      pendingCount: scoped.count,
      targetDocs: scoped.targetDocs,
      items: scoped.items,
      updatedAt: new Date().toISOString()
    });
  }
}
