import fs from 'fs';
import path from 'path';
import { getTraceId } from '../shared/TraceContext';
import { emitDebug } from '../shared/DebugBus';
import { sanitizePath } from '../shared/sanitizePath';
import { SessionManager } from '../shared/SessionManager';

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
        this.basePath = path.join(process.cwd(), 'workspace');
        this.initWorkspace();
    }

    private initWorkspace() {
        const dirs = ['projects', 'assets', 'exports', 'temp'];

        if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true });
        }

        for (const dir of dirs) {
            const dirPath = path.join(this.basePath, dir);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
        }
    }

    private getProjectPath(projectId: string): string {
        return path.join(this.basePath, 'projects', projectId);
    }

    public getProjectRootPath(projectId: string): string {
        return this.getProjectPath(projectId);
    }

    public getProjectOutputPath(projectId: string): string {
        return path.join(this.getProjectPath(projectId), 'output');
    }

    public projectExists(projectId: string): boolean {
        if (!projectId || typeof projectId !== 'string') {
            return false;
        }

        return fs.existsSync(this.getProjectPath(projectId));
    }

    public createProject(name: string, type: ProjectType, agent: string, prompt: string): string {
        if (typeof name !== 'string' || !name.trim()) {
            throw new Error('Invalid project name');
        }

        if (typeof prompt !== 'string' || !prompt.trim()) {
            throw new Error('Invalid project prompt');
        }

        const session = SessionManager.getCurrentSession();
        if (session?.current_project_id && this.projectExists(session.current_project_id)) {
            session.current_goal = prompt;
            session.last_action = `Reused project: ${session.current_project_id}`;
            emitDebug('tool', {
                name: 'workspace_create',
                status: 'reused',
                project_id: session.current_project_id
            });
            return session.current_project_id;
        }

        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const safeSlug = slug || `project-${Date.now()}`;
        const projectId = `${safeSlug}-${Date.now()}`;
        const projectPath = this.getProjectPath(projectId);

        if (fs.existsSync(projectPath)) {
            throw new Error(`Projeto ${projectId} ja existe.`);
        }

        fs.mkdirSync(projectPath, { recursive: true });
        fs.mkdirSync(path.join(projectPath, 'output'));
        fs.mkdirSync(path.join(projectPath, 'assets'));
        fs.mkdirSync(path.join(projectPath, 'logs'));

        const metadata: ProjectMetadata = {
            name,
            type,
            agent,
            prompt,
            trace_id: getTraceId(),
            created_at: Date.now(),
            status: 'in_progress'
        };

        fs.writeFileSync(path.join(projectPath, 'project.json'), JSON.stringify(metadata, null, 2), 'utf8');
        fs.writeFileSync(path.join(projectPath, 'prompt.md'), `# ${name}\n\n**Trace ID:** ${metadata.trace_id}\n\n## Prompt\n${prompt}`, 'utf8');

        if (session) {
            session.current_project_id = projectId;
            session.current_goal = prompt;
            session.last_artifacts = [];
            session.last_action = `Created project: ${name}`;
        }

        emitDebug('tool', { name: 'workspace_create', status: 'success', project_id: projectId });
        return projectId;
    }

    public updateStatus(projectId: string, status: ProjectMetadata['status']) {
        const file = path.join(this.basePath, 'projects', projectId, 'project.json');
        if (!fs.existsSync(file)) {
            throw new Error(`Metadados do projeto ${projectId} nao encontrados.`);
        }

        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        data.status = status;
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    }

    public saveArtifact(projectId: string, filename: string, content: string | Buffer): string {
        const projectPath = path.join(this.basePath, 'projects', projectId);
        if (!fs.existsSync(projectPath)) {
            throw new Error(`Projeto ${projectId} nao encontrado.`);
        }

        const safePath = sanitizePath(filename);
        const outputPath = path.join(projectPath, 'output', safePath);
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(outputPath, content);

        const session = SessionManager.getCurrentSession();
        if (session && !session.last_artifacts.includes(filename)) {
            session.last_artifacts.push(filename);
            session.last_action = `Saved artifact: ${filename}`;
        }

        emitDebug('tool', { name: 'workspace_save', project_id: projectId, file: filename, status: 'success' });
        return outputPath;
    }
}

export const workspaceService = new WorkspaceService();
