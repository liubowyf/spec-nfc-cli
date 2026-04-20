import path from 'node:path';
import { getRepoPaths, resolvePathWithin } from './paths.mjs';
import { loadConfig } from './config.mjs';
import { ensureDir, isDirectory, listDir, pathExists, readJson, writeJson } from '../utils/fs.mjs';

export async function updateRepositoryIndexes({ repoRoot }) {
  const repoPaths = getRepoPaths(repoRoot);
  const config = await loadConfig(repoRoot);
  const enabledModules = Object.entries(config.modules || {})
    .filter(([, meta]) => meta?.enabled)
    .map(([name]) => name)
    .sort();
  const now = new Date().toISOString();

  const activeChanges = await collectChangeItems({ root: repoPaths.changesRoot, repoRoot, archived: false });
  const archivedChanges = await collectChangeItems({ root: repoPaths.archiveRoot, repoRoot, archived: true });
  const integrations = await collectIntegrationItems({ root: repoPaths.integrationsRoot, repoRoot });
  const projectRef = await readOptionalJson(resolvePathWithin(repoRoot, '.specnfc/contract/project.ref.json'));
  const teamRef = await readOptionalJson(resolvePathWithin(repoRoot, '.specnfc/contract/team-contract.ref.json'));
  const runtimeLedger = await readOptionalJson(resolvePathWithin(repoRoot, '.nfc/state/runtime-ledger.json'));

  await ensureDir(resolvePathWithin(repoRoot, '.specnfc/indexes'));

  const repoIndex = {
    repoId: config.repository?.name ?? path.basename(repoRoot),
    profile: config.repository?.profile ?? 'minimal',
    modules: enabledModules,
    counts: {
      activeChanges: activeChanges.length,
      archivedChanges: archivedChanges.length,
      integrations: integrations.length
    },
    updatedAt: now
  };

  const projectIndex = {
    projectId: projectRef?.projectId || config.repository?.name || path.basename(repoRoot),
    teamId: projectRef?.teamId || teamRef?.teamId || null,
    teamContextRefs: normalizeContextRefs(projectRef?.sharedDocs || []),
    projectDocs: {
      readme: 'specs/project/README.md',
      summary: 'specs/project/summary.md',
      readingPath: [
        'specs/project/summary.md',
        '.specnfc/indexes/project-index.json',
        '.specnfc/README.md',
        'specs/changes/<change-id>/01-需求与方案.md',
        'specs/changes/<change-id>/02-技术设计与选型.md',
        'specs/changes/<change-id>/03-任务计划与执行.md',
        'specs/changes/<change-id>/04-验收与交接.md'
      ]
    },
    changeRefs: activeChanges.map(toProjectRefItem),
    integrationRefs: integrations.map(toProjectRefItem),
    latestIterations: buildLatestIterations({ activeChanges, integrations }),
    updatedAt: now
  };

  const changeIndex = {
    items: [...activeChanges, ...archivedChanges],
    updatedAt: now
  };

  const integrationIndex = {
    items: integrations,
    updatedAt: now
  };

  const docIndex = {
    repository: [
      '.specnfc/README.md',
      '.specnfc/contract/repo.json',
      '.specnfc/runtime/active-rules.json',
      '.specnfc/execution/next-step.json',
      '.specnfc/governance/registries/team-policy-registry.json',
      '.specnfc/governance/registries/team-skill-pack-registry.json',
      '.specnfc/governance/registries/team-approval-registry.json',
      '.specnfc/governance/registries/team-waiver-registry.json',
      '.specnfc/governance/registries/team-project-catalog.json',
      '.specnfc/governance/registries/project-repo-registry.json',
      '.specnfc/governance/registries/project-integration-registry.json',
      'specs/README.md',
      'specs/project/README.md',
      'specs/project/summary.md'
    ],
    project: {
      index: '.specnfc/indexes/project-index.json',
      docs: ['specs/project/README.md', 'specs/project/summary.md']
    },
    changes: activeChanges.map((item) => ({ id: item.id, path: item.path, docRoles: normalizeChangeDocRoles(item.docRoles) })),
    integrations: integrations.map((item) => ({ id: item.id, path: item.path })),
    runtime: ['.nfc/README.md', '.nfc/runtime.json', '.nfc/state/runtime-ledger.json', '.nfc/logs/runtime-events.ndjson'],
    updatedAt: now
  };

  const runtimeIndex = {
    runtimeRoot: '.nfc',
    trackedDomains: ['context', 'interviews', 'plans', 'state', 'logs', 'handoffs', 'notes', 'sync'],
    auditFiles: ['.nfc/state/runtime-ledger.json', '.nfc/logs/runtime-events.ndjson'],
    audit: runtimeLedger
      ? {
          status: runtimeLedger.status ?? 'unknown',
          currentPhase: runtimeLedger.sessionTrace?.currentPhase ?? null,
          pendingWritebackCount: runtimeLedger.writeback?.pendingCount ?? 0,
          historyCount: runtimeLedger.writeback?.historyCount ?? 0,
          decisionCount: runtimeLedger.stageDecisions?.decisionCount ?? 0,
          evidenceRefCount: runtimeLedger.evidenceRefs?.totalRefs ?? 0,
          trackedTargetCount: runtimeLedger.runtimeLinks?.trackedTargetCount ?? 0,
          runtimeEventCount: runtimeLedger.eventStreams?.runtimeEventCount ?? 0,
          updatedAt: runtimeLedger.updatedAt ?? now
        }
      : {
          status: 'missing',
          currentPhase: null,
          pendingWritebackCount: 0,
          historyCount: 0,
          decisionCount: 0,
          evidenceRefCount: 0,
          trackedTargetCount: 0,
          runtimeEventCount: 0,
          updatedAt: now
        },
    updatedAt: now
  };

  await writeJson(resolvePathWithin(repoRoot, '.specnfc/indexes/repo-index.json'), repoIndex);
  await writeJson(resolvePathWithin(repoRoot, '.specnfc/indexes/project-index.json'), projectIndex);
  await writeJson(resolvePathWithin(repoRoot, '.specnfc/indexes/change-index.json'), changeIndex);
  await writeJson(resolvePathWithin(repoRoot, '.specnfc/indexes/integration-index.json'), integrationIndex);
  await writeJson(resolvePathWithin(repoRoot, '.specnfc/indexes/doc-index.json'), docIndex);
  await writeJson(resolvePathWithin(repoRoot, '.specnfc/indexes/runtime-index.json'), runtimeIndex);

  return { repoIndex, projectIndex, changeIndex, integrationIndex, docIndex, runtimeIndex };
}

