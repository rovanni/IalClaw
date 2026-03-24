import { LLMProvider, MessagePayload } from '../../../engine/ProviderFactory';
import { ExecutionPlan, PlanStep } from '../types';

export interface PlanTemplateContext {
    goal: string;
    provider: LLMProvider;
    hasActiveProject: boolean;
}

export interface PlanTemplate {
    id: string;
    description: string;
    match: (goal: string) => boolean;
    build: (context: PlanTemplateContext) => Promise<ExecutionPlan>;
}

function buildStep(id: number, tool: string, input: Record<string, any>): PlanStep {
    return {
        id,
        type: 'tool',
        tool,
        input,
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

async function generateHtmlFromGoal(goal: string, provider: LLMProvider): Promise<string> {
    const messages: MessagePayload[] = [
        {
            role: 'system',
            content: `You generate complete single-file web projects.
Return ONLY valid HTML.
Use inline CSS and inline JavaScript when needed.
Do not include markdown fences.
The output must be immediately runnable as index.html.`
        },
        {
            role: 'user',
            content: `Create a complete HTML file for this goal:
${goal}

Requirements:
- include full <!DOCTYPE html>
- include all CSS inline in <style>
- include all JavaScript inline in <script>
- make it functional, not a placeholder`
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
    build: async ({ goal, provider, hasActiveProject }: PlanTemplateContext): Promise<ExecutionPlan> => {
        const steps: PlanStep[] = [];

        if (!hasActiveProject) {
            steps.push(buildStep(1, 'workspace_create_project', {
                name: extractProjectName(goal),
                type: 'code',
                prompt: goal
            }));
        }

        const nextId = steps.length + 1;
        const html = await generateHtmlFromGoal(goal, provider);

        steps.push(buildStep(nextId, 'workspace_save_artifact', {
            filename: 'index.html',
            content: html
        }));

        return {
            goal,
            steps
        };
    }
};

export const PLAN_TEMPLATES: PlanTemplate[] = [
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
