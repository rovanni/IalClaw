// ── Task Classifier Híbrido ─────────────────────────────────────────────────
// Classifica o tipo de tarefa em 4 camadas:
// 1. Heurística rápida (barata)
// 2. Memória adaptativa (aprendizado)
// 3. LLM classificador (quando necessário)
// 4. Fallback inteligente (elimina generic_task)

import { LLMProvider, ProviderFactory } from '../../engine/ProviderFactory';
import { createLogger } from '../../shared/AppLogger';
import { getClassificationMemory } from '../../memory/ClassificationMemory';
import { t } from '../../i18n';
import { ExecutionPlanRegistry, ExecutionStep } from '../planner/ExecutionPlanRegistry';
import { buildFilesystemPlan } from '../planner/builders/filesystemBuilder';

export type TaskType =
    | 'file_conversion'
    | 'file_search'
    | 'filesystem'
    | 'content_generation'
    | 'system_operation'
    | 'skill_installation'
    | 'information_request'
    | 'code_generation'
    | 'data_analysis'
    | 'conversation'     // Greetings and social talk
    | 'unknown'        // Compatibilidade com código existente
    | 'generic_task';  // Compatibilidade - será convertido no fallback

export type ClassificationSource = 'heuristic' | 'memory' | 'llm' | 'fallback';

export interface TaskClassification {
    type: TaskType;
    confidence: number;
    source: ClassificationSource;
    needsContext?: boolean;       // Precisa de mais contexto
    contextQuestion?: string;     // Pergunta para o usuário
    isContinuation?: boolean;     // É continuação de tarefa anterior
    lastTaskType?: TaskType;      // Tipo da última tarefa (se continuação)
}

export interface ForcedExecutableStep {
    description: string;
    tool: string;
    params: Record<string, unknown>;
}

export interface DeterministicExecutionStep {
    tool: ExecutionStep['tool'];
    params: ExecutionStep['params'];
}

export type PlanSource = 'deterministic_builder' | 'legacy_forced_plan';

const TASK_CAPABILITY_REQUIREMENTS: Partial<Record<TaskType, string[]>> = {
    filesystem: ['fs_access'],
    file_search: ['fs_access'],
    file_conversion: ['fs_access'],
    system_operation: ['node_execution'],
    skill_installation: ['fs_access', 'node_execution']
};

ExecutionPlanRegistry.register('filesystem', buildFilesystemPlan);

export function getRequiredCapabilitiesForTaskType(taskType: TaskType): string[] {
    return [...(TASK_CAPABILITY_REQUIREMENTS[taskType] || [])];
}

// ── Detecção de Continuidade ─────────────────────────────────────────────

const CONTINUATION_INDICATORS = [
    /^e\s+/i,                    // "e para...", "e usar..."
    /^e\s+para/i,                // "e para utilizar..."
    /^usar\s+/i,                 // "usar o arquivo..."
    /^utilizar\s+/i,             // "utilizar o conteúdo..."
    /^com\s+esse/i,              // "com esse arquivo..."
    /^agora\s+com/i,             // "agora com..."
    /^usando\s+/i,               // "usando o arquivo..."
    /^aplicar\s+/i,              // "aplicar ao..."
];

// ── Detecção de Intenção Incompleta ───────────────────────────────────────

const CONTENT_GENERATION_NEEDS_SOURCE: TaskType[] = [
    'content_generation',
    'file_conversion'
];

const CONTENT_SOURCE_INDICATORS = [
    /\/[\w\-\.\/]+\.(md|html|txt|json|pdf|docx|pptx)/i,  // Caminho de arquivo
    /\bconte[úu]do\b/i,           // "usar o conteúdo"
    /\btexto\b/i,                  // "usar o texto"
    /\barquivo\b/i,                // "usar o arquivo"
    /\bcole\b/i,                   // "cole o texto aqui"
    /\baqui\b/i,                   // "texto aqui"
];

// ── Camada 1: Heurística Rápida ─────────────────────────────────────────────

interface HeuristicRule {
    type: TaskType;
    patterns: RegExp[];
    keywords: string[];
    confidence: number;
}

