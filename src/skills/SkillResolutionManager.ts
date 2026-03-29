import { LoadedSkill, PendingSkillItem } from './types';

export type SkillSearchResult = {
    name: string;
    description: string;
    source: string;
    rank?: number;
    installs?: string;
};

export type ResolutionResult = {
    action: 'install' | 'list' | 'ask_input' | 'none';
    skillName?: string;
    searchResults?: SkillSearchResult[];
    message?: string;
};

export class SkillResolutionManager {
    private pendingSkillList: PendingSkillItem[] | null = null;
    private lastSearchQuery: string = '';
    private lastSearchResults: SkillSearchResult[] = [];

    constructor() {}

    clearPendingList(): void {
        this.pendingSkillList = null;
        this.lastSearchQuery = '';
        this.lastSearchResults = [];
    }

    setPendingList(items: PendingSkillItem[]): void {
        this.pendingSkillList = items;
    }

    getPendingList(): PendingSkillItem[] | null {
        return this.pendingSkillList;
    }

    setLastSearch(query: string, results: SkillSearchResult[]): void {
        this.lastSearchQuery = query;
        this.lastSearchResults = results;
    }

    resolve(input: string): ResolutionResult {
        const trimmed = input.trim();
        const lower = trimmed.toLowerCase();

        const resolvedFromContext = this.resolveFromContext(trimmed, lower);
        if (resolvedFromContext) {
            return this.processSkillResolution(resolvedFromContext);
        }

        const resolvedFromInline = this.resolveFromInlineList(trimmed);
        if (resolvedFromInline) {
            return this.processSkillResolution(resolvedFromInline);
        }

        const resolvedFromText = this.resolveFromText(trimmed);
        if (resolvedFromText) {
            return this.processSkillResolution(resolvedFromText);
        }

        return { action: 'none' };
    }

    private resolveFromContext(trimmed: string, lower: string): string | null {
        if (!this.pendingSkillList || this.pendingSkillList.length === 0) {
            return null;
        }

        const hasInstallVerb = /(?:instala|instalar|instale|adicione|adicionar|usar|usar|execute)\b/i.test(lower);
        if (!hasInstallVerb) {
            return null;
        }

        const indexMatch = trimmed.match(/^(?:instala|instalar|instale|adicione|adicionar|usar|execute)\s+(?:essa|esse|a|o|numero|n)?\s*[:\-]?\s*(\d+)/i);
        if (indexMatch) {
            const idx = parseInt(indexMatch[1], 10);
            const item = this.pendingSkillList.find(s => s.index === idx);
            if (item) {
                return item.name;
            }
        }

        const nameMatch = trimmed.match(/^(?:instala|instalar|instale|adicione|adicionar|usar|execute)\s+(?:essa|esse|a|o)?\s*[:\-]?\s*([a-zA-Z][a-zA-Z0-9_-]*)/i);
        if (nameMatch) {
            const key = nameMatch[1].toLowerCase();
            const item = this.pendingSkillList.find(s => 
                s.name.toLowerCase() === key ||
                s.index.toString() === key
            );
            if (item) {
                return item.name;
            }
        }

        return null;
    }

    private resolveFromInlineList(trimmed: string): string | null {
        const bracketMatch = trimmed.match(/\[\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\]/i);
        if (bracketMatch) {
            return bracketMatch[1];
        }

        const boldMatch = trimmed.match(/\*\*([^*]+)\*\*/);
        if (boldMatch) {
            const inner = boldMatch[1];
            if (/^\d+([.,]\d+)*$/.test(inner)) return null;
            if (/^\[.+\]$/.test(inner)) {
                return inner.replace(/[\[\]]/g, '');
            }
            if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(inner)) {
                return inner;
            }
        }

        return null;
    }

    private resolveFromText(trimmed: string): string | null {
        const installVerbMatch = trimmed.match(/^(?:instala|instalar|instale|adicione|adicionar|baixe|baixar)\s+(?:a|uma|essa|esse)?\s*[:\-]?\s*([a-zA-Z][a-zA-Z0-9_-]*)/i);
        if (installVerbMatch) {
            return installVerbMatch[1];
        }

        if (trimmed.startsWith('/')) {
            const cmdMatch = trimmed.match(/^\/([a-zA-Z][a-zA-Z0-9_-]*)/i);
            if (cmdMatch) {
                return cmdMatch[1];
            }
        }

        return null;
    }

    private processSkillResolution(skillName: string): ResolutionResult {
        const searchResults = this.searchMarketplace(skillName);

        if (searchResults.length === 0) {
            return {
                action: 'ask_input',
                skillName,
                message: `Nenhuma skill encontrada para "${skillName}". Tente outro nome.`
            };
        }

        if (searchResults.length === 1) {
            return {
                action: 'install',
                skillName: searchResults[0].name,
                searchResults
            };
        }

        this.setLastSearch(skillName, searchResults);
        this.setPendingList(searchResults.map((r, i) => ({
            index: i + 1,
            name: r.name,
            description: r.description,
            source: r.source
        })));

        return {
            action: 'list',
            skillName,
            searchResults,
            message: `Encontrei ${searchResults.length} skills para "${skillName}":`
        };
    }

    private searchMarketplace(query: string): SkillSearchResult[] {
        const lowerQuery = query.toLowerCase();
        
        const knownSkills: SkillSearchResult[] = [
            { name: 'pptx', description: 'Skill oficial de criação de apresentações PPTX', source: 'anthropics/skills', rank: 1, installs: '48.999' },
            { name: 'excel', description: 'Manipulação de planilhas Excel', source: 'anthropics/skills', rank: 2, installs: '45.000' },
            { name: 'markdown-pptx', description: 'Conversão de Markdown para PPTX', source: 'community', rank: 3, installs: '12.000' },
            { name: 'md-to-pptx', description: 'Markdown to PowerPoint converter', source: 'community', rank: 4, installs: '8.500' },
            { name: 'youtube', description: 'Download e manipulação de vídeos YouTube', source: 'anthropics/skills', rank: 5, installs: '35.000' },
            { name: 'pdf', description: 'Manipulação de arquivos PDF', source: 'anthropics/skills', rank: 6, installs: '30.000' },
            { name: 'image', description: 'Processamento de imagens', source: 'anthropics/skills', rank: 7, installs: '25.000' },
            { name: 'code', description: 'Análise e geração de código', source: 'anthropics/skills', rank: 8, installs: '20.000' }
        ];

        return knownSkills.filter(s => 
            s.name.toLowerCase().includes(lowerQuery) ||
            s.description.toLowerCase().includes(lowerQuery)
        );
    }
}
