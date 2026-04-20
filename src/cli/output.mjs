export function createSuccessResult({
  command,
  cwd,
  data = {},
  human = {},
  warnings = [],
  next = []
}) {
  return {
    ok: true,
    command,
    cwd,
    data,
    human,
    warnings,
    next
  };
}

export function createErrorResult({
  command,
  cwd,
  code,
  message,
  warnings = [],
  next = []
}) {
  return {
    ok: false,
    command,
    cwd,
    error: {
      code,
      message
    },
    warnings,
    next
  };
}

export async function printResult(result, { asJson = false, stdout, stderr }) {
  if (asJson) {
    const output = {
      ok: result.ok,
      command: result.command,
      mode: "json",
      cwd: result.cwd,
      ...(result.ok ? { data: result.data } : { error: result.error }),
      warnings: result.warnings ?? [],
      next: result.next ?? []
    };
    stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  const stream = result.ok ? stdout : stderr;

  if (result.ok) {
    if (result.human?.summary) {
      stream.write(`${result.human.summary}\n`);
    }

    for (const section of result.human?.sections ?? []) {
      stream.write(`\n${section.title}\n`);
      if (section.preformatted) {
        for (const item of section.items) {
          if (!item.trim()) {
            continue;
          }
          stream.write(`${item}\n`);
        }
        continue;
      }

      for (const item of section.items) {
        if (!item.trim()) {
          continue;
        }
        stream.write(`- ${item}\n`);
      }
    }
  } else {
    stream.write(`执行失败：${result.error.message}\n`);
  }

  if (result.warnings?.length) {
    stream.write(`\n提示\n`);
    for (const warning of result.warnings) {
      stream.write(`- ${warning}\n`);
    }
  }

  if (result.next?.length) {
    stream.write(`\n下一步建议\n`);
    for (const item of result.next) {
      stream.write(`- ${item}\n`);
    }
  }
}

export function mapErrorCodeToExitCode(code) {
  switch (code) {
    case "INVALID_ARGS":
    case "CHANGE_NOT_FOUND":
      return 2;
    case "PATH_CONFLICT":
    case "WRITE_DENIED":
      return 3;
    case "INVALID_CONFIG":
    case "DRIFT_DETECTED":
      return 4;
    default:
      return 1;
  }
}