const HEURISTIC_RULES: HeuristicRule[] = [
    {
        type: 'skill_installation',
        patterns: [
            /\b(instalar|instale|adicionar|adicione)\s+(uma\s+)?skill\b/i,
            /\b(install|add)\s+skill\b/i,
            /^(npx|npm)\s+skills?\s+(add|install)/i
        ],
        keywords: ['instalar skill', 'add skill', 'npx skills install'],
        confidence: 0.98
    },
    {
        type: 'system_operation',
        patterns: [
            /\b(npx|npm|yarn|pnpm|pip|apt|apt-get|brew|choco)\s+\w+/i,
            /\b(instale|instalar)\s+(o|a|os|as)?\s*\w+/i,
            /\b(sudo)\s+\w+/i,
            /\b(executar|rodar|run|execute)\s+/i,
            /\b(start|stop|restart)\s+\w+/i,
            /\bsenha\b/i,
            /\b(configure|setup|config)\b/i
        ],
        keywords: ['npx', 'npm', 'pip', 'apt', 'instalar', 'executar', 'comando'],
        confidence: 0.95
    },
    {
        type: 'file_conversion',
        patterns: [
            /\b(converter|transformar|convert)\b.*\b(em|para|to)\b/i,
            /\.md\s+(para|to|em)\s+(html|pptx|pdf|docx)/i,
            /\bmarkdown\b.*\b(pptx|powerpoint|pdf)\b/i,
            /\bpassar\s+(para|o)\s*\w+/i
        ],
        keywords: ['converter', 'transformar', 'pptx', 'pdf', 'html', 'markdown'],
        confidence: 0.90
    },
    {
        type: 'file_search',
        patterns: [
            /\b(buscar|procurar|localizar|encontrar|search|find|busque|procure|busca)\b/i,
            /\b(listar|list|ls)\b/i,
            /\b(varredura|varedura|escanear|scan)\b/i,
            /\b(onde\s+est[áa]|onde\s+fica)\b/i
        ],
        keywords: ['buscar', 'procurar', 'listar', 'varredura', 'varedura', 'scan', 'localizar', 'busque', 'procure', 'busca'],
        confidence: 0.90
    },
    {
        type: 'content_generation',
        patterns: [
            // Criação/generação de conteúdo
            /\b(criar|gerar|escrever|redigir|elaborar)\b/i,
            /\b(fazer um|fazer uma)\b.*\b(texto|artigo|post|email|documento)\b/i,
            /\bme ajude a\b.*\b(escrever|criar|gerar)\b/i,
            /\b(generate|create|write)\b/i,
            // Slides e apresentações estruturadas
            /\b(criar|gerar|fazer)\b.*\bslides?\b/i,
            /\bslides?\b.*\b(html|pptx|powerpoint)\b/i,
            /\bapresentação\b.*\b(criar|gerar|fazer)\b/i,
            // HTML estruturado
            /\b(criar|gerar)\b.*\bhtml\b/i,
            /\bhtml\b.*\b(estruturado|organizado)\b/i,
            // Melhoria de conteúdo
            /\b(melhorar|organizar|reorganizar)\b.*\b(conteúdo|texto|html)\b/i,
            /\b(legível|organizado)\b/i,
            // Limite de linhas/estrutura
            /\blimite\s+(de\s+)?(linhas?|caracteres?)\b/i,
            /\bestrutura\b.*\b(criar|gerar)\b/i,
            /\bdividir\b.*\b(blocos?|seções?|partes?)\b/i
        ],
        keywords: ['criar', 'gerar', 'escrever', 'texto', 'artigo', 'slides', 'html', 'estruturar', 'organizar'],
        confidence: 0.85
    },
    {
        type: 'code_generation',
        patterns: [
            /\b(código|code|function|função|classe|class)\b/i,
            /\b(implementar|implement)\b/i,
            /\b(refatorar|refactor)\b/i,
            /\b(correr|fix|bug)\b/i,
            /\b(algoritmo|algorithm)\b/i
        ],
        keywords: ['código', 'function', 'implementar', 'classe'],
        confidence: 0.85
    },
    {
        type: 'system_operation',
        patterns: [
            /\b(armazenar|guardar|salvar|indexar|lembrar|recordar)\b.*\b(mem[óo]ria|conhecimento|grafo)\b/i,
            /\b(store|save|index|remember)\b.*\b(memory|knowledge|graph)\b/i,
            /\bindexar\b.*\b(projeto|pasta|diret[óo]rio|skills)\b/i
        ],
        keywords: ['armazenar', 'memória', 'indexar', 'guardar', 'lembrar'],
        confidence: 0.85
    },
    {
        type: 'data_analysis',
        patterns: [
            /\b(analisar|analizar|analyze|análise)\b/i,
            /\b(dados|data)\b.*\b(analisar|processar|visualizar)\b/i,
            /\b(gráfico|chart|plot)\b/i,
            /\b(estatística|statistics)\b/i
        ],
        keywords: ['analisar', 'dados', 'gráfico', 'estatística'],
        confidence: 0.80
    },
    {
        type: 'information_request',
        patterns: [
            /\b(o que é|o que são|qual é|quais são)\b/i,
            /\b(como funciona|como funciona)\b/i,
            /\b(explicar|explique|explique)\b/i,
            /\b(definir|definição)\b/i,
            /\b(diferença|difference)\b/i,
            /\b\?\s*$/ // termina com ?
        ],
        keywords: ['o que é', 'como', 'explicar', 'definição'],
        confidence: 0.75
    },
    {
        type: 'conversation',
        patterns: [
            /^(oi|olá|ola|bom dia|boa tarde|boa noite|hello|hi|hey|tudo bem|tudo bom|opa|e ai|e aí)\b/i,
            /\b(obrigado|vlw|valeu|thanks|gratidão)\b/i,
            /\b(tchau|adeus|bye|até logo)\b/i,
            /\b(quem é você|quem e voce|o que você faz|o que voce faz)\b/i
        ],
        keywords: ['oi', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'obrigado', 'valeu', 'tchau'],
        confidence: 0.95
    }
];

