import fs from 'fs';
import path from 'path';
import { workspaceService } from '../../services/WorkspaceService';

const MAX_PREVIEW_LENGTH = 500;
const MAX_FILES_IN_PROMPT = 6;

export interface WorkspaceFileContext {
    name: string;
    relative_path: string;
    size: number;
    preview: string;
}

function walkFiles(dir: string, rootDir: string): WorkspaceFileContext[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files: WorkspaceFileContext[] = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            files = files.concat(walkFiles(fullPath, rootDir));
            continue;
        }

        try {
            const content = fs.readFileSync(fullPath, 'utf8');
            const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

            files.push({
                name: entry.name,
                relative_path: relativePath,
                size: content.length,
                preview: content.slice(0, MAX_PREVIEW_LENGTH)
            });
        } catch {
            // Skip unreadable or binary files from prompt context.
        }
    }

    return files;
}

function filePriority(relativePath: string): number {
    const normalized = relativePath.toLowerCase();

    if (normalized === 'index.html') return 0;
    if (normalized.endsWith('.html')) return 1;
    if (normalized.endsWith('.css')) return 2;
    if (normalized.endsWith('.js')) return 3;
    return 4;
}

export function buildWorkspaceContext(projectId?: string): WorkspaceFileContext[] {
    if (!projectId || !workspaceService.projectExists(projectId)) {
        return [];
    }

    const outputPath = workspaceService.getProjectOutputPath(projectId);
    if (!fs.existsSync(outputPath)) {
        return [];
    }

    return walkFiles(outputPath, outputPath)
        .sort((a, b) => {
            const priorityDiff = filePriority(a.relative_path) - filePriority(b.relative_path);
            if (priorityDiff !== 0) {
                return priorityDiff;
            }

            return a.relative_path.localeCompare(b.relative_path);
        })
        .slice(0, MAX_FILES_IN_PROMPT);
}

export function formatWorkspaceContext(files: WorkspaceFileContext[]): string {
    if (!files || files.length === 0) {
        return '';
    }

    const formattedFiles = files.map(file => `File: ${file.relative_path}
Size: ${file.size}
Preview:
${file.preview}`).join('\n\n');

    return `WORKSPACE ATUAL (arquivos ja existentes no projeto):
${formattedFiles}

REGRAS DE WORKSPACE AWARENESS:
- Se um arquivo ja existe, prefira MODIFICAR esse arquivo.
- Nao crie arquivos duplicados para resolver algo que cabe em um arquivo existente.
- Nao recrie o projeto.
- Se "index.html" ja existir, prefira atualizar "index.html".
- Prefira solucoes em arquivo unico quando isso simplificar a manutencao.`;
}

export function selectRepairRelevantFiles(files: WorkspaceFileContext[]): WorkspaceFileContext[] {
    if (!files || files.length === 0) {
        return [];
    }

    const relevant = files.filter(file => {
        const normalized = file.relative_path.toLowerCase();
        return normalized === 'index.html'
            || normalized.endsWith('.html')
            || normalized.endsWith('.js')
            || normalized.endsWith('.css');
    });

    return (relevant.length > 0 ? relevant : files).slice(0, MAX_FILES_IN_PROMPT);
}

export function formatWorkspaceForRepair(files: WorkspaceFileContext[]): string {
    const relevantFiles = selectRepairRelevantFiles(files);

    if (relevantFiles.length === 0) {
        return '';
    }

    const fileList = relevantFiles.map(file => `- ${file.relative_path}`).join('\n');
    const previews = relevantFiles.map(file => `File: ${file.relative_path}
Preview:
${file.preview}`).join('\n\n');

    return `ESTADO ATUAL DO PROJETO (para correcao):
Voce esta corrigindo um projeto EXISTENTE.

Arquivos relevantes existentes:
${fileList}

Previews-chave:
${previews}

REGRAS DE REPARO COM WORKSPACE AWARENESS:
- Este e um projeto ja existente.
- Nao crie um novo projeto.
- Nao crie arquivos duplicados se um arquivo existente puder ser atualizado.
- Se "index.html" existir, prefira corrigir ou expandir esse mesmo arquivo.
- Aplique a menor correcao util possivel usando a estrutura atual do projeto.`;
}
