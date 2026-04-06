import { TaskType } from '../agent/TaskClassifier';
import { createLogger } from '../../shared/AppLogger';

export enum ExecutionRoute {
    DIRECT_LLM = 'direct_llm',
    TOOL_LOOP = 'tool_loop'
}

/**
 * Modos de execução para tarefas híbridas.
 * Ex: "crie um arquivo com esse conteúdo" → TOOL_ASSISTED_LLM
 */
export enum ExecutionMode {
    PURE_LLM = 'pure_llm',           // Apenas geração de texto
    TOOL_ASSISTED_LLM = 'tool_assisted_llm', // LLM gera → tool salva
    PURE_TOOL = 'pure_tool'           // Apenas execução de ferramenta
}

export enum TaskNature {
    INFORMATIVE = 'informative',   // Pode responder direto (conceitual)
    HYBRID = 'hybrid',             // Responde direto + opcionalmente usa tool
    EXECUTABLE = 'executable'      // Precisa de dados ou ferramentas
}

export enum IntentSubtype {
    COMMAND = 'command',       // "mova os arquivos"
    SUGGESTION = 'suggestion', // "acho que deveria mover"
    DOUBT = 'doubt',           // "por que os arquivos estão aí?"
    UNCERTAIN = 'uncertain'    // Não bate forte em nada
}

export interface RouteDecision {
    route: ExecutionRoute;
    subtype: IntentSubtype;
    nature: TaskNature;
    confidence: number;
}

/**
 * ActionRouter: Decide o fluxo de execução baseado na "agibilidade" (actionability) do input.
 * Evita que tarefas que exigem ações no mundo real sejam tratadas como apenas geração de texto.
 */
export class ActionRouter {
    private logger = createLogger('ActionRouter');

    /**
     * Termos que indicam fortemente a necessidade de execução de ferramentas.
     */
    private readonly ACTION_KEYWORDS = [
        'mover', 'move', 'mova', 'renomear', 'rename',
        'deletar', 'delete', 'deleta', 'remover', 'remove', 'remova', 'rm',
        'criar', 'create', 'cria', 'gerar', 'generate', 'gera', 'write', 'escrever', 'escreve', 'salvar', 'save', 'salva',
        'buscar', 'search', 'localizar', 'find', 'procurar', 'pesquisar', 'pesquise',
        'listar', 'list', 'ls',
        'converter', 'convert', 'transformar', 'transform',
        'executar', 'run', 'rodar', 'apply', 'aplicar',
        'instalar', 'install', 'add', 'adicionar', 'instale',
        'workspace', 'diretório', 'directory', 'pasta', 'folder', 'arquivo', 'file',
        'arquivos', 'files', 'pastas', 'folders', 'pacote', 'package', 'dependencia', 'dependency',
        'library', 'biblioteca'
    ];

    /**
     * Padrões regex para detectar intenção de ação.
     */
    private readonly ACTION_PATTERNS = [
        /\b(mover|move|mova|copy|copiar|copia|delete|deleta|remover|remova)\b.*\b(arquivo|pasta|file|folder|diret[óo]rio|arquivos|pastas|files|folders)\b/i,
        /\b(criar|create|cria|save|salvar|salva|write|escrever|escreve)\b.*\b(arquivo|file|documento|arquivos|files|documentos)\b/i,
        /\b(npx|npm|pip|python|node|sh|bash)\b/i,
        /\/[\w\-\.\/]+\.\w+/ // Caminhos de arquivo
    ];

    /**
     * Padrões para subtipos de intenção.
     */
    private readonly SUBTYPE_PATTERNS = {
        SUGGESTION: /\b(acho que|deveria|poderia|seria bom|talvez|quem sabe|sugiro|recommend|should|could|maybe)\b/i,
        DOUBT: /\?|^(por que|como|onde|qual|quais|when|why|where|how|consegue|consegue[ms]|pode|podem)\b/i
    };

