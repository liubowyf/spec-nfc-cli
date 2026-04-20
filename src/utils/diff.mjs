export function summarizeTextDiff(beforeText, afterText, options = {}) {
  const contextLines = options.contextLines ?? 2;
  const maxPreviewLines = options.maxPreviewLines ?? 12;

  const beforeLines = normalizeLines(beforeText);
  const afterLines = normalizeLines(afterText);
  const region = findChangedRegion(beforeLines, afterLines);
  const beforeContextStart = Math.max(0, region.prefix - contextLines);
  const beforeContext = beforeLines.slice(beforeContextStart, region.prefix);
  const afterContext = afterLines.slice(region.afterSuffix + 1, region.afterSuffix + 1 + contextLines);

  const removed = beforeLines.slice(region.prefix, region.beforeSuffix + 1);
  const added = afterLines.slice(region.prefix, region.afterSuffix + 1);

  const preview = [
    ...beforeContext.map((line) => ` ${line}`),
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    ...afterContext.map((line) => ` ${line}`)
  ].slice(0, maxPreviewLines);

  return {
    changed: removed.length > 0 || added.length > 0,
    beforeStartLine: beforeContextStart + 1,
    afterStartLine: beforeContextStart + 1,
    removedCount: removed.length,
    addedCount: added.length,
    preview
  };
}

export function createUnifiedDiff(beforeText, afterText, options = {}) {
  const contextLines = options.contextLines ?? 2;
  const maxLines = options.maxLines ?? 24;
  const beforeLabel = options.beforeLabel ?? "a/file";
  const afterLabel = options.afterLabel ?? "b/file";

  const beforeLines = normalizeLines(beforeText);
  const afterLines = normalizeLines(afterText);
  const region = findChangedRegion(beforeLines, afterLines);

  const beforeContextStart = Math.max(0, region.prefix - contextLines);
  const beforeLeadingContext = beforeLines.slice(beforeContextStart, region.prefix);
  const removed = beforeLines.slice(region.prefix, region.beforeSuffix + 1);
  const added = afterLines.slice(region.prefix, region.afterSuffix + 1);
  const trailingContextCount = Math.min(
    contextLines,
    beforeLines.length - (region.beforeSuffix + 1),
    afterLines.length - (region.afterSuffix + 1)
  );
  const trailingContext = afterLines.slice(region.afterSuffix + 1, region.afterSuffix + 1 + trailingContextCount);

  const beforeCount = beforeLeadingContext.length + removed.length + trailingContext.length;
  const afterCount = beforeLeadingContext.length + added.length + trailingContext.length;
  const beforeStart = beforeCount === 0 ? 0 : beforeContextStart + 1;
  const afterStart = afterCount === 0 ? 0 : beforeContextStart + 1;

  const bodyLines = [
    ...beforeLeadingContext.map((line) => ` ${line}`),
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    ...trailingContext.map((line) => ` ${line}`)
  ];
  const limitedBody = bodyLines.slice(0, maxLines);
  if (bodyLines.length > maxLines) {
    limitedBody.push("... (diff truncated)");
  }

  return [
    `--- ${beforeLabel}`,
    `+++ ${afterLabel}`,
    `@@ -${formatRange(beforeStart, beforeCount)} +${formatRange(afterStart, afterCount)} @@`,
    ...limitedBody
  ].join("\n");
}

function findChangedRegion(beforeLines, afterLines) {
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let beforeSuffix = beforeLines.length - 1;
  let afterSuffix = afterLines.length - 1;
  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    beforeLines[beforeSuffix] === afterLines[afterSuffix]
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }

  return { prefix, beforeSuffix, afterSuffix };
}

function formatRange(start, count) {
  return `${start},${count}`;
}

function normalizeLines(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  if (!normalized.length) {
    return [];
  }
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}
