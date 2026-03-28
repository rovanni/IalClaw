import { LoadedSkill } from './types';
import { SkillLoader } from './SkillLoader';

export type ResolvedSkill = {
    skill: LoadedSkill;
    query: string;
};

export type PendingSkillItem = {
    index: number;
    name: string;
    description?: string;
};

export class SkillResolver {
    private loader: SkillLoader;
    private pendingSkillList: PendingSkillItem[] | null = null;

    constructor(loader: SkillLoader) {
        this.loader = loader;
    }

    setPendingSkillList(items: PendingSkillItem[]): void {
        this.pendingSkillList = items;
    }

    clearPendingSkillList(): void {
        this.pendingSkillList = null;
    }

    resolve(userInput: string): ResolvedSkill | null {
        if (!userInput) return null;
        const trimmed = userInput.trim();
        const lower = trimmed.toLowerCase();
        const skills = this.loader.getAll();

        const installer = this.findByName(skills, 'skill-installer');
        if (!installer) return null;

        const resolvedFromContext = this.resolveFromContext(trimmed, lower, installer);
        if (resolvedFromContext) return resolvedFromContext;

        if (trimmed.startsWith('/')) {
            const spaceIdx = trimmed.indexOf(' ');
            const cmdSlug = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
            const skill = this.findByName(skills, cmdSlug);
            if (skill) {
                const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
                return {
                    skill,
                    query: args || skill.argumentHint || `Execute a skill ${skill.name}.`
                };
            }
        }

        for (const skill of skills) {
            if (lower.includes(skill.name.toLowerCase())) {
                return { skill, query: trimmed };
            }
        }

        for (const skill of skills) {
            for (const trigger of skill.triggers || []) {
                if (lower.includes(String(trigger).toLowerCase())) {
                    return { skill, query: trimmed };
                }
            }
        }

        return null;
    }

    private resolveFromContext(trimmed: string, lower: string, installer: LoadedSkill): ResolvedSkill | null {
        if (!this.pendingSkillList || this.pendingSkillList.length === 0) {
            return this.resolveInstallIntentFallback(trimmed, lower, installer);
        }

        const indexMatch = trimmed.match(/^(?:essa|esse|a|o)\s*[:\-]?\s*(\d+)/i);
        if (indexMatch) {
            const idx = parseInt(indexMatch[1], 10);
            const item = this.pendingSkillList.find(s => s.index === idx);
            if (item) {
                return { skill: installer, query: `instale ${item.name}` };
            }
        }

        const nameMatch = trimmed.match(/^(?:essa|esse|a|o)\s*[:\-]?\s*([a-zA-Z0-9_-]+)/i);
        if (nameMatch) {
            const key = nameMatch[1].toLowerCase();
            const item = this.pendingSkillList.find(s => 
                s.name.toLowerCase() === key ||
                s.index.toString() === key
            );
            if (item) {
                return { skill: installer, query: `instale ${item.name}` };
            }
        }

        const directNameMatch = trimmed.match(/^(?:instala|instalar|instale|adicione|adicionar)\s+(?:essa|esse)\s*[:\-]?\s*([a-zA-Z0-9_-]+)/i);
        if (directNameMatch) {
            const key = directNameMatch[1].toLowerCase();
            const item = this.pendingSkillList.find(s => 
                s.name.toLowerCase() === key ||
                s.index.toString() === key
            );
            if (item) {
                return { skill: installer, query: `instale ${item.name}` };
            }
        }

        if (!this.pendingSkillList || this.pendingSkillList.length === 0) {
            const skillFromText = this.extractSkillFromText(trimmed);
            if (skillFromText) {
                return { skill: installer, query: `instale ${skillFromText}` };
            }
        }

        return this.resolveInstallIntentFallback(trimmed, lower, installer);
    }

    private resolveInstallIntentFallback(trimmed: string, lower: string, installer: LoadedSkill): ResolvedSkill | null {
        const slashInstall = trimmed.match(/^\/(?:install-skill|skill-install|find-skill)\b\s*(.*)$/i);
        if (slashInstall) {
            const args = (slashInstall[1] || '').trim();
            return { skill: installer, query: args || trimmed };
        }

        const hasInstallVerb = /\b(instala|instalar|instale|adiciona|adicionar|baixar|baixe|buscar|busque|procura|procurar|encontre|remover|remova|desinstalar|desinstale)\b/i.test(trimmed);
        const hasSkillNoun = /\b(skill|skills|habilidade|habilidades)\b/i.test(trimmed);
        const hasThisPhrase = /\b(?:essa|esse|essa skill|essa habilidade|essa ferramenta)\b/i.test(trimmed);

        if (hasInstallVerb || hasThisPhrase) {
            const skillFromList = this.extractSkillFromText(trimmed);
            if (skillFromList) {
                return { skill: installer, query: `instale ${skillFromList}` };
            }

            const skillArgMatch = trimmed.match(/(?:instala|instalar|instale|adicione|adicionar|baixe|baixar|busque|buscar|procure|procurar|encontre)\s+(?:essa|esse|uma|a)?\s*[:\-]?\s*(\S+)/i);
            if (skillArgMatch) {
                const skillArg = skillArgMatch[1].replace(/[.:]/g, '');
                return { skill: installer, query: `instale ${skillArg}` };
            }

            if (hasInstallVerb && hasSkillNoun) {
                return { skill: installer, query: trimmed };
            }
        }

        return null;
    }

    private extractSkillFromText(text: string): string | null {
        const matches = text.match(/\*\*([^*]+)\*\*/g) || [];
        for (const m of matches) {
            const inner = m.replace(/\*\*/g, '');
            if (/^\d+([.,]\d+)*$/.test(inner)) continue;
            if (/^\[.+\]$/.test(inner)) {
                return inner.replace(/[\[\]]/g, '');
            }
            if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(inner)) {
                return inner;
            }
        }
        return null;
    }

    listNames(): string[] {
        return this.loader.getAll().map(s => s.name);
    }

    listWithDescriptions(): { name: string; description: string }[] {
        return this.loader.getAll().map(s => ({ name: s.name, description: s.description }));
    }

    private findByName(skills: LoadedSkill[], name: string): LoadedSkill | undefined {
        return skills.find(s => s.name.toLowerCase() === name.toLowerCase());
    }
}
