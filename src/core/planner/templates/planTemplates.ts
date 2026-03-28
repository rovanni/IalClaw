import { LLMProvider, MessagePayload } from '../../../engine/ProviderFactory';
import { ExecutionPlan, PlanStep } from '../types';
import { WorkspaceFileContext, formatWorkspaceContext } from '../workspaceContext';
import { formatTargetFileBlock, rankFiles, selectWithConfidence } from '../fileTargeting';
import { workspaceService } from '../../../services/WorkspaceService';

export interface PlanTemplateContext {
    goal: string;
    provider: LLMProvider;
    hasActiveProject: boolean;
    currentProjectId?: string;
    workspaceContext: WorkspaceFileContext[];
}

export interface PlanTemplate {
    id: string;
    description: string;
    match: (goal: string) => boolean;
    build: (context: PlanTemplateContext) => Promise<ExecutionPlan>;
}

type HtmlGenerationMode = 'web' | 'slides';

function buildStep(
    id: number,
    tool: string,
    input: Record<string, any>,
    capabilities?: PlanStep['capabilities']
): PlanStep {
    return {
        id,
        type: 'tool',
        tool,
        input,
        capabilities,
        is_repair: false
    };
}

export function extractProjectName(goal: string): string {
    const normalized = String(goal || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40);

    return normalized || 'project';
}

