export function renderTemplate(template, variables) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = variables[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function toSlug(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function toModuleListText(moduleNames) {
  if (!moduleNames.length) {
    return "当前无";
  }

  return moduleNames.map((name) => `- ${name}`).join("\n");
}
