import path from 'path';

export function sanitizePath(inputPath: string): string {
    if (!inputPath || typeof inputPath !== 'string') {
        throw new Error('Caminho inválido');
    }

    const decoded = decodeURIComponent(inputPath);
    if (decoded.includes('..')) {
        throw new Error('Path traversal não permitido');
    }

    const normalized = path.normalize(inputPath);

    if (normalized.includes('..')) {
        throw new Error('Path traversal não permitido');
    }

    if (path.isAbsolute(normalized)) {
        throw new Error("Caminho absoluto não permitido para segurança do Workspace.");
    }

    return normalized;
}