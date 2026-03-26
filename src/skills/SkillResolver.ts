import { LoadedSkill } from './types';
import { SkillLoader } from './SkillLoader';

export type ResolvedSkill = {
    /** Skill que foi identificada para a mensagem do usuário. */
    skill: LoadedSkill;
    /**
     * Query limpa para enviar ao LLM.
     * Nos slash commands, o prefixo `/nome-da-skill` é removido;
     * nos acionamentos por nome, o texto original é mantido.
     */
    query: string;
};

/**
 * Identifica qual skill deve ser ativada para uma mensagem do usuário.
 *
 * Estratégias de detecção (em ordem de prioridade):
 *   1. Slash command explícito: `/skill-name [args]`
 *   2. Menção direta ao nome da skill no texto
 */
export class SkillResolver {
    private skills: LoadedSkill[];

    constructor(loader: SkillLoader) {
        this.skills = loader.getAll();
    }

    /**
     * Retorna a skill correspondente e a query limpa, ou null se nenhuma combinar.
     */
    resolve(userInput: string): ResolvedSkill | null {
        if (!userInput) return null;
        const trimmed = userInput.trim();

        // ── Estratégia 1: slash command /skill-name [args] ──────────────────
        if (trimmed.startsWith('/')) {
            const spaceIdx = trimmed.indexOf(' ');
            const cmdSlug = spaceIdx === -1
                ? trimmed.slice(1)
                : trimmed.slice(1, spaceIdx);

            const skill = this.findByName(cmdSlug);
            if (skill) {
                const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
                return {
                    skill,
                    // Se o usuário não passou argumentos, usa a dica da skill ou ativa diretamente
                    query: args || skill.argumentHint || `Execute a skill ${skill.name}.`,
                };
            }
        }

        // ── Estratégia 2: nome da skill mencionado na mensagem ───────────────
        const lower = trimmed.toLowerCase();
        for (const skill of this.skills) {
            if (lower.includes(skill.name.toLowerCase())) {
                return { skill, query: trimmed };
            }
        }

        // ── Estratégia 3: freeText triggers carregados do skill.json ─────────
        for (const skill of this.skills) {
            for (const trigger of skill.triggers) {
                if (lower.includes(trigger.toLowerCase())) {
                    return { skill, query: trimmed };
                }
            }
        }

        return null;
    }

    /** Lista os nomes de todas as skills carregadas (útil para logs e help). */
    listNames(): string[] {
        return this.skills.map(s => s.name);
    }

    /** Lista skills com nome e descrição (útil para injetar no contexto do LLM). */
    listWithDescriptions(): { name: string; description: string }[] {
        return this.skills.map(s => ({ name: s.name, description: s.description }));
    }

    private findByName(name: string): LoadedSkill | undefined {
        return this.skills.find(s => s.name.toLowerCase() === name.toLowerCase());
    }
}
