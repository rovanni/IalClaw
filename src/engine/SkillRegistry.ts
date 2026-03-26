import fs from 'fs';
import path from 'path';

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

        // ─── Skill-installer tools ────────────────────────────────────────────

        /**
         * fetch_url: busca conteúdo de uma URL via GET.
         * Restrito a domínios confiáveis para evitar SSRF.
         */
        this.register({
            name: "fetch_url",
            description: "Busca o conteúdo de uma URL (GET). Use para consultar skills.sh ou baixar conteúdo de skills públicas.",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "URL completa para buscar (deve ser de domínio permitido)" }
                },
                required: ["url"]
            }
        }, {
            execute: async (args: any) => {
                const ALLOWED_HOSTS = ['skills.sh', 'raw.githubusercontent.com', 'api.github.com'];
                let parsed: URL;
                try {
                    parsed = new URL(args.url);
                } catch {
                    return 'Erro: URL inválida.';
                }
                const ok = ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h));
                if (!ok) {
                    return `Erro: domínio não permitido (${parsed.hostname}). Permitidos: ${ALLOWED_HOSTS.join(', ')}`;
                }
                try {
                    const res = await fetch(args.url, { signal: AbortSignal.timeout(10_000) });
                    const text = await res.text();
                    return text.slice(0, 12_000); // limita payload ao contexto do LLM
                } catch (e: any) {
                    return `Erro ao buscar URL: ${e.message}`;
                }
            }
        });

        /**
         * write_skill_file: grava um arquivo dentro de skills/public/<skillName>/.
         * Nome da skill e nome do arquivo são sanitizados contra path traversal.
         */
        this.register({
            name: "write_skill_file",
            description: "Salva um arquivo (SKILL.md, skill.json ou README.md) em skills/public/<skillName>/. Usado pelo skill-installer para registrar uma skill baixada.",
            parameters: {
                type: "object",
                properties: {
                    skill_name: { type: "string", description: "Nome da skill — apenas letras, números e hífens" },
                    filename:   { type: "string", description: "Nome do arquivo: SKILL.md | skill.json | README.md" },
                    content:    { type: "string", description: "Conteúdo completo do arquivo" }
                },
                required: ["skill_name", "filename", "content"]
            }
        }, {
            execute: async (args: any) => {
                const safeName = String(args.skill_name).replace(/[^a-zA-Z0-9\-_]/g, '');
                if (!safeName || safeName !== String(args.skill_name)) {
                    return `Erro: nome de skill inválido. Use apenas letras, números e hífens.`;
                }
                const ALLOWED_FILES = ['SKILL.md', 'skill.json', 'README.md'];
                if (!ALLOWED_FILES.includes(args.filename)) {
                    return `Erro: arquivo não permitido. Use: ${ALLOWED_FILES.join(', ')}`;
                }
                const dir = path.join(process.cwd(), 'skills', 'public', safeName);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                const dest = path.join(dir, args.filename);
                fs.writeFileSync(dest, String(args.content), 'utf8');
                return `OK: ${args.filename} salvo em skills/public/${safeName}/`;
            }
        });

        /**
         * delete_skill_public: remove uma pasta de skills/public/.
         * Usado como rollback quando a auditoria reprova a skill.
         */
        this.register({
            name: "delete_skill_public",
            description: "Remove uma skill de skills/public/ (rollback de instalação reprovada na auditoria).",
            parameters: {
                type: "object",
                properties: {
                    skill_name: { type: "string", description: "Nome exato da skill a remover" }
                },
                required: ["skill_name"]
            }
        }, {
            execute: async (args: any) => {
                const safeName = String(args.skill_name).replace(/[^a-zA-Z0-9\-_]/g, '');
                if (!safeName || safeName !== String(args.skill_name)) {
                    return `Erro: nome de skill inválido.`;
                }
                const dir = path.join(process.cwd(), 'skills', 'public', safeName);
                if (!fs.existsSync(dir)) return `Skill "${safeName}" não encontrada em skills/public/`;
                fs.rmSync(dir, { recursive: true, force: true });
                return `Skill "${safeName}" removida de skills/public/`;
            }
        });

        /**
         * read_audit_log: lê a última entrada do log de auditoria para uma skill específica.
         * Usado pelo skill-installer após rodar o skill-auditor.
         */
        this.register({
            name: "read_audit_log",
            description: "Lê o status de auditoria mais recente de uma skill em data/skill-audit-log.json.",
            parameters: {
                type: "object",
                properties: {
                    skill_name: { type: "string", description: "Nome da skill para verificar o status" }
                },
                required: ["skill_name"]
            }
        }, {
            execute: async (args: any) => {
                const logPath = path.join(process.cwd(), 'data', 'skill-audit-log.json');
                if (!fs.existsSync(logPath)) return `Nenhum log de auditoria encontrado ainda.`;
                const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
                let last: any = null;
                for (const line of lines) {
                    try {
                        const entry = JSON.parse(line);
                        if (entry.skill === args.skill_name) last = entry;
                    } catch { /* ignora linhas inválidas */ }
                }
                if (!last) return `Nenhuma entrada de auditoria encontrada para "${args.skill_name}".`;
                return JSON.stringify(last, null, 2);
            }
        });

        /**
         * run_skill_auditor: executa auditoria estática programática em uma skill pública.
         * Substitui a necessidade de invocar o skill-auditor via bash/grep.
         */
        this.register({
            name: "run_skill_auditor",
            description: "Executa auditoria de segurança estática em uma skill pública recém-baixada. Analisa padrões de risco e grava resultado em data/skill-audit-log.json. Use APÓS salvar a skill com write_skill_file.",
            parameters: {
                type: "object",
                properties: {
                    skill_name: { type: "string", description: "Nome da skill em skills/public/ para auditar" }
                },
                required: ["skill_name"]
            }
        }, {
            execute: async (args: any) => {
                const safeName = String(args.skill_name).replace(/[^a-zA-Z0-9\-_]/g, '');
                if (!safeName || safeName !== String(args.skill_name)) {
                    return `Erro: nome de skill inválido.`;
                }
                const skillDir = path.join(process.cwd(), 'skills', 'public', safeName);
                if (!fs.existsSync(skillDir)) {
                    return `Erro: skill "${safeName}" não encontrada em skills/public/`;
                }

                // Coleta todos os arquivos de texto da skill
                const files = fs.readdirSync(skillDir).filter(f => /\.(md|json|txt|sh|py|js|ts|yaml|yml)$/i.test(f));
                if (files.length === 0) {
                    return `Erro: nenhum arquivo analisável encontrado em skills/public/${safeName}/`;
                }

                let fullContent = '';
                for (const file of files) {
                    fullContent += fs.readFileSync(path.join(skillDir, file), 'utf8') + '\n';
                }

                // Categorias de risco com padrões e pesos
                const RISK_CHECKS: Array<{ name: string; weight: number; pattern: RegExp }> = [
                    { name: 'Prompt Injection', weight: 40, pattern: /ignore (previous|all|above|prior) instructions|disregard|override (your|all)|forget (you are|your role)|new persona|act as (an? )?(unrestricted|DAN|jailbreak)|you are now|system prompt/gi },
                    { name: 'Acesso a Arquivos Sensíveis', weight: 35, pattern: /\/etc\/(passwd|shadow|sudoers|hosts|ssh|cron)|~\/.ssh|~\/.aws|~\/.gnupg|\.env\b|id_rsa|id_ed25519|\.pem|\.key|authorized_keys/gi },
                    { name: 'Variáveis de Ambiente Sensíveis', weight: 25, pattern: /(API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|PRIVATE_KEY|DATABASE_URL|OPENAI_API|ANTHROPIC_API|AWS_SECRET|GCP_KEY)\s*[=:]/gi },
                    { name: 'Exfiltração de Dados', weight: 30, pattern: /(curl|wget|fetch|http\.get|axios|requests\.)\s.*(http|https):\/\//gi },
                    { name: 'Comandos Perigosos', weight: 30, pattern: /rm\s+-rf\s+\/|chmod\s+777|sudo\s+|eval\s*\(|exec\s*\(|os\.system|subprocess\.call|shell=True/gi },
                    { name: 'Downloads Não Declarados', weight: 15, pattern: /npm install|pip install|apt(-get)? install|brew install|wget .* -O|curl .* \|/gi },
                    { name: 'Ofuscação', weight: 20, pattern: /base64|atob|btoa|hex decode|fromCharCode|\\x[0-9a-f]{2}|eval\(atob/gi }
                ];

                let score = 0;
                const findings: string[] = [];

                for (const check of RISK_CHECKS) {
                    const matches = fullContent.match(check.pattern);
                    if (matches && matches.length > 0) {
                        score += check.weight * matches.length;
                        findings.push(`[${check.name}] ${matches.length} ocorrência(s) — +${check.weight * matches.length} pontos`);
                    }
                }

                // Overrides automáticos (bloqueio imediato)
                const CRITICAL_PATTERNS = [
                    /curl\s.*\|\s*(ba)?sh/gi,
                    /wget\s.*\|\s*(ba)?sh/gi,
                    /~\/.ssh\/id_rsa/gi,
                    /\/etc\/shadow/gi
                ];
                let hasCritical = false;
                for (const cp of CRITICAL_PATTERNS) {
                    if (cp.test(fullContent)) {
                        hasCritical = true;
                        findings.push(`[CRÍTICO] Padrão de bloqueio automático detectado: ${cp.source}`);
                    }
                }

                // Determinar decisão
                let decision: string;
                if (hasCritical || score >= 60) {
                    decision = 'blocked';
                } else if (score >= 21) {
                    decision = 'manual_review';
                } else {
                    decision = 'approved';
                }

                const level = score >= 60 ? '🔴 ALTO' : score >= 21 ? '🟡 MÉDIO' : '🟢 BAIXO';

                // Gravar no audit log
                const logDir = path.join(process.cwd(), 'data');
                if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
                const logPath = path.join(logDir, 'skill-audit-log.json');
                const entry = {
                    skill: safeName,
                    status: decision,
                    score,
                    date: new Date().toISOString(),
                    agent: 'skill-auditor-programmatic'
                };
                fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');

                const report = [
                    `══ SKILL AUDITOR — RELATÓRIO ══`,
                    `Skill: ${safeName}`,
                    `Arquivos analisados: ${files.length}`,
                    `Score de risco: ${score}/100 — ${level}`,
                    ``,
                    findings.length > 0 ? `Achados:\n${findings.join('\n')}` : 'Nenhum padrão de risco detectado.',
                    ``,
                    `Decisão: ${decision.toUpperCase()}`,
                    `Entrada gravada em data/skill-audit-log.json`
                ].join('\n');

                return report;
            }
        });
    }
}