async function collectChangeItems({ root, repoRoot, archived }) {
  if (!(await pathExists(root))) {
    return [];
  }
  const entries = await listDir(root);
  const items = [];
  for (const entry of entries) {
    const targetRoot = path.join(root, entry);
    if (!(await isDirectory(targetRoot))) {
      continue;
    }
    const metaPath = path.join(targetRoot, 'meta.json');
    let meta = null;
    if (await pathExists(metaPath)) {
      try {
        meta = await readJson(metaPath);
      } catch {}
    }
    items.push({
      id: meta?.id ?? entry,
      title: meta?.title ?? entry,
      docRoles: normalizeChangeDocRoles(meta?.docRoles),
      stage: meta?.stage ?? (archived ? 'archived' : 'draft'),
      canonicalStage: meta?.canonicalStage ?? (archived ? 'archive' : 'clarify'),
      archived,
      path: path.relative(repoRoot, targetRoot).split(path.sep).join('/'),
      updatedAt: meta?.updatedAt ?? null
    });
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return items;
}

async function collectIntegrationItems({ root, repoRoot }) {
  if (!(await pathExists(root))) {
    return [];
  }
  const entries = await listDir(root);
  const items = [];
  for (const entry of entries) {
    const targetRoot = path.join(root, entry);
    if (!(await isDirectory(targetRoot))) {
      continue;
    }
    const metaPath = path.join(targetRoot, 'meta.json');
    let meta = null;
    if (await pathExists(metaPath)) {
      try {
        meta = await readJson(metaPath);
      } catch {}
    }
    items.push({
      id: meta?.id ?? entry,
      status: meta?.status ?? 'draft',
      canonicalStage: meta?.canonicalStage ?? 'clarify',
      path: path.relative(repoRoot, targetRoot).split(path.sep).join('/'),
      updatedAt: meta?.updatedAt ?? null
    });
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return items;
}

async function readOptionalJson(targetPath) {
  if (!(await pathExists(targetPath))) {
    return null;
  }

  try {
    return await readJson(targetPath);
  } catch {
    return null;
  }
}

function normalizeContextRefs(items) {
  return items
    .map((item, index) => {
      if (typeof item === 'string') {
        return {
          id: `context-${index + 1}`,
          sourceRepo: item,
          path: item
        };
      }

      if (item && typeof item === 'object') {
        return {
          id: item.id ?? `context-${index + 1}`,
          sourceRepo: item.sourceRepo ?? item.repo ?? item.path ?? 'unknown',
          path: item.path ?? item.summaryPath ?? '',
          digest: item.digest,
          summaryPath: item.summaryPath
        };
      }

      return null;
    })
    .filter((item) => item?.path);
}

function toProjectRefItem(item) {
  return {
    id: item.id,
    path: item.path,
    canonicalStage: item.canonicalStage,
    summary: item.title ?? item.status ?? item.id
  };
}

function normalizeChangeDocRoles(docRoles) {
  if (docRoles && typeof docRoles === 'object') {
    return {
      requirementsAndSolution: docRoles.requirementsAndSolution ?? '01-需求与方案.md',
      technicalDesign: docRoles.technicalDesign ?? '02-技术设计与选型.md',
      planAndExecution: docRoles.planAndExecution ?? '03-任务计划与执行.md',
      acceptanceAndHandoff: docRoles.acceptanceAndHandoff ?? '04-验收与交接.md'
    };
  }

  return null;
}

function buildLatestIterations({ activeChanges, integrations }) {
  const items = [
    ...activeChanges.map((item) => ({
      id: item.id,
      kind: 'change',
      summary: `${item.id}｜${item.title ?? item.id}`,
      linkedDocs: [item.path],
      updatedAt: item.updatedAt ?? ''
    })),
    ...integrations.map((item) => ({
      id: item.id,
      kind: 'integration',
      summary: `${item.id}｜${item.status ?? 'draft'}`,
      linkedDocs: [item.path],
      updatedAt: item.updatedAt ?? ''
    }))
  ];

  return items
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
    .slice(0, 10);
}
