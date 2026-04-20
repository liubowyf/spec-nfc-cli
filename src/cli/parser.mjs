export function parseArgv(argv) {
  const args = [...argv];
  let command = null;
  const positionals = [];
  const flags = {};

  while (args.length) {
    const current = args.shift();

    if (!command && !current.startsWith("-")) {
      command = current;
      continue;
    }

    if (current.startsWith("--")) {
      const [rawKey, inlineValue] = current.slice(2).split("=");
      const key = normalizeFlag(rawKey);

      if (inlineValue !== undefined) {
        flags[key] = inlineValue;
        continue;
      }

      const next = args[0];
      if (next && !next.startsWith("-")) {
        flags[key] = args.shift();
      } else {
        flags[key] = true;
      }
      continue;
    }

    positionals.push(current);
  }

  return {
    command,
    args: positionals,
    flags
  };
}

function normalizeFlag(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