    /**
     * Decide a rota de execução para uma tarefa.
     */
    public decideRoute(input: string, taskType: TaskType | null): RouteDecision {
        const normalizedInput = input.toLowerCase();

        // 1. Detectar Subtipo
        let subtype = this.detectSubtype(normalizedInput);

        // 2. Detectar Natureza (Informação vs Execução)
        let nature = this.detectTaskNature(normalizedInput);

        // 3. Verificar Agibilidade (Actionability)
        const requiresTool = this.requiresToolExecution(normalizedInput);
        const requiresExternalInformation = this.requiresExternalInformation(normalizedInput, taskType);

        // 4. Rota Inicial
        let route = ExecutionRoute.TOOL_LOOP;
        let confidence = requiresTool ? 0.99 : 0.50;

        const infoTypes: TaskType[] = ['content_generation', 'information_request', 'conversation', 'data_analysis'];

        const isMemorySelfQuery = this.isMemorySelfQuery(normalizedInput, taskType);
        const isCapabilitySelfQuery = this.isCapabilitySelfQuery(normalizedInput);

        if (isMemorySelfQuery) {
            route = ExecutionRoute.DIRECT_LLM;
            nature = TaskNature.INFORMATIVE;
            confidence = 1.0;
            subtype = IntentSubtype.COMMAND;
        } else if (isCapabilitySelfQuery) {
            route = ExecutionRoute.TOOL_LOOP;
            confidence = 1.0;
            subtype = IntentSubtype.COMMAND; // Evita bloqueio pelo DecisionEngine (legacy guard 'doubt' → ASK)
        } else if (requiresExternalInformation) {
            route = ExecutionRoute.TOOL_LOOP;
            nature = TaskNature.EXECUTABLE;
            confidence = 1.0;
            subtype = IntentSubtype.COMMAND;
        } else if (!requiresTool && (infoTypes.includes(taskType as TaskType) || nature === TaskNature.INFORMATIVE)) {
            route = ExecutionRoute.DIRECT_LLM;
            confidence = (taskType === 'conversation' || taskType === 'information_request') ? 1.0 : 0.95;
        }

        // 5. Ajustar confiança baseada no subtipo (Garantindo que self-queries não sejam penalizadas)
        if (!isMemorySelfQuery && !isCapabilitySelfQuery && !requiresExternalInformation) {
            if (subtype === IntentSubtype.SUGGESTION) {
                confidence *= 0.8;
            } else if (subtype === IntentSubtype.DOUBT) {
                confidence *= 0.6;
            } else if (subtype === IntentSubtype.UNCERTAIN && taskType !== 'conversation') {
                confidence *= 0.5;
            }
        }

        const decision: RouteDecision = { route, subtype, nature, confidence };

        this.logger.debug('route_decision', `[ROUTER] Decisão de rota: ${route} (${subtype})`, {
            input: normalizedInput.slice(0, 50),
            taskType,
            confidence: confidence.toFixed(2)
        });

        return decision;
    }

    /**
         * Detecta o subtipo da intenção no input.
         */
    private detectSubtype(input: string): IntentSubtype {
        if (this.SUBTYPE_PATTERNS.DOUBT.test(input)) {
            return IntentSubtype.DOUBT;
        }
        if (this.SUBTYPE_PATTERNS.SUGGESTION.test(input)) {
            return IntentSubtype.SUGGESTION;
        }

        // ── NOVO: Detectar incerteza ──
        // Se não tem padrão de ação claro
        const hasActionPattern = this.ACTION_PATTERNS.some(pattern => pattern.test(input));
        const hasActionKeyword = this.ACTION_KEYWORDS.some(kw => input.includes(kw));

        if (!hasActionPattern && !hasActionKeyword) {
            return IntentSubtype.UNCERTAIN;
        }

        return IntentSubtype.COMMAND;
    }