// ── Classe Principal ────────────────────────────────────────────────────────

export class TaskClassifier {
    private llm: LLMProvider | null = null;
    private logger = createLogger('TaskClassifier');
    private memory = getClassificationMemory();
    private useLlmFallback: boolean;

    constructor(options?: { useLlmFallback?: boolean }) {
        this.useLlmFallback = options?.useLlmFallback ?? true;

        if (this.useLlmFallback) {
            try {
                this.llm = ProviderFactory.getProvider();
            } catch (e) {
                this.logger.warn('llm_unavailable', 'LLM não disponível para classificação, usando heurística apenas.');
            }
        }
    }

    /**
     * Classifica o tipo de tarefa em 4 camadas:
     * 1. Heurística rápida (barata)
     * 2. Memória adaptativa (aprendizado)
     * 3. LLM classificador (quando necessário)
     * 4. Fallback inteligente (elimina generic_task)
     */
    async classify(input: string): Promise<TaskClassification> {
        const normalized = input.toLowerCase().trim();

        // ═══════════════════════════════════════════════════════════════
        // CAMADA 1: Heurística Rápida (resolve ~60%)
        // ═══════════════════════════════════════════════════════════════
        const heuristicResult = this.heuristicClassify(normalized);

        // CORREÇÃO 1: Tipos de alto risco NUNCA vão para LLM
        if (heuristicResult && this.isHighRiskType(heuristicResult.type) && heuristicResult.confidence >= 0.70) {
            // Aprender na memória
            this.memory.store(input, heuristicResult.type, heuristicResult.confidence);
            this.logger.info('classification_heuristic', 'Classificação por heurística (alto risco)', {
                type: heuristicResult.type,
                confidence: heuristicResult.confidence
            });
            return this.enforceNoFileConversionWithoutFileSignal(input, { ...heuristicResult, source: 'heuristic' });
        }

        if (heuristicResult && heuristicResult.confidence >= 0.85) {
            // Aprender na memória
            this.memory.store(input, heuristicResult.type, heuristicResult.confidence);
            this.logger.info('classification_heuristic', 'Classificação por heurística', {
                type: heuristicResult.type,
                confidence: heuristicResult.confidence
            });
            return this.enforceNoFileConversionWithoutFileSignal(input, { ...heuristicResult, source: 'heuristic' });
        }

        // ═══════════════════════════════════════════════════════════════
        // CAMADA 2: Memória Adaptativa (aprendizado instantâneo)
        // ═══════════════════════════════════════════════════════════════
        const memoryResult = this.memory.find(input);
        if (memoryResult && memoryResult.confidence >= 0.70) {
            this.logger.info('classification_memory', 'Classificação via memória adaptativa', {
                type: memoryResult.type,
                confidence: memoryResult.confidence,
                source: memoryResult.source  // 'context' ou 'global'
            });
            return this.enforceNoFileConversionWithoutFileSignal(input, {
                type: memoryResult.type as TaskType,
                confidence: memoryResult.confidence,
                source: 'memory'
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // CAMADA 3: LLM Classificador (quando heurística é incerta)
        // ═══════════════════════════════════════════════════════════════
        if (this.useLlmFallback && this.llm && heuristicResult && heuristicResult.confidence < 0.70) {
            const llmResult = await this.llmClassify(input);

            // CORREÇÃO 2: Rejeitar generic_task e unknown do LLM
            if (llmResult && this.isValidTaskType(llmResult.type) && llmResult.confidence >= 0.70) {
                // Verificar se LLM discordou da memória (penalizar entrada antiga)
                if (memoryResult && memoryResult.type !== llmResult.type) {
                    this.logger.warn('memory_conflict', 'LLM discordou da memória, penalizando', {
                        memory_type: memoryResult.type,
                        llm_type: llmResult.type
                    });
                    this.memory.penalize(input, memoryResult.type);
                }

                // Aprender na memória
                this.memory.store(input, llmResult.type, llmResult.confidence);
                this.logger.info('classification_llm', 'Classificação por LLM', {
                    type: llmResult.type,
                    confidence: llmResult.confidence
                });
                return this.enforceNoFileConversionWithoutFileSignal(input, { ...llmResult, source: 'llm' });
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // CAMADA 4: Fallback Inteligente (elimina generic_task)
        // ═══════════════════════════════════════════════════════════════
        const fallbackResult = this.fallbackClassify(normalized, heuristicResult);
        // NÃO aprender fallback - só aprende classificações com alta confiança
        this.logger.info('classification_fallback', 'Classificação por fallback', {
            type: fallbackResult.type,
            confidence: fallbackResult.confidence
        });
        return this.enforceNoFileConversionWithoutFileSignal(input, { ...fallbackResult, source: 'fallback' });
    }

    /**
     * Tipos de alto risco que NUNCA devem ser sobrescritos pelo LLM.
     * system_operation, skill_installation, file_conversion são críticos.
     */
    private isHighRiskType(type: TaskType): boolean {
        return ['system_operation', 'skill_installation', 'file_conversion'].includes(type);
    }

    /**
     * Classificação síncrona para compatibilidade com código existente.
     * Usa apenas heurística + fallback (sem LLM).
     */
    classifySync(input: string): TaskClassification {
        const normalized = input.toLowerCase().trim();

        // Heurística
        const heuristicResult = this.heuristicClassify(normalized);
        if (heuristicResult && heuristicResult.confidence >= 0.85) {
            return this.enforceNoFileConversionWithoutFileSignal(input, { ...heuristicResult, source: 'heuristic' });
        }

        // Fallback
        const fallbackResult = this.fallbackClassify(normalized, heuristicResult);
        return this.enforceNoFileConversionWithoutFileSignal(input, { ...fallbackResult, source: 'fallback' });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CAMADA 1: Heurística
    // ═══════════════════════════════════════════════════════════════════════

    private heuristicClassify(normalized: string): TaskClassification | null {
        let bestMatch: TaskClassification | null = null;

        // ═══════════════════════════════════════════════════════════════════
        // VERIFICAÇÕES PRIORITÁRIAS (antes de qualquer outra coisa)
        // ═══════════════════════════════════════════════════════════════════

        // 1. Comandos de terminal - sempre system_operation
        if (this.isTerminalCommand(normalized)) {
            return { type: 'system_operation', confidence: 0.98, source: 'heuristic' };
        }

        // 2. Skill installation - sempre skill_installation
        if (this.isSkillInstallation(normalized)) {
            return { type: 'skill_installation', confidence: 0.98, source: 'heuristic' };
        }

        // 3. CONSULTAS SEGURAS DE MEMORIA/IDENTIDADE - information_request
        if (this.isMemorySelfQuery(normalized)) {
            return { type: 'information_request', confidence: 0.98, source: 'heuristic' };
        }

        // 4. PERGUNTAS SOBRE O SISTEMA/PASSADO - information_request
        if (this.isMetaQuestion(normalized)) {
            return { type: 'information_request', confidence: 0.95, source: 'heuristic' };
        }

        // 5. OPERACOES DE ARQUIVO - filesystem
        if (this.isFilesystemOperation(normalized)) {
            return { type: 'filesystem', confidence: 0.90, source: 'heuristic' };
        }

        // 6. CRIAÇÃO DE SLIDES/HTML - content_generation
        if (this.isContentGeneration(normalized)) {
            return { type: 'content_generation', confidence: 0.95, source: 'heuristic' };
        }

        // 7. Conversão de arquivos - MAS NÃO se for melhoria/organização
        if (this.isFileConversion(normalized)) {
            return { type: 'file_conversion', confidence: 0.95, source: 'heuristic' };
        }

        // Aplicar regras heurísticas
        for (const rule of HEURISTIC_RULES) {
            let ruleConfidence = 0;

            // Verificar padrões regex
            for (const pattern of rule.patterns) {
                if (pattern.test(normalized)) {
                    ruleConfidence = Math.max(ruleConfidence, rule.confidence);
                }
            }

            // Verificar keywords
            for (const keyword of rule.keywords) {
                if (normalized.includes(keyword.toLowerCase())) {
                    ruleConfidence = Math.max(ruleConfidence, rule.confidence * 0.9);
                }
            }

            if (ruleConfidence > (bestMatch?.confidence ?? 0)) {
                bestMatch = { type: rule.type, confidence: ruleConfidence, source: 'heuristic' };
            }
        }

        return bestMatch;
    }

    private isTerminalCommand(normalized: string): boolean {
        // Comandos de terminal são sempre system_operation
        const terminalPatterns = [
            /\bnpx\s+\w+/i,
            /\bnpm\s+(install|add|run|update)/i,
            /\byarn\s+(add|install|run)/i,
            /\bpip\s+(install|uninstall)/i,
            /\bapt(-get)?\s+(install|update|upgrade|remove)/i,
            /\bbrew\s+(install|uninstall)/i,
            /\bsudo\s+\w+/i,
            /\b(chmod|chown|rm|mkdir|touch|cp|mv)\s+/i
        ];

        return terminalPatterns.some(pattern => pattern.test(normalized));
    }

    private isSkillInstallation(normalized: string): boolean {
        const skillPatterns = [
            /\b(instale|instalar|adicionar|adicione)\s+(uma\s+)?skill\b/i,
            /\b(install|add)\s+skill\b/i,
            /^(npx|npm)\s+skills?\s+(add|install)/i
        ];

        return skillPatterns.some(pattern => pattern.test(normalized));
    }

    private isMemorySelfQuery(normalized: string): boolean {
        const memoryPatterns = [
            /\b(mem[óo]ria|memory|hist[oó]rico|contexto|lembra|lembran[çc]a|recorda)\b.*\b(sobre mim|de mim|minha|meu|me)\b/i,
            /\b(o que|qual|quais)\b.*\b(mem[óo]ria|memory|hist[oó]rico|contexto)\b/i,
            /\b(o que)\b.*\b(sabe|lembra|recorda)\b.*\b(sobre mim|de mim)\b/i
        ];

        return memoryPatterns.some(pattern => pattern.test(normalized));
    }

    private isFilesystemOperation(normalized: string): boolean {
        const filesystemPatterns = [
            /\b(criar|crie|fazer|faça|montar|monte)\b.*\b(pasta|diret[óo]rio|folder)\b/i,
            /\b(criar|crie|salvar|salve|escrever|escreva)\b.*\b(arquivo|file)\b/i,
            /\b(salvar|salve|gravar|grave)\b.*\b(conte[úu]do|html|json|texto)\b.*\b(arquivo|file)\b/i
        ];

        return filesystemPatterns.some(pattern => pattern.test(normalized));
    }

    /**
     * Detecta criação de conteúdo estruturado (slides, HTML organizado, etc).
     * CRÍTICO: NUNCA classificar como file_conversion.
     * 
     * Exemplos:
     * - "criar slides em HTML" → content_generation (NÃO file_conversion)
     * - "organizar conteúdo em 6 linhas por slide" → content_generation
     * - "melhorar HTML deixando mais legível" → content_generation
     */
    private isContentGeneration(normalized: string): boolean {
        // EXCEÇÃO 1: Se é uma pergunta sobre o passado ou como funciona (meta-pergunta)
        if (this.isMetaQuestion(normalized)) {
            return false;
        }

        // EXCEÇÃO 2: "fazer uma varredura" ou "fazer um scan" NÃO é content_generation
        if (/\b(varredura|varedura|scan|escanear)\b/i.test(normalized)) {
            return false;
        }

        // EXCEÇÃO 3: Operações de arquivo reais (mover, deletar, copiar) NÃO são content_generation
        if (/\b(mover|move|deletar|delete|remover|remove|copiar|copy)\b.*\b(arquivo|pasta|file|folder|diret[óo]rio)\b/i.test(normalized)) {
            return false;
        }

        // EXCEÇÃO 3: Pergunta genérica sem imperativo de criação
        const lacksImperative = !/\b(crie|gere|faça|faca|monte|redija|elabora|escreva|write|create|generate)\b/i.test(normalized);
        const isQuestion = normalized.includes('?') || /^(o que|como|qual|quais|quem|onde|quando|por que|porque|você|voce|podia|poderia|seria)\b/i.test(normalized);

        if (isQuestion && lacksImperative && /\b(slides?|html|texto|post|artigo)\b/i.test(normalized)) {
            // Se o usuário pergunta "o que são slides" ou "você usou slides", não é criação
            return false;
        }

        // Criação de slides/apresentações
        if (/\b(criar|gerar|fazer|montar)\b.*\bslides?\b/i.test(normalized)) {
            return true;
        }
        if (/\bslides?\b.*\b(html|pptx|powerpoint|apresentação)\b/i.test(normalized)) {
            return true;
        }

        // HTML estruturado/organizado
        if (/\b(criar|gerar|fazer)\b.*\bhtml\b/i.test(normalized)) {
            return true;
        }
        if (/\bhtml\b.*\b(estruturado|organizado|slides?)\b/i.test(normalized)) {
            return true;
        }

        // Limite de linhas/estrutura
        if (/\blimite\s*(de)?\s*(linhas?|caracteres?)\b/i.test(normalized)) {
            return true;
        }
        if (/\b(6|seis)\s*linhas?\b/i.test(normalized)) {
            return true;
        }

        // Melhoria/organização de conteúdo
        if (/\b(melhorar|organizar|reorganizar)\b.*\b(conteúdo|texto|html|slides?)\b/i.test(normalized)) {
            return true;
        }
        if (/\b(melhorar|deixar)\b.*\b(legível|organizado|estruturado)\b/i.test(normalized)) {
            return true;
        }

        // Divisão em blocos/seções
        if (/\bdividir\b.*\b(blocos?|seções?|partes?|slides?)\b/i.test(normalized)) {
            return true;
        }
        if (/\bestrutura\b.*\b(criar|gerar|fazer)\b/i.test(normalized)) {
            return true;
        }

        return false;
    }

    /**
     * Detecta "meta-perguntas" sobre o agente, seu estado ou ações passadas.
     * Ex: "você usou...", "como você fez...", "o que você é..."
     */
    private isMetaQuestion(normalized: string): boolean {
        const metaPatterns = [
            /\b(você|voce|tu|sua|seu)\b.*\b(utilizou|usou|fez|criou|conseguiu|pode|consegue|saberia)\b/i,
            /\bcomo\b.*\b(consegue|funciona|opera|faz|conseguiu)\b/i,
            /\b(qual|o que|quem)\b.*\b(é|es|sois|voce|você)\b/i,
            /\b(você|voce)\b.*\b(conhece|sabe|entende)\b/i
        ];

        const isQuestionFormat = normalized.includes('?') || /^(como|o que|qual|quais|quando|onde|quem)\b/i.test(normalized);

        return isQuestionFormat && metaPatterns.some(pattern => pattern.test(normalized));
    }

    private isFileConversion(normalized: string): boolean {
        // IMPORTANTE: Verificar se NÃO é content_generation primeiro
        if (this.isContentGeneration(normalized)) {
            return false;
        }

        // Tem caminho de arquivo E palavra de conversão (NÃO melhoria)
        const hasFilePath = /\/[\w\-\.\/]+\.(md|html|pptx|pdf|txt|json)/i.test(normalized) ||
            /[\w\-]+\/[\w\-]+\.(md|html|pptx|pdf)/i.test(normalized);

        const hasConversionWord = /\b(converter|transformar|convert)\b/i.test(normalized);

        return hasFilePath && hasConversionWord;
    }

    private hasFileSignal(input: string): boolean {
        const normalized = input.toLowerCase();
        return /\b(arquivo|caminho|path|diret[óo]rio|pasta)\b/i.test(normalized)
            || /\.(txt|pdf|md|html|json|docx|pptx|csv|xlsx)\b/i.test(normalized)
            || /\/[\w\-.\/]+\.[a-z0-9]+/i.test(normalized)
            || /[a-z]:\\[^\s]+\.[a-z0-9]+/i.test(input);
    }

    private enforceNoFileConversionWithoutFileSignal(input: string, classification: TaskClassification): TaskClassification {
        if (classification.type !== 'file_conversion') {
            return classification;
        }

        if (this.hasFileSignal(input)) {
            return classification;
        }

        this.logger.info('file_conversion_blocked_no_file_signal', 'Bloqueando file_conversion sem sinal de arquivo', {
            original_type: classification.type,
            fallback_type: 'content_generation'
        });

        return {
            ...classification,
            type: 'content_generation',
            confidence: Math.max(classification.confidence, 0.85)
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CAMADA 2: LLM Classificador
    // ═══════════════════════════════════════════════════════════════════════

    private async llmClassify(input: string): Promise<TaskClassification | null> {
        if (!this.llm) return null;

        const prompt = `Classifique a intenção do usuário em UM dos tipos:

Tipos válidos:
- file_conversion: converter arquivos (md→pptx, etc)
- skill_installation: instalar/adicionar skills
- system_operation: comandos de terminal (npx, npm, apt, etc)
- file_search: procurar/arquivos
- content_generation: criar/gerar conteúdo
- code_generation: código, funções, classes
- data_analysis: análise de dados
- information_request: perguntas, explicações

REGRAS CRÍTICAS:
- Se envolve comandos de terminal (npx, npm, apt, pip, sudo) → system_operation
- Se envolve instalar skill → skill_installation
- Se envolve converter arquivos → file_conversion
- NÃO existe "generic_task"
- Se incerto, escolha o mais provável

Input: "${input}"

Responda APENAS JSON válido:
{"type": "...", "confidence": 0.0-1.0}`;

        try {
            const response = await this.llm.generate([
                { role: 'system', content: 'Você é um classificador de intenções. Responda apenas JSON válido.' },
                { role: 'user', content: prompt }
            ]);

            if (response.final_answer) {
                const parsed = this.parseClassification(response.final_answer);
                if (parsed && this.isValidTaskType(parsed.type)) {
                    return parsed;
                }
            }
        } catch (error) {
            this.logger.warn('llm_classify_error', 'Erro na classificação por LLM', { error: String(error) });
        }

        return null;
    }

    private parseClassification(response: string): TaskClassification | null {
        try {
            // Tentar extrair JSON da resposta
            const jsonMatch = response.match(/\{[^}]+\}/);
            if (!jsonMatch) return null;

            const parsed = JSON.parse(jsonMatch[0]);
            if (!parsed.type || typeof parsed.confidence !== 'number') return null;

            return {
                type: parsed.type as TaskType,
                confidence: Math.min(1, Math.max(0, parsed.confidence)),
                source: 'llm'
            };
        } catch {
            return null;
        }
    }

    private isValidTaskType(type: string): boolean {
        // CORREÇÃO 2: Rejeitar generic_task e unknown
        const invalidTypes = ['generic_task', 'unknown'];
        if (invalidTypes.includes(type)) {
            return false;
        }

        const validTypes: TaskType[] = [
            'file_conversion', 'file_search', 'filesystem', 'content_generation',
            'system_operation', 'skill_installation', 'information_request',
            'code_generation', 'data_analysis'
        ];
        return validTypes.includes(type as TaskType);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CAMADA 3: Fallback Inteligente
    // ═══════════════════════════════════════════════════════════════════════

    private fallbackClassify(normalized: string, heuristicResult: TaskClassification | null): TaskClassification {
        // Se heurística encontrou algo com confiança razoável, usar
        if (heuristicResult && heuristicResult.confidence >= 0.60) {
            // Rejeitar generic_task - converter para algo útil
            if (heuristicResult.type === 'generic_task' || heuristicResult.type === 'unknown') {
                return this.smartFallback(normalized);
            }
            return heuristicResult;
        }

        // Fallback inteligente baseado em contexto
        return this.smartFallback(normalized);
    }

    private smartFallback(normalized: string): TaskClassification {
        // CORREÇÃO 3: SEMPRE verificar comandos de terminal PRIMEIRO
        // "como rodar npm install" contém "como" mas é system_operation, não pergunta
        if (this.isTerminalCommand(normalized)) {
            return { type: 'system_operation', confidence: 0.75, source: 'fallback' };
        }

        // Se menciona instalar skill
        if (this.isSkillInstallation(normalized)) {
            return { type: 'skill_installation', confidence: 0.75, source: 'fallback' };
        }

        // Depois verificar se parece pergunta
        if (/\b(o que|qual|como|quando|por que|porque|onde)\b/.test(normalized) || /\?\s*$/.test(normalized)) {
            return { type: 'information_request', confidence: 0.70, source: 'fallback' };
        }

        // Se menciona arquivo
        if (/\.(md|txt|json|html|pdf|pptx|js|ts|py)\b/.test(normalized) || /\b(arquivo|file|diretório)\b/.test(normalized)) {
            return { type: 'file_search', confidence: 0.65, source: 'fallback' };
        }

        // Se menciona criar/gerar
        if (/\b(criar|gerar|fazer|escrever|montar)\b/.test(normalized)) {
            return { type: 'content_generation', confidence: 0.65, source: 'fallback' };
        }

        // Default seguro - Se for muito curto, assume conversação
        if (normalized.length < 5) {
            return { type: 'conversation', confidence: 0.70, source: 'fallback' };
        }

        // Default seguro - information_request é sempre útil
        return { type: 'information_request', confidence: 0.50, source: 'fallback' };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DETECÇÃO DE CONTINUIDADE E INTENÇÃO INCOMPLETA
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Detecta se o input é continuação de uma tarefa anterior.
     * Exemplo: "e para utilizar o arquivo X" é continuação de "criar slides"
     */
    isContinuation(input: string): boolean {
        const normalized = input.toLowerCase().trim();
        return CONTINUATION_INDICATORS.some(pattern => pattern.test(normalized));
    }

    /**
     * Detecta se o input tem fonte de conteúdo explícita.
     * Exemplo: "usar o arquivo /home/..." ou "conteúdo: ..."
     */
    hasContentSource(input: string): boolean {
        const normalized = input.toLowerCase();
        return CONTENT_SOURCE_INDICATORS.some(pattern => pattern.test(normalized));
    }

    /**
     * Verifica se o tipo de tarefa precisa de fonte de conteúdo.
     */
    requiresContentSource(type: TaskType): boolean {
        return CONTENT_GENERATION_NEEDS_SOURCE.includes(type);
    }

    /**
     * Classifica com detecção de continuidade e intenção incompleta.
     * Retorna classificação enriquecida com needsContext e isContinuation.
     */
    async classifyWithContext(
        input: string,
        lastTaskType?: TaskType
    ): Promise<TaskClassification> {
        const normalized = input.toLowerCase().trim();
        const baseClassification = await this.classify(input);

        // ═══════════════════════════════════════════════════════════════════
        // 1. DETECTAR CONTINUIDADE
        // ═══════════════════════════════════════════════════════════════════
        const isContinuation = this.isContinuation(input);

        if (isContinuation && lastTaskType) {
            // Se é continuação e última tarefa era content_generation,
            // MANTER o tipo (não virar file_conversion)
            return {
                ...baseClassification,
                type: lastTaskType,
                isContinuation: true,
                lastTaskType,
                confidence: Math.max(baseClassification.confidence, 0.90)
            };
        }

        // ═══════════════════════════════════════════════════════════════════
        // 2. DETECTAR INTENÇÃO INCOMPLETA
        // ═══════════════════════════════════════════════════════════════════
        if (this.requiresContentSource(baseClassification.type)) {
            const hasSource = this.hasContentSource(input);

            if (!hasSource) {
                // Intenção incompleta - precisa de contexto
                // NÃO usar texto hardcoded - delega para t()
                return {
                    ...baseClassification,
                    needsContext: true,
                    contextQuestion: t('content.ask_for_source')
                };
            }
        }

        return {
            ...baseClassification,
            isContinuation: false
        };
    }
}

// ── Função de compatibilidade (síncrona) ─────────────────────────────────────

const defaultClassifier = new TaskClassifier({ useLlmFallback: false });

export function classifyTask(text: string): TaskClassification {
    return defaultClassifier.classifySync(text);
}

/**
 * Classifica com detecção de continuidade e intenção incompleta.
 * Útil para detectar quando precisa de mais contexto.
 */
export function classifyTaskWithContext(
    text: string,
    lastTaskType?: TaskType
): Promise<TaskClassification> {
    return defaultClassifier.classifyWithContext(text, lastTaskType);
}

/**
 * Verifica se o input é continuação de tarefa anterior.
 */
export function isTaskContinuation(text: string): boolean {
    return defaultClassifier.isContinuation(text);
}

/**
 * Verifica se o input tem fonte de conteúdo explícita.
 */
export function hasContentSourceInput(text: string): boolean {
    return defaultClassifier.hasContentSource(text);
}

export function getForcedPlanForTaskType(type: TaskType): string[] | null {
    switch (type) {
        case 'file_conversion':
            return [
                'localizar arquivo de origem',
                'verificar formato do arquivo',
                'converter para formato de destino',
                'salvar resultado',
                'verificar conversão'
            ];
        case 'file_search':
            return [
                'localizar arquivo no diretório alvo',
                'listar diretório',
                'ler arquivo'
            ];
        case 'filesystem':
            return [
                'criar diretório',
                'criar arquivo',
                'salvar arquivo'
            ];
        case 'content_generation':
            return [
                'obter conteúdo fonte',
                'interpretar e segmentar conteúdo',
                'estruturar conteúdo no formato solicitado',
                'gerar saída formatada',
                'salvar resultado se necessário'
            ];
        case 'system_operation':
            return [
                'verificar pré-requisitos',
                'preparar comando',
                'executar operação',
                'verificar resultado',
                'reportar status'
            ];
        case 'skill_installation':
            return [
                'identificar nome da skill',
                'verificar se já está instalada',
                'buscar skill no repositório',
                'executar instalação',
                'verificar instalação'
            ];
        case 'code_generation':
            return [
                'analisar requisitos',
                'gerar código',
                'verificar sintaxe',
                'salvar arquivo'
            ];
        case 'data_analysis':
            return [
                'carregar dados',
                'processar análise',
                'gerar visualização se necessário',
                'apresentar resultados'
            ];
        case 'information_request':
            return [
                'analisar pergunta',
                'buscar informações relevantes',
                'formular resposta',
                'apresentar resposta'
            ];
        default:
            return [
                'analisar solicitação',
                'executar ação apropriada',
                'verificar resultado'
            ];
    }
}

export function getForcedExecutablePlanForTaskType(type: TaskType, userInput: string): ForcedExecutableStep[] | null {
    if (type === 'filesystem') {
        const deterministicPlan = buildExecutionPlan(type, userInput);
        if (deterministicPlan) {
            return mapDeterministicToForcedSteps(deterministicPlan);
        }
    }

    switch (type) {
        case 'file_search':
            return [
                { description: 'localizar arquivo no diretório alvo', tool: 'search_file', params: {} },
                { description: 'listar diretório', tool: 'list_directory', params: {} },
                { description: 'ler arquivo', tool: 'read_local_file', params: {} }
            ];
        case 'file_conversion':
            return [
                { description: 'localizar arquivo de origem', tool: 'read_local_file', params: {} },
                { description: 'verificar formato do arquivo', tool: 'read_local_file', params: {} },
                { description: 'converter para formato de destino', tool: 'file_convert', params: {} },
                { description: 'salvar resultado', tool: 'write_file', params: {} },
                { description: 'verificar conversão', tool: 'read_local_file', params: {} }
            ];
        case 'system_operation':
            return [
                { description: 'verificar pré-requisitos', tool: 'list_directory', params: {} },
                { description: 'preparar comando', tool: 'exec_command', params: {} },
                { description: 'executar operação', tool: 'exec_command', params: {} },
                { description: 'verificar resultado', tool: 'exec_command', params: {} },
                { description: 'reportar status', tool: 'list_directory', params: {} }
            ];
        case 'skill_installation':
            return [
                { description: 'identificar nome da skill', tool: 'web_search', params: {} },
                { description: 'verificar se já está instalada', tool: 'list_directory', params: {} },
                { description: 'buscar skill no repositório', tool: 'web_search', params: {} },
                { description: 'executar instalação', tool: 'write_skill_file', params: {} },
                { description: 'verificar instalação', tool: 'list_directory', params: {} }
            ];
        default:
            return null;
    }
}

export function buildExecutionPlan(taskType: TaskType, userInput: string): DeterministicExecutionStep[] | null {
    const builder = ExecutionPlanRegistry.get(taskType);
    if (!builder) {
        return null;
    }

    return builder(userInput);
}

function mapDeterministicToForcedSteps(steps: DeterministicExecutionStep[]): ForcedExecutableStep[] {
    return steps.map(step => ({
        description: getToolDescription(step.tool),
        tool: step.tool,
        params: step.params
    }));
}

export function getToolDescription(tool: string): string {
    switch (tool) {
        case 'create_directory':
            return 'criar diretório';
        case 'write_file':
            return 'salvar arquivo';
        default:
            return 'executar operação';
    }
}
