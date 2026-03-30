import { LoadedSkill, PendingSkillItem } from './types';
import { SkillLoader } from './SkillLoader';
import { SkillResolutionManager, ResolutionResult } from './SkillResolutionManager';

export type ResolvedSkill = {
    skill: LoadedSkill;
    query: string;
};

export class SkillResolver {
    private loader: SkillLoader;
    private resolutionManager: SkillResolutionManager;

    constructor(loader: SkillLoader) {
        this.loader = loader;
        this.resolutionManager = new SkillResolutionManager();
    }

    getResolutionManager(): SkillResolutionManager {
        return this.resolutionManager;
    }

    setPendingSkillList(items: PendingSkillItem[]): void {
        this.resolutionManager.setPendingList(items);
    }

    clearPendingSkillList(): void {
        this.resolutionManager.clearPendingList();
    }

    resolve(userInput: string): ResolvedSkill | null {
        if (!userInput) return null;

        const skills = this.loader.getAll();
        const installer = this.findByName(skills, 'skill-installer');
        if (!installer) return null;

        const result = this.resolutionManager.resolve(userInput);

        if (result.action === 'install' && result.skillName) {
            return {
                skill: installer,
                query: `instale ${result.skillName}`
            };
        }

        if (result.action === 'list') {
            const trimmed = userInput.trim();
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
        }

        const trimmed = userInput.trim();
        const lower = trimmed.toLowerCase();

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
