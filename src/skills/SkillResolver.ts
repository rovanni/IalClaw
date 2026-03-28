import { LoadedSkill } from './types';
import { SkillLoader } from './SkillLoader';

export type ResolvedSkill = {
    skill: LoadedSkill;
    query: string;
};

export class SkillResolver {
    private loader: SkillLoader;

    constructor(loader: SkillLoader) {
        this.loader = loader;
    }

    resolve(userInput: string): ResolvedSkill | null {
        if (!userInput) return null;
        const trimmed = userInput.trim();
        const lower = trimmed.toLowerCase();
        const skills = this.loader.getAll();

        const installer = this.findByName(skills, 'skill-installer');
        if (installer) {
            const slashInstall = trimmed.match(/^\/(?:install-skill|skill-install|find-skill)\b\s*(.*)$/i);
            if (slashInstall) {
                const args = (slashInstall[1] || '').trim();
                return { skill: installer, query: args || trimmed };
            }

            const hasInstallVerb = /\b(instala|instalar|instale|adiciona|adicionar|baixar|baixe|buscar|busque|procura|procurar|encontre|remover|remova|desinstalar|desinstale)\b/i.test(trimmed);
            const hasSkillNoun = /\b(skill|skills|habilidade|habilidades)\b/i.test(trimmed);
            const hasThisPhrase = /\b(?:essa|esse|essa skill|essa habilidade|essa ferramenta)\b/i.test(trimmed);
            if (hasInstallVerb || (hasInstallVerb && hasThisPhrase)) {
                const skillFromListMatch = trimmed.match(/\*\*([a-zA-Z0-9_-]+)\*\*/i);
                if (skillFromListMatch) {
                    return { skill: installer, query: `instale ${skillFromListMatch[1]}` };
                }
                const skillArgMatch = trimmed.match(/(?:instala|instalar|instale|adicione|adicionar|baixe|baixar|busque|buscar|procure|procurar|encontre)\s+(?:essa|esse|uma|a)?\s*[:\-]?\s*(\S+)/i);
                const skillArg = skillArgMatch ? skillArgMatch[1].replace(/[.:]/g, '') : trimmed;
                return { skill: installer, query: `instale ${skillArg}` };
            }
            if (hasInstallVerb && hasSkillNoun) {
                return { skill: installer, query: trimmed };
            }
        }

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

        const hasInstallIntent = /\b(instala|instalar|instale|adicione|adicionar|baixe|baixar|busque|buscar|procure|procurar|encontre)\b/i.test(trimmed);
        const hasThisPhrase = /\b(?:essa|esse|essa skill|essa habilidade|essa ferramenta)\b/i.test(trimmed);
        
        if (installer && (hasInstallIntent || hasThisPhrase)) {
            const skillFromListMatch = trimmed.match(/\*\*([a-zA-Z0-9_-]+)\*\*/i);
            if (skillFromListMatch) {
                return { skill: installer, query: `instale ${skillFromListMatch[1]}` };
            }
            
            const skillArgMatch = trimmed.match(/(?:instala|instalar|instale|adicione|adicionar|baixe|baixar|busque|buscar|procure|procurar|encontre)\s+(?:essa|esse|uma|a)?\s*[:\-]?\s*(\S+)/i);
            if (skillArgMatch) {
                const skillArg = skillArgMatch[1].replace(/[.:]/g, '');
                return { skill: installer, query: `instale ${skillArg}` };
            }
            return { skill: installer, query: trimmed };
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
