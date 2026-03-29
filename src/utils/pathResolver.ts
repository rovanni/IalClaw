import path from "path";

const BASE_PATH = process.cwd();

export function resolvePath(input: string): string {
  if (!input) return BASE_PATH;

  if (path.isAbsolute(input)) {
    return input;
  }

  const normalized = input.startsWith("/workspace") 
    ? input.replace("/workspace", "workspace") 
    : input;

  const resolved = path.resolve(BASE_PATH, normalized);

  if (!resolved.startsWith(BASE_PATH)) {
    throw new Error('Path traversal detectado');
  }

  return resolved;
}
