import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Utilitário para detecção de binários no PATH do sistema ou locais.
 */
export function findBinary(binName: string): string | null {
    const separator = process.platform === 'win32' ? ';' : ':';
    const paths = (process.env.PATH || "").split(separator);
    const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];

    // 1. Check in PATH
    for (const p of paths) {
        for (const ext of extensions) {
            const full = path.join(p, `${binName}${ext}`);
            if (fs.existsSync(full)) return full;
        }
    }

    // 2. Check in local bin directory if exists
    const localBin = path.join(process.cwd(), 'bin', binName);
    if (fs.existsSync(localBin)) return localBin;

    return null;
}

/**
 * Resolve o caminho de um binário ou retorna o nome se não encontrado (fallback para shell).
 */
export function resolveBinary(name: string): string {
    return findBinary(name) || name;
}

/**
 * Detecta a presença do Whisper (CLI ou via Python).
 */
export function detectWhisper(): { available: boolean; type?: string } {
    if (findBinary("whisper")) return { available: true, type: "whisper-cli" };

    try {
        execSync("python3 -c \"import whisper\"", { stdio: "ignore" });
        return { available: true, type: "python-whisper" };
    } catch { }

    try {
        execSync("python3 -c \"import faster_whisper\"", { stdio: "ignore" });
        return { available: true, type: "faster-whisper" };
    } catch { }

    return { available: false };
}
