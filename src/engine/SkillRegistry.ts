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
            description: "Lê o conteúdo de um arquivo de texto local. Aceita caminhos absolutos ou relativos ao workspace.",
            parameters: {
                type: "object",
                properties: { path: { type: "string", description: "Caminho do arquivo (absoluto ou relativo ao workspace)" } },
                required: ["path"]
            }
        }, {
            execute: async (args: any) => {
                const workspaceRoot = process.cwd();
                let targetPath: string;
                
                // Se o caminho é absoluto, usar diretamente
                if (args.path && path.isAbsolute(args.path)) {
                    targetPath = args.path;
                } else {
                    targetPath = args.path ? path.resolve(workspaceRoot, args.path) : workspaceRoot;
                }
                
                // Verificação de segurança: caminhos permitidos
                const allowedPaths = [
                    workspaceRoot,
                    '/home',
                    '/tmp',
                    process.env.HOME || ''
                ].filter(Boolean);
                
                const isAllowed = allowedPaths.some(p => targetPath.startsWith(p));
                if (!isAllowed) {
                    return `Erro: path "${args.path}" não está em um diretório permitido.`;
                }
                
                try {
                    return fs.readFileSync(targetPath, 'utf8');
                } catch (e: any) {
                    return "Erro ao ler arquivo: " + e.message;
                }
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
         * write_skill_file: grava um arquivo dentro de skills/temp/<skillName>/ (default).
         * Pode escrever em public apenas quando target_dir="public" for solicitado explicitamente.
         */
        this.register({
            name: "write_skill_file",
            description: "Salva um arquivo da skill em staging seguro (skills/temp/<skillName>/). Use target_dir='public' apenas em casos especiais.",
            parameters: {
                type: "object",
                properties: {
                    skill_name: { type: "string", description: "Nome da skill — apenas letras, números e hífens" },
                    filename:   { type: "string", description: "Nome do arquivo: SKILL.md | skill.json | README.md" },
                    content:    { type: "string", description: "Conteúdo completo do arquivo" },
                    target_dir: { type: "string", description: "temp (default) ou public" }
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
                const targetDir = String(args.target_dir || 'temp').toLowerCase() === 'public' ? 'public' : 'temp';
                const dir = path.join(process.cwd(), 'skills', targetDir, safeName);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                const dest = path.join(dir, args.filename);
                fs.writeFileSync(dest, String(args.content), 'utf8');
                return `OK: ${args.filename} salvo em skills/${targetDir}/${safeName}/`;
            }
        });

        this.register({
            name: "promote_skill_temp",
            description: "Promove uma skill auditada de skills/temp/<skillName>/ para skills/public/<skillName>/.",
            parameters: {
                type: "object",
                properties: {
                    skill_name: { type: "string", description: "Nome da skill para promover de temp para public" }
                },
                required: ["skill_name"]
            }
        }, {
            execute: async (args: any) => {
                const safeName = String(args.skill_name).replace(/[^a-zA-Z0-9\-_]/g, '');
                if (!safeName || safeName !== String(args.skill_name)) {
                    return `Erro: nome de skill inválido.`;
                }

                const root = process.cwd();
                const tempDir = path.join(root, 'skills', 'temp', safeName);
                const publicDir = path.join(root, 'skills', 'public', safeName);

                if (!fs.existsSync(tempDir)) {
                    return `Erro: skill "${safeName}" não encontrada em skills/temp/`;
                }

                if (fs.existsSync(publicDir)) {
                    fs.rmSync(publicDir, { recursive: true, force: true });
                }

                const publicParent = path.join(root, 'skills', 'public');
                if (!fs.existsSync(publicParent)) fs.mkdirSync(publicParent, { recursive: true });
                fs.renameSync(tempDir, publicDir);
                return `Skill "${safeName}" promovida para skills/public/`;
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
         * run_skill_auditor: executa auditoria estática programática em uma skill (temp/public).
         * Substitui a necessidade de invocar o skill-auditor via bash/grep.
         */
        this.register({
            name: "run_skill_auditor",
            description: "Executa auditoria de segurança estática em uma skill de staging/public. Analisa padrões de risco e grava resultado em data/skill-audit-log.json.",
            parameters: {
                type: "object",
                properties: {
                    skill_name: { type: "string", description: "Nome da skill para auditar" },
                    source_dir: { type: "string", description: "temp (default) ou public" }
                },
                required: ["skill_name"]
            }
        }, {
            execute: async (args: any) => {
                const safeName = String(args.skill_name).replace(/[^a-zA-Z0-9\-_]/g, '');
                if (!safeName || safeName !== String(args.skill_name)) {
                    return `Erro: nome de skill inválido.`;
                }
                const sourceDir = String(args.source_dir || 'temp').toLowerCase() === 'public' ? 'public' : 'temp';
                const skillDir = path.join(process.cwd(), 'skills', sourceDir, safeName);
                if (!fs.existsSync(skillDir)) {
                    return `Erro: skill "${safeName}" não encontrada em skills/${sourceDir}/`;
                }

                // Coleta todos os arquivos de texto da skill
                const files = fs.readdirSync(skillDir).filter(f => /\.(md|json|txt|sh|py|js|ts|yaml|yml)$/i.test(f));
                if (files.length === 0) {
                    return `Erro: nenhum arquivo analisável encontrado em skills/${sourceDir}/${safeName}/`;
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
                let status: string;
                if (hasCritical || score >= 60) {
                    decision = 'blocked';
                    status = 'blocked';
                } else if (score >= 35) {
                    decision = 'manual_review';
                    status = 'review';
                } else if (score >= 21) {
                    decision = 'approved_with_restrictions';
                    status = 'warning';
                } else {
                    decision = 'approved';
                    status = 'safe';
                }

                const level = score >= 60 ? '🔴 ALTO' : score >= 21 ? '🟡 MÉDIO' : '🟢 BAIXO';

                // Gravar no audit log
                const logDir = path.join(process.cwd(), 'data');
                if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
                const logPath = path.join(logDir, 'skill-audit-log.json');
                const entry = {
                    skill: safeName,
                    status: decision,
                    lifecycle_status: status,
                    source_dir: sourceDir,
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
                    `Resultado de ciclo de vida: ${status.toUpperCase()}`,
                    `Decisão: ${decision.toUpperCase()}`,
                    `Entrada gravada em data/skill-audit-log.json`
                ].join('\n');

                return report;
            }
        });

        // ─── Ferramentas Gerais de File System ────────────────────────────────

        /**
         * write_file: escreve conteúdo em qualquer arquivo dentro do workspace.
         * Sanitiza path para prevenir path traversal fora do workspace.
         */
        this.register({
            name: "write_file",
            description: "Escreve conteúdo em um arquivo. Aceita caminhos absolutos ou relativos ao workspace. Cria diretórios automaticamente se necessário.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Caminho do arquivo (absoluto ou relativo ao workspace)" },
                    content: { type: "string", description: "Conteúdo completo do arquivo" }
                },
                required: ["path", "content"]
            }
        }, {
            execute: async (args: any) => {
                const workspaceRoot = process.cwd();
                let targetPath: string;
                
                // Se o caminho é absoluto, usar diretamente
                if (args.path && path.isAbsolute(args.path)) {
                    targetPath = args.path;
                } else {
                    targetPath = path.resolve(workspaceRoot, args.path);
                }
                
                // Verificação de segurança: caminhos permitidos
                const allowedPaths = [
                    workspaceRoot,
                    '/home',
                    '/tmp',
                    process.env.HOME || ''
                ].filter(Boolean);
                
                const isAllowed = allowedPaths.some(p => targetPath.startsWith(p));
                if (!isAllowed) {
                    return `Erro: path "${args.path}" não está em um diretório permitido.`;
                }
                
                try {
                    const dir = path.dirname(targetPath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    fs.writeFileSync(targetPath, String(args.content), 'utf8');
                    return `Arquivo salvo com sucesso: ${targetPath}`;
                } catch (e: any) {
                    return `Erro ao escrever arquivo: ${e.message}`;
                }
            }
        });

        /**
         * create_directory: cria um diretório dentro do workspace.
         */
        this.register({
            name: "create_directory",
            description: "Cria um diretório (e seus pais, se necessário) dentro do workspace IalClaw. Use caminhos relativos.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Caminho relativo do diretório a criar (ex: data/exports ou temp/processing)" }
                },
                required: ["path"]
            }
        }, {
            execute: async (args: any) => {
                const workspaceRoot = process.cwd();
                const targetPath = path.resolve(workspaceRoot, args.path);
                
                if (!targetPath.startsWith(workspaceRoot)) {
                    return `Erro: path fora do workspace.`;
                }
                
                try {
                    if (fs.existsSync(targetPath)) {
                        return `Diretório já existe: ${path.relative(workspaceRoot, targetPath)}`;
                    }
                    fs.mkdirSync(targetPath, { recursive: true });
                    return `Diretório criado: ${path.relative(workspaceRoot, targetPath)}`;
                } catch (e: any) {
                    return `Erro ao criar diretório: ${e.message}`;
                }
            }
        });

        /**
         * delete_file: remove um arquivo ou diretório dentro do workspace.
         */
        this.register({
            name: "delete_file",
            description: "Remove um arquivo ou diretório dentro do workspace IalClaw. Use com cuidado! Para diretórios, remove recursivamente.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Caminho relativo do arquivo/diretório a remover" }
                },
                required: ["path"]
            }
        }, {
            execute: async (args: any) => {
                const workspaceRoot = process.cwd();
                const targetPath = path.resolve(workspaceRoot, args.path);
                
                if (!targetPath.startsWith(workspaceRoot)) {
                    return `Erro: path fora do workspace.`;
                }
                
                // Proteção: não permitir deleção de raiz ou pastas críticas
                const relativePath = path.relative(workspaceRoot, targetPath);
                const PROTECTED = ['', '.', 'src', 'node_modules', '.git'];
                if (PROTECTED.includes(relativePath)) {
                    return `Erro: não é permitido deletar "${relativePath}" (pasta protegida).`;
                }
                
                try {
                    if (!fs.existsSync(targetPath)) {
                        return `Arquivo/diretório não encontrado: ${relativePath}`;
                    }
                    
                    const stats = fs.statSync(targetPath);
                    if (stats.isDirectory()) {
                        fs.rmSync(targetPath, { recursive: true, force: true });
                        return `Diretório removido: ${relativePath}`;
                    } else {
                        fs.unlinkSync(targetPath);
                        return `Arquivo removido: ${relativePath}`;
                    }
                } catch (e: any) {
                    return `Erro ao remover: ${e.message}`;
                }
            }
        });

        /**
         * list_directory: lista conteúdo de um diretório.
         */
        this.register({
            name: "list_directory",
            description: "Lista arquivos e subdiretórios dentro de um diretório. Aceita caminhos absolutos ou relativos ao workspace.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Caminho do diretório (absoluto ou relativo ao workspace)" }
                },
                required: []
            }
        }, {
            execute: async (args: any) => {
                const workspaceRoot = process.cwd();
                let targetPath: string;
                
                // Se o caminho é absoluto, usar diretamente
                if (args.path && path.isAbsolute(args.path)) {
                    targetPath = args.path;
                } else {
                    targetPath = args.path ? path.resolve(workspaceRoot, args.path) : workspaceRoot;
                }
                
                // Verificação de segurança: caminhos permitidos
                const allowedPaths = [
                    workspaceRoot,
                    '/home',
                    '/tmp',
                    process.env.HOME || ''
                ].filter(Boolean);
                
                const isAllowed = allowedPaths.some(p => targetPath.startsWith(p));
                if (!isAllowed) {
                    return `Erro: path "${args.path}" não está em um diretório permitido.`;
                }
                
                try {
                    if (!fs.existsSync(targetPath)) {
                        return `Diretório não encontrado: ${targetPath}`;
                    }
                    
                    const stats = fs.statSync(targetPath);
                    if (!stats.isDirectory()) {
                        return `Erro: "${args.path}" não é um diretório.`;
                    }
                    
                    const entries = fs.readdirSync(targetPath);
                    if (entries.length === 0) {
                        return `Diretório vazio: ${targetPath}`;
                    }
                    
                    const items = entries.map(entry => {
                        const fullPath = path.join(targetPath, entry);
                        try {
                            const isDir = fs.statSync(fullPath).isDirectory();
                            return `${isDir ? '📁' : '📄'} ${entry}${isDir ? '/' : ''}`;
                        } catch {
                            return `❓ ${entry}`;
                        }
                    });
                    
                    return `Conteúdo de ${targetPath}:\n${items.join('\n')}`;
                } catch (e: any) {
                    return `Erro ao listar diretório: ${e.message}`;
                }
            }
        });

        /**
         * move_file: move ou renomeia um arquivo/diretório.
         */
        this.register({
            name: "move_file",
            description: "Move ou renomeia um arquivo/diretório dentro do workspace. Ambos os paths devem estar no workspace.",
            parameters: {
                type: "object",
                properties: {
                    from: { type: "string", description: "Caminho relativo de origem" },
                    to: { type: "string", description: "Caminho relativo de destino" }
                },
                required: ["from", "to"]
            }
        }, {
            execute: async (args: any) => {
                const workspaceRoot = process.cwd();
                const fromPath = path.resolve(workspaceRoot, args.from);
                const toPath = path.resolve(workspaceRoot, args.to);
                
                if (!fromPath.startsWith(workspaceRoot) || !toPath.startsWith(workspaceRoot)) {
                    return `Erro: ambos os paths devem estar dentro do workspace.`;
                }
                
                try {
                    if (!fs.existsSync(fromPath)) {
                        return `Erro: origem não encontrada: ${path.relative(workspaceRoot, fromPath)}`;
                    }
                    
                    if (fs.existsSync(toPath)) {
                        return `Erro: destino já existe: ${path.relative(workspaceRoot, toPath)}`;
                    }
                    
                    // Criar diretório de destino se necessário
                    const toDir = path.dirname(toPath);
                    if (!fs.existsSync(toDir)) {
                        fs.mkdirSync(toDir, { recursive: true });
                    }
                    
                    fs.renameSync(fromPath, toPath);
                    return `Movido: ${path.relative(workspaceRoot, fromPath)} → ${path.relative(workspaceRoot, toPath)}`;
                } catch (e: any) {
                    return `Erro ao mover: ${e.message}`;
                }
            }
        });

        /**
         * file_convert: converte arquivos entre formatos (md, html, pptx, pdf).
         */
        this.register({
            name: "file_convert",
            description: "Converte arquivos entre formatos usando Pandoc. Suporta: md↔html, md→pptx, md→pdf, html→md.",
            parameters: {
                type: "object",
                properties: {
                    input: { type: "string", description: "Caminho do arquivo de entrada" },
                    output: { type: "string", description: "Caminho do arquivo de saída (opcional, usa mesmo diretório por padrão)" },
                    format: { type: "string", description: "Formato de saída: pptx, pdf, html, md" }
                },
                required: ["input"]
            }
        }, {
            execute: async (args: any) => {
                const { execSync } = require('child_process');
                const inputPath = args.input;
                
                if (!fs.existsSync(inputPath)) {
                    return `Erro: arquivo não encontrado: ${inputPath}`;
                }
                
                // Determinar formato de saída
                const inputExt = path.extname(inputPath).toLowerCase();
                let outputFormat = args.format || 'pptx';
                
                // Mapear extensões
                const formatMap: Record<string, string> = {
                    '.md': outputFormat,
                    '.markdown': outputFormat,
                    '.html': 'md',
                    '.htm': 'md'
                };
                
                // Se não especificado, inferir pelo formato de entrada
                if (!args.format) {
                    if (inputExt === '.md' || inputExt === '.markdown') {
                        outputFormat = 'pptx'; // padrão para md
                    } else if (inputExt === '.html' || inputExt === '.htm') {
                        outputFormat = 'md';
                    }
                }
                
                // Gerar caminho de saída
                const inputDir = path.dirname(inputPath);
                const inputBase = path.basename(inputPath, inputExt);
                const outputPath = args.output || path.join(inputDir, `${inputBase}.${outputFormat}`);
                
                // Verificar se pandoc existe
                try {
                    execSync('which pandoc', { stdio: 'ignore' });
                } catch {
                    return `Erro: Pandoc não está instalado. Instale com: apt install pandoc (Linux) ou brew install pandoc (macOS)`;
                }
                
                // Executar conversão
                try {
                    const cmd = `pandoc "${inputPath}" -o "${outputPath}" --slide-level=2`;
                    execSync(cmd, { stdio: 'pipe' });
                    
                    if (!fs.existsSync(outputPath)) {
                        return `Erro: arquivo de saída não foi criado.`;
                    }
                    
                    const stats = fs.statSync(outputPath);
                    return `✅ Conversão concluída!\n📄 Arquivo: ${outputPath}\n📊 Tamanho: ${(stats.size / 1024).toFixed(1)} KB`;
                } catch (e: any) {
                    const stderr = e.stderr?.toString() || e.message;
                    return `Erro ao converter: ${stderr}`;
                }
            }
        });

        /**
         * file_exists: verifica se um arquivo existe.
         */
        this.register({
            name: "file_exists",
            description: "Verifica se um arquivo ou diretório existe no caminho especificado.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Caminho do arquivo ou diretório" }
                },
                required: ["path"]
            }
        }, {
            execute: async (args: any) => {
                const targetPath = args.path;
                
                try {
                    if (fs.existsSync(targetPath)) {
                        const stats = fs.statSync(targetPath);
                        if (stats.isDirectory()) {
                            return `✅ Diretório encontrado: ${targetPath}`;
                        } else {
                            return `✅ Arquivo encontrado: ${targetPath} (${(stats.size / 1024).toFixed(1)} KB)`;
                        }
                    } else {
                        return `❌ Não encontrado: ${targetPath}`;
                    }
                } catch (e: any) {
                    return `❌ Erro ao verificar: ${e.message}`;
                }
            }
        });

        /**
         * run_python: executa um script Python.
         */
        this.register({
            name: "run_python",
            description: "Executa um script Python. Use para conversões, processamento de dados, automações. Retorna stdout e stderr.",
            parameters: {
                type: "object",
                properties: {
                    script: { type: "string", description: "Caminho do script Python (.py)" },
                    args: { type: "array", items: { type: "string" }, description: "Argumentos para o script (opcional)" }
                },
                required: ["script"]
            }
        }, {
            execute: async (args: any) => {
                const { execSync } = require('child_process');
                const scriptPath = args.script;
                
                // Verificar se o script existe
                if (!fs.existsSync(scriptPath)) {
                    return `Erro: script não encontrado: ${scriptPath}`;
                }
                
                // Construir comando
                const scriptArgs = args.args || [];
                const argsStr = scriptArgs.map((a: string) => `"${a}"`).join(' ');
                const cmd = `python3 "${scriptPath}" ${argsStr}`.trim();
                
                try {
                    const stdout = execSync(cmd, { 
                        encoding: 'utf8',
                        timeout: 30000, // 30 segundos
                        cwd: path.dirname(scriptPath)
                    });
                    return `✅ Script executado:\n${stdout}`;
                } catch (e: any) {
                    const stderr = e.stderr?.toString() || e.message;
                    const stdout = e.stdout?.toString() || '';
                    
                    if (stderr.includes('No module named')) {
                        const missingModule = stderr.match(/No module named '(\w+)'/)?.[1];
                        return `❌ Módulo Python não encontrado: ${missingModule}

Instale com: pip install ${missingModule}`;
                    }
                    
                    return `❌ Erro ao executar:\n${stderr}\n${stdout}`;
                }
            }
        });

        /**
         * exec_command: executa um comando shell.
         * Para comandos sudo, forneça a senha no parâmetro 'password'.
         */
        this.register({
            name: "exec_command",
            description: "Executa um comando shell no sistema. Use para instalar pacotes, verificar versões, etc. Para comandos sudo, forneça a senha.",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "Comando a executar (ex: 'apt install pandoc', 'pip install python-pptx')" },
                    sudo: { type: "boolean", description: "Se true, executa com sudo" },
                    password: { type: "string", description: "Senha para sudo (se necessário)" }
                },
                required: ["command"]
            }
        }, {
            execute: async (args: any) => {
                const { execSync } = require('child_process');
                let cmd = args.command;
                
                // Bloquear comandos perigosos
                const dangerousCommands = [
                    /rm\s+-rf\s+\//,
                    /chmod\s+777/,
                    /dd\s+if=/,
                    />\s*\/dev\/sd/,
                    /mkfs/,
                    /fdisk/,
                    /format\s+/i,
                    /:(){ :|:& };:/,
                    />\s*\/dev\/sda/,
                    /shutdown/,
                    /reboot/,
                    /init\s+0/,
                    /halt/
                ];
                
                for (const pattern of dangerousCommands) {
                    if (pattern.test(cmd)) {
                        return `❌ Comando bloqueado por segurança: ${cmd}`;
                    }
                }
                
                // Construir comando final
                let finalCmd = cmd;
                if (args.sudo) {
                    if (args.password) {
                        // Passar senha para sudo via stdin
                        finalCmd = `echo '${args.password}' | sudo -S ${cmd}`;
                    } else {
                        finalCmd = `sudo ${cmd}`;
                    }
                }
                
                try {
                    const stdout = execSync(finalCmd, { 
                        encoding: 'utf8',
                        timeout: 120000
                    });
                    return `✅ Comando executado:\n${stdout || '(sem output)'}`;
                } catch (e: any) {
                    const stderr = e.stderr?.toString() || '';
                    const stdout = e.stdout?.toString() || '';
                    
                    // Verificar erros comuns
                    if (stderr.includes('incorrect password') || stderr.includes('senha incorreta')) {
                        return `❌ Senha incorreta.`;
                    }
                    
                    if (stderr.includes('password') || stderr.includes('senha') || stderr.includes('[sudo]')) {
                        if (!args.password) {
                            return `❌ Comando requer senha sudo. Forneça o parâmetro 'password'.`;
                        }
                        return `❌ Erro de autenticação: ${stderr}`;
                    }
                    
                    if (stderr.includes('not found') || stderr.includes('não encontrado') || stderr.includes('command not found')) {
                        return `❌ Comando não encontrado: ${cmd}`;
                    }
                    
                    if (stderr.includes('Unable to locate package') || stderr.includes('E:')) {
                        return `❌ Erro apt: ${stderr}`;
                    }
                    
                    return `❌ Erro:\n${stderr}\n${stdout}`;
                }
            }
        });
    }
}
