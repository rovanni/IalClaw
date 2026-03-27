import fs from 'fs';
import path from 'path';
import { CognitiveMemory } from './CognitiveMemory';
import { LLMProvider } from '../engine/ProviderFactory';

const INDEXABLE_EXTENSIONS = new Set(['.ts', '.js', '.html', '.css', '.py', '.json', '.md', '.yaml', '.yml', '.sh']);
const SKIP_PATTERNS = ['node_modules', 'dist', '.min.js', '.min.css'];
const MAX_CONTENT_FOR_SUMMARY = 3000;

export class CodeIndexer {
    constructor(private memory: CognitiveMemory, private provider: LLMProvider) {}

    public inferFileType(filename: string): 'controller' | 'service' | 'model' | 'config' | 'view' | 'other' {
        const lower = filename.toLowerCase();
        if (lower.includes('controller')) return 'controller';
        if (lower.includes('service')) return 'service';
        if (lower.includes('model') || lower.includes('schema')) return 'model';
        const ext = path.extname(lower);
        if (lower.includes('config') || ext === '.json' || ext === '.yaml' || ext === '.yml') return 'config';
        if (ext === '.html' || ext === '.css' || lower.includes('view') || lower.includes('template')) return 'view';
        return 'other';
    }

    private inferLanguage(filename: string): string {
        const ext = path.extname(filename).toLowerCase();
        const map: Record<string, string> = {
            '.ts': 'ts', '.js': 'js', '.html': 'html', '.css': 'css',
            '.py': 'py', '.json': 'json', '.md': 'md',
            '.yaml': 'yaml', '.yml': 'yaml', '.sh': 'sh'
        };
        return map[ext] || 'unknown';
    }

    private shouldIndex(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        if (!INDEXABLE_EXTENSIONS.has(ext)) return false;
        return !SKIP_PATTERNS.some(p => filePath.includes(p));
    }

    private estimateTokens(content: string): number {
        return Math.ceil(content.length / 4);
    }

    private async summarize(filePath: string, content: string): Promise<string> {
        const truncated = content.slice(0, MAX_CONTENT_FOR_SUMMARY);
        try {
            const response = await this.provider.generate([
                { role: 'system', content: 'Voce e um analista de codigo. Responda com uma unica frase curta (max 120 caracteres) descrevendo o que o arquivo faz. Sem markdown, sem listas.' },
                { role: 'user', content: `Arquivo: ${path.basename(filePath)}\n\n${truncated}` }
            ], []);
            return (response.final_answer || '').slice(0, 200).trim();
        } catch {
            return `${path.basename(filePath)} — arquivo do tipo ${this.inferFileType(path.basename(filePath))}`;
        }
    }

    public async indexFile(projectId: string, filePath: string, content: string): Promise<void> {
        if (!this.shouldIndex(filePath)) return;

        const language = this.inferLanguage(filePath);
        const fileType = this.inferFileType(path.basename(filePath));
        const summary = await this.summarize(filePath, content);
        const tokensEstimate = this.estimateTokens(content);

        await this.memory.saveCodeNode({
            projectId,
            filePath,
            language,
            summary,
            fileType,
            tokensEstimate
        });
    }

    public async indexProjectFiles(projectId: string, outputPath: string): Promise<void> {
        if (!fs.existsSync(outputPath)) return;

        const files = this.walkFiles(outputPath, outputPath);
        for (const { relativePath, fullPath } of files) {
            if (!this.shouldIndex(relativePath)) continue;
            try {
                const content = fs.readFileSync(fullPath, 'utf8');
                await this.indexFile(projectId, relativePath, content);
            } catch {
                // Skip unreadable or binary files
            }
        }
    }

    private walkFiles(dir: string, rootDir: string): { relativePath: string; fullPath: string }[] {
        const results: { relativePath: string; fullPath: string }[] = [];
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return results;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...this.walkFiles(fullPath, rootDir));
            } else {
                results.push({
                    relativePath: path.relative(rootDir, fullPath).replace(/\\/g, '/'),
                    fullPath
                });
            }
        }
        return results;
    }
}
