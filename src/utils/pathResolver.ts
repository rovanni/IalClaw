import path from "path";

const BASE_PATH = "/home/venus/ialclaw";

export function resolvePath(input: string): string {
  if (!input) return BASE_PATH;

  if (input.startsWith("/workspace")) {
    return path.join(BASE_PATH, input.replace("/workspace", "workspace"));
  }

  if (path.isAbsolute(input)) {
    return input;
  }

  return path.join(BASE_PATH, input);
}
