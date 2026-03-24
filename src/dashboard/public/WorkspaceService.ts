import fs from 'fs';
import path from 'path';
import { getTraceId } from '../../shared/TraceContext';
import { emitDebug } from '../../shared/DebugBus';
import { sanitizePath } from '../../shared/sanitizePath';

export type ProjectType = 'code' | 'slides' | 'game' | 'document' | 'automation';

export interface ProjectMetadata {
    name: string;
    type: ProjectType;
    agent: string;
    prompt: string;
    trace_id: string;
    created_at: number;
    status: 'draft' | 'in_progress' | 'completed' | 'failed';
}

export class WorkspaceService {
    private basePath: string;

    constructor() {
        // Base do workspace na raiz do projeto
        this.basePath = path.join(process.cwd(), 'workspace');
        this.initWorkspace();
    }

    private initWorkspace() {
        const dirs = ['projects', 'assets', 'exports', 'temp'];

        if (!fs.existsSync(this.basePath)) fs.mkdirSync(this.basePath, { recursive: true });

        for (const dir of dirs) {
            const dirPath = path.join(this.basePath, dir);
            if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    public createProject(name: string, type: ProjectType, agent: string, prompt: string): string {
        // Gera um ID limpo e único para nome de pasta (ex: "aula-redes-1710000000")
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const projectId = `${slug}-${Date.now()}`;
        const projectPath = path.join(this.basePath, 'projects', projectId);

        if (fs.existsSync(projectPath)) {
            throw new Error(`Projeto ${projectId} já existe.`);
        }

        fs.mkdirSync(projectPath, { recursive: true });
        fs.mkdirSync(path.join(projectPath, 'output'));
        fs.mkdirSync(path.join(projectPath, 'assets'));
        fs.mkdirSync(path.join(projectPath, 'logs'));

        const metadata: ProjectMetadata = {
            name, type, agent, prompt,
            trace_id: getTraceId(), // 🔥 Link mágico com o raciocínio atual!
            created_at: Date.now(),
            status: 'in_progress'
        };

        // Salva o metadado que permitirá retomar o projeto depois
        fs.writeFileSync(path.join(projectPath, 'project.json'), JSON.stringify(metadata, null, 2), 'utf8');
        fs.writeFileSync(path.join(projectPath, 'prompt.md'), `# ${name}\n\n**Trace ID:** ${metadata.trace_id}\n\n## Prompt\n${prompt}`, 'utf8');

        emitDebug('tool', { name: 'workspace_create', status: 'success', project_id: projectId });
        return projectId;
    }

    public updateStatus(projectId: string, status: ProjectMetadata['status']) {
        const file = path.join(this.basePath, 'projects', projectId, 'project.json');
        if (!fs.existsSync(file)) throw new Error(`Metadados do projeto ${projectId} não encontrados.`);
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        data.status = status;
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    }

    public saveArtifact(projectId: string, filename: string, content: string | Buffer): string {
        const projectPath = path.join(this.basePath, 'projects', projectId);
        if (!fs.existsSync(projectPath)) throw new Error(`Projeto ${projectId} não encontrado.`);

        const safePath = sanitizePath(filename);
        const outputPath = path.join(projectPath, 'output', safePath);
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(outputPath, content);

        emitDebug('tool', { name: 'workspace_save', project_id: projectId, file: filename, status: 'success' });
        return outputPath;
    }
}

// Exporta como Singleton para uso em toda a aplicação
export const workspaceService = new WorkspaceService();