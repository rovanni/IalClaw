import { WorkspaceFileContext } from './workspaceContext';

interface FileTargetParams {
    goal?: string;
    error?: any;
    files: WorkspaceFileContext[];
}

export interface RankedFile {
    name: string;
    relative_path: string;
    score: number;
    confidence: number;
    reasons: string[];
}

export interface FileSelection {
    target: string;
    confidence: number;
    reasons: string[];
    top2Gap: number;
    ranked: RankedFile[];
}

function buildGoalHints(goal: string): string[] {
    const normalizedGoal = goal.toLowerCase();
    const hints = [normalizedGoal];

    if (normalizedGoal.includes('css') || normalizedGoal.includes('style')) {
        hints.push('css', 'style');
    }

    if (normalizedGoal.includes('js') || normalizedGoal.includes('script') || normalizedGoal.includes('som')) {
        hints.push('js', 'script', 'audio', 'sound', 'som');
    }

    if (
        normalizedGoal.includes('html')
        || normalizedGoal.includes('pagina')
        || normalizedGoal.includes('site')
        || normalizedGoal.includes('jogo')
    ) {
        hints.push('html', 'canvas', 'game', 'jogo');
    }

    return hints.filter(Boolean);
}

export function rankFiles(params: FileTargetParams): RankedFile[] {
    const { goal = '', error, files } = params;

    if (!files || files.length === 0) {
        return [];
    }

    const goalHints = buildGoalHints(goal);
    const errorPath = String(error?.path || '').toLowerCase();
    const results = files.map(file => {
        const normalizedName = file.relative_path.toLowerCase();
        const normalizedPreview = file.preview.toLowerCase();
        let score = 0;
        const reasons: string[] = [];

        if (normalizedName === 'index.html') {
            score += 5;
            reasons.push('main_entry');
        }

        if (normalizedName.endsWith('.html')) {
            score += 3;
            reasons.push('html');
        }

        if (normalizedName.endsWith('.js')) {
            score += 2;
            reasons.push('js');
        }

        if (normalizedName.endsWith('.css')) {
            score += 2;
            reasons.push('css');
        }

        for (const hint of goalHints) {
            if (hint.length >= 2 && normalizedPreview.includes(hint)) {
                score += 1;
                reasons.push(`goal_hint:${hint}`);
                break;
            }
        }

        if (errorPath && normalizedPreview.includes(errorPath)) {
            score += 4;
            reasons.push('error_match');
        }

        return {
            name: file.name,
            relative_path: file.relative_path,
            score,
            confidence: 0,
            reasons
        };
    }).sort((a, b) => b.score - a.score || a.relative_path.localeCompare(b.relative_path));

    const maxScore = results[0]?.score || 1;
    return results.map(result => ({
        ...result,
        confidence: maxScore > 0 ? result.score / maxScore : 0
    }));
}

export function selectWithConfidence(ranked: RankedFile[]): FileSelection | null {
    if (!ranked.length) {
        return null;
    }

    const best = ranked[0];
    const second = ranked[1];

    return {
        target: best.relative_path,
        confidence: best.confidence,
        reasons: best.reasons,
        top2Gap: second ? best.score - second.score : best.score,
        ranked
    };
}

export function selectTargetFile(params: FileTargetParams): string | null {
    return selectWithConfidence(rankFiles(params))?.target || null;
}

export function formatTargetFileBlock(selection: FileSelection | null): string {
    if (!selection) {
        return '';
    }

    const confidenceLabel = selection.confidence >= 0.8
        ? 'alta'
        : selection.confidence >= 0.5
            ? 'media'
            : 'baixa';

    let guidance = '- Modifique esse arquivo quando isso resolver o objetivo sem criar duplicacao.';

    if (selection.confidence >= 0.8) {
        guidance = '- Modifique este arquivo diretamente sempre que possivel.';
    } else if (selection.confidence < 0.5) {
        guidance = '- A escolha ainda e incerta. Verifique a estrutura atual antes de editar e prefira index.html se ele existir.';
    }

    return `ARQUIVO-ALVO:
- Arquivo mais provavel: ${selection.target}
- Confianca da selecao: ${confidenceLabel} (${selection.confidence.toFixed(2)})
- Motivos: ${selection.reasons.length > 0 ? selection.reasons.join(', ') : 'heuristica_basica'}
${guidance}
- So crie outro arquivo se isso for absolutamente necessario.`;
}
