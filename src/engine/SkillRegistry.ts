import fs from 'fs';

export type ToolDefinition = {
    name: string;
    description: string;
    parameters: any; // JSON Schema representation
};

export type ToolImplementation = {
    execute(args: any): Promise<string>;
};

export class SkillRegistry {
    private tools: Map<string, { def: ToolDefinition, impl: ToolImplementation }> = new Map();

    constructor() {
        this.registerDefaultSkills();
    }

    public register(def: ToolDefinition, impl: ToolImplementation) {
        this.tools.set(def.name, { def, impl });
    }

    public getDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.values()).map(t => t.def);
    }

    public async executeTool(name: string, args: any): Promise<string> {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`Skill ${name} not found in registry.`);
        }
        return tool.impl.execute(args);
    }

    private registerDefaultSkills() {
        this.register({
            name: "get_system_time",
            description: "Obtém a data e hora atual do sistema local. Use quando o usuário perguntar as horas.",
            parameters: { type: "object", properties: {}, required: [] }
        }, {
            execute: async () => new Date().toISOString()
        });

        this.register({
            name: "read_local_file",
            description: "Lê o conteúdo de um arquivo de texto local baseado no caminho absoluto fornecido. Útil para consultar documentos ou códigos no computador.",
            parameters: {
                type: "object",
                properties: { path: { type: "string", description: "Caminho absoluto do arquivo." } },
                required: ["path"]
            }
        }, {
            execute: async (args: any) => {
                try { return fs.readFileSync(args.path, 'utf8'); }
                catch (e: any) { return "Erro ao ler arquivo: " + e.message; }
            }
        });

        this.register({
            name: "web_search",
            description: "Pesquisa na web por informações atualizadas simulando uma busca simples.",
            parameters: {
                type: "object",
                properties: { query: { type: "string", description: "Termo de busca curto." } },
                required: ["query"]
            }
        }, {
            execute: async (args: any) => {
                try {
                    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`);
                    const html = await res.text();
                    const snippetMatch = html.match(/<a class="result__snippet[^>]*>(.*?)<\/a>/g);
                    if (!snippetMatch) return "Nenhum resultado encontrado na web.";
                    return snippetMatch.slice(0, 3).map(s => s.replace(/<[^>]*>/g, '')).join('\n---\n');
                } catch (e: any) {
                    return "Erro na busca web: " + e.message;
                }
            }
        });
    }
}