    /**
     * Detecta a natureza da tarefa: INFORMATIVA (conceitual) vs EXECUTÁVEL (dados/ferramentas).
     */
    private detectTaskNature(input: string): TaskNature {
        const hasDataIndicators =
            /arquivo|file|dados|dataset|csv|json|planilha|dataset|tabela|spreadsheet|mercado|market|gold|paxg/i.test(input);

        const isConceptual =
            /analis[ae]|explain|explica|como|quem|qual|pre[çc]o|valor|tend[eê]ncia|cen[aá]rio/i.test(input);

        const isDirectCommand =
            /^\b(mover|move|mova|deletar|remover|remova|rm|criar|create|cria|save|salvar|salva|escrever|write|executar|run|rodar)\b/i.test(input);

        if (isConceptual && hasDataIndicators && !isDirectCommand) {
            return TaskNature.HYBRID;
        }

        if (isConceptual && !hasDataIndicators) {
            return TaskNature.INFORMATIVE;
        }

        return TaskNature.EXECUTABLE;
    }

    private requiresExternalInformation(input: string, taskType: TaskType | null): boolean {
        if (taskType !== 'information_request' && taskType !== 'data_analysis') {
            return false;
        }

        const hasLookupVerb = /\b(verificar|verifique|consultar|consulte|pesquisar|pesquise|buscar|busque|check|lookup|look up)\b/i.test(input);
        const hasTimeSensitiveMarker = /\b(atual|agora|hoje|recente|recentes|latest|current|today|now)\b/i.test(input);
        const hasMarketOrExternalDomain = /\b(pre[çc]o|cota[cç][aã]o|valor|situa[cç][aã]o|mercado|market|not[ií]cia|news|cripto|criptomoeda|crypto|bitcoin|ethereum|paxg|pax gold|ouro|gold|clima|weather)\b/i.test(input);

        return (hasLookupVerb && hasMarketOrExternalDomain) || (hasTimeSensitiveMarker && hasMarketOrExternalDomain);
    }

    private isMemorySelfQuery(input: string, taskType: TaskType | null): boolean {
        if (taskType === 'information_request') {
            const memoryQuery = /\b(mem[óo]ria|memory|hist[oó]rico|contexto|lembra|recorda)\b.*\b(sobre mim|de mim|minha|meu|me)\b/i.test(input)
                || /\b(o que)\b.*\b(sabe|lembra|recorda)\b.*\b(sobre mim|de mim)\b/i.test(input);

            if (memoryQuery) {
                return true;
            }
        }

        return false;
    }

    private isCapabilitySelfQuery(input: string): boolean {
        return /sabe\s+fazer|consegue|pode\s+ajudar|skills|tools|suporte|expert/i.test(input);
    }

    /**
          * Detecta se o input exige ação no mundo real (uso de tools).
          * Usa abordagem híbrida: verbo forte + objeto alvo.
          */
    private requiresToolExecution(input: string): boolean {
        // Verificar padrões regex (mais forte)
        if (this.ACTION_PATTERNS.some(pattern => pattern.test(input))) {
            return true;
        }

        // ── Abordagem híbrida (melhoria do code review) ──
        const tokens = input.split(/\s+/);

        // Verificar se há um verbo forte de ação
        const hasStrongVerb = tokens.some(t => this.ACTION_KEYWORDS.includes(t));

        // Verificar se há um objeto alvo (arquivo, pasta, etc)
        const hasObject = /\b(arquivo|file|pasta|folder|diret[óo]rio|arquivos|files|pastas|folders|pacote|package|dependencia|dependency|library|biblioteca)\b/i.test(input);

        // Se tem verbo forte E objeto → alta probabilidade de ação
        if (hasStrongVerb && hasObject) {
            return true;
        }

        // Fallback: 2+ keywords de ação (heurística original)
        const actionScore = tokens.filter(token => this.ACTION_KEYWORDS.includes(token)).length;
        return actionScore >= 2;
    }
}

// Singleton para uso global
let routerInstance: ActionRouter | null = null;

export function getActionRouter(): ActionRouter {
    if (!routerInstance) {
        routerInstance = new ActionRouter();
    }
    return routerInstance;
}
