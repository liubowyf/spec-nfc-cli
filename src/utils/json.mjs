export function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) {
    return patch;
  }

  if (!isObject(base) || !isObject(patch)) {
    return patch;
  }

  const result = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (isObject(value) && isObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
