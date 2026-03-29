import * as http from "http";
import { spawn } from "child_process";

const USE_OLLAMA = process.env.USE_OLLAMA === "true";
const OLLAMA_API = process.env.OLLAMA_API || "http://localhost:11434";
const OLLAMA_BIN = process.env.OLLAMA_BIN || "ollama";

export async function isOllamaEnabled(): Promise<boolean> {
  return USE_OLLAMA;
}

export async function isOllamaRunning(): Promise<boolean> {
  if (!USE_OLLAMA) return false;
  return new Promise((resolve) => {
    const url = `${OLLAMA_API}/api/version`;
    const req = http.get(url, (res) => {
      resolve(res.statusCode === 200);
    });

    req.on("error", () => {
      resolve(false);
    });

    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function startOllama(): Promise<boolean> {
  if (!USE_OLLAMA) return false;
  // Tenta iniciar via systemd (Linux)
  if (process.platform === "linux") {
    try {
      await new Promise((resolve, reject) => {
        const proc = spawn("systemctl", ["start", "ollama.service"]);
        proc.on("close", (code) => (code === 0 ? resolve(true) : reject()));
      });
      return true;
    } catch {}
  }
  // Fallback: inicia o binário diretamente
  try {
    spawn(OLLAMA_BIN, ["serve"], { detached: true, stdio: "ignore" }).unref();
    await new Promise((r) => setTimeout(r, 2000));
    return await isOllamaRunning();
  } catch {
    return false;
  }
}
