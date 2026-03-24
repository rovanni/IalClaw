import path from 'path';

export function sanitizePath(inputPath: string): string {
    const normalized = path.normalize(inputPath).replace(/^(\.\.(\/|\\|$))+/, '');

    if (path.isAbsolute(normalized)) {
        throw new Error("Caminho absoluto não permitido para segurança do Workspace.");
    }

    return normalized;
}