function fallbackHtml(goal: string): string {
    const safeGoal = String(goal || 'Projeto Web');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeGoal}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: Arial, sans-serif;
      background: #111827;
      color: #f9fafb;
    }
    main {
      max-width: 720px;
      padding: 32px;
      text-align: center;
    }
    h1 {
      margin-bottom: 12px;
    }
    p {
      color: #d1d5db;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <main>
    <h1>${safeGoal}</h1>
    <p>Estrutura inicial gerada automaticamente pelo template web do IalClaw.</p>
  </main>
</body>
</html>`;
}

async function generateHtmlFromGoal(
    goal: string,
    provider: LLMProvider,
    workspaceContext: WorkspaceFileContext[],
    activeProjectId?: string,
    mode: HtmlGenerationMode = 'web'
): Promise<string> {
    const workspaceBlock = formatWorkspaceContext(workspaceContext);
    const existingIndex = workspaceContext.find(file => file.relative_path === 'index.html');
    const rankedFiles = rankFiles({ goal, files: workspaceContext });
    const fileSelection = selectWithConfidence(rankedFiles);
    const targetBlock = formatTargetFileBlock(fileSelection);
    const targetFile = fileSelection?.target || 'index.html';
    const existingFileContent = activeProjectId
        ? workspaceService.readArtifact(activeProjectId, targetFile)
        : null;
    const isSlidesMode = mode === 'slides';
    const messages: MessagePayload[] = [
        {
            role: 'system',
            content: isSlidesMode
                ? `You generate complete single-file HTML slide decks.
Return ONLY valid HTML.
Use inline CSS and inline JavaScript when needed.
Do not include markdown fences.
The output must be immediately runnable as index.html.
Create professional slides with keyboard navigation, progress indication and responsive layout.
Prefer semantic sections for each slide.
If index.html already exists, update it instead of inventing a parallel structure.
When an existing file is provided, you MUST edit that file instead of regenerating a generic page.`
                : `You generate complete single-file web projects.
Return ONLY valid HTML.
Use inline CSS and inline JavaScript when needed.
Do not include markdown fences.
The output must be immediately runnable as index.html.
If index.html already exists, update it instead of inventing a parallel structure.
Prefer preserving working parts and extending the current file.
When an existing file is provided, you MUST edit that file instead of regenerating a generic page.`
        },
        {
            role: 'user',
            content: `${isSlidesMode ? 'Create a complete HTML slide deck for this goal' : 'Create a complete HTML file for this goal'}:
${goal}

Requirements:
- include full <!DOCTYPE html>
- include all CSS inline in <style>
- include all JavaScript inline in <script>
- make it functional, not a placeholder
- ${isSlidesMode ? 'include multiple content-rich slides, navigation controls and presentable visual hierarchy' : 'make the interface polished and usable'}
${workspaceBlock ? `\n\nCurrent workspace:\n${workspaceBlock}` : ''}
${targetBlock ? `\n\n${targetBlock}` : ''}
${existingFileContent ? `\n\nExisting file content (preserve and modify this file):\n${existingFileContent.slice(0, 12000)}` : ''}
${existingIndex ? '\n\nIMPORTANT: index.html already exists. Return an updated full replacement for that same file.' : ''}`
        }
    ];

    const response = await provider.generate(messages);
    const html = String(response.final_answer || '').trim();

    if (!html.toLowerCase().includes('<html')) {
        return fallbackHtml(goal);
    }

    return html;
}

export const createWebProjectTemplate: PlanTemplate = {
    id: 'create_web_project',
    description: 'Create or continue a web project with HTML/CSS/JS',
    match: (goal: string) => {
        const g = goal.toLowerCase();
        return (
            g.includes('html')
            || g.includes('web')
            || g.includes('jogo')
            || g.includes('site')
            || g.includes('pagina')
            || g.includes('landing')
        );
    },
    build: async ({ goal, provider, hasActiveProject, currentProjectId, workspaceContext }: PlanTemplateContext): Promise<ExecutionPlan> => {
        const steps: PlanStep[] = [];
        const rankedFiles = rankFiles({ goal, files: workspaceContext });
        const fileSelection = selectWithConfidence(rankedFiles);
        const targetFile = fileSelection?.target || 'index.html';

        if (!hasActiveProject) {
            steps.push(buildStep(1, 'workspace_create_project', {
                name: extractProjectName(goal),
                type: 'code',
                prompt: goal
            }));
        }

        const nextId = steps.length + 1;
        const html = await generateHtmlFromGoal(goal, provider, workspaceContext, currentProjectId, 'web');

        steps.push(buildStep(
            nextId,
            'workspace_save_artifact',
            {
                filename: targetFile,
                content: html
            },
            {
                requiresDOM: false
            }
        ));

        return {
            goal,
            steps
        };
    }
};

export const createSlidesProjectTemplate: PlanTemplate = {
    id: 'create_slides_project',
    description: 'Create or continue an HTML slides project',
    match: (goal: string) => {
        const g = goal.toLowerCase();
        return (
            // Palavras-chave diretas
            g.includes('slide')
            || g.includes('slides')
            || g.includes('apresentacao')
            || g.includes('apresentação')
            || g.includes('presentation')
            || g.includes('deck')
            // Criação de slides
            || g.includes('criar slide')
            || g.includes('gerar slide')
            || g.includes('fazer slide')
            || g.includes('montar slide')
            // HTML estruturado/apresentação
            || (g.includes('html') && (g.includes('estruturado') || g.includes('organizado')))
            || (g.includes('html') && g.includes('slide'))
            // Limite de linhas indica estrutura de slides
            || (g.includes('limite') && g.includes('linha'))
            || g.includes('6 linhas')
            || g.includes('seis linhas')
            // Organizar em slides/blocos
            || (g.includes('organizar') && (g.includes('slide') || g.includes('blocos') || g.includes('apresentacao')))
            || (g.includes('dividir') && g.includes('slide'))
        );
    },
    build: async ({ goal, provider, hasActiveProject, currentProjectId, workspaceContext }: PlanTemplateContext): Promise<ExecutionPlan> => {
        const steps: PlanStep[] = [];
        const rankedFiles = rankFiles({ goal, files: workspaceContext });
        const fileSelection = selectWithConfidence(rankedFiles);
        const targetFile = fileSelection?.target || 'index.html';

        if (!hasActiveProject) {
            steps.push(buildStep(1, 'workspace_create_project', {
                name: extractProjectName(goal),
                type: 'slides',
                prompt: goal
            }));
        }

        const nextId = steps.length + 1;
        const html = await generateHtmlFromGoal(goal, provider, workspaceContext, currentProjectId, 'slides');

        steps.push(buildStep(
            nextId,
            'workspace_save_artifact',
            {
                filename: targetFile,
                content: html
            },
            {
                requiresDOM: false
            }
        ));

        return {
            goal,
            steps
        };
    }
};

export const PLAN_TEMPLATES: PlanTemplate[] = [
    createSlidesProjectTemplate,
    createWebProjectTemplate
];

export function selectTemplate(goal: string): PlanTemplate | null {
    for (const template of PLAN_TEMPLATES) {
        if (template.match(goal)) {
            return template;
        }
    }

    return null;
}
