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
        'buscar', 'search', 'localizar', 'find', 'procurar',
        'listar', 'list', 'ls',
        'converter', 'convert', 'transformar', 'transform',
        'executar', 'run', 'rodar', 'apply', 'aplicar',
        'instalar', 'install', 'add', 'adicionar',
        'workspace', 'diretório', 'directory', 'pasta', 'folder', 'arquivo', 'file',
        'arquivos', 'files', 'pastas', 'folders'
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
        const subtype = this.detectSubtype(normalizedInput);

        // 2. Detectar Natureza (Informação vs Execução)
        const nature = this.detectTaskNature(normalizedInput);

        // 3. Verificar Agibilidade (Actionability)
        const requiresTool = this.requiresToolExecution(normalizedInput);

        // 4. Rota Inicial
        let route = ExecutionRoute.TOOL_LOOP;
        let confidence = requiresTool ? 0.99 : 0.50;

        const infoTypes: TaskType[] = ['content_generation', 'information_request', 'conversation', 'data_analysis'];

        if (!requiresTool && (infoTypes.includes(taskType as TaskType) || nature === TaskNature.INFORMATIVE)) {
            route = ExecutionRoute.DIRECT_LLM;
            confidence = (taskType === 'conversation' || taskType === 'information_request') ? 1.0 : 0.95;
        }

        // 5. Ajustar confiança baseada no subtipo
        if (subtype === IntentSubtype.SUGGESTION) {
            confidence *= 0.8; // Reduz confiança para sugestões
        } else if (subtype === IntentSubtype.DOUBT) {
            confidence *= 0.6; // Reduz confiança para dúvidas
        } else if (subtype === IntentSubtype.UNCERTAIN && taskType !== 'conversation') {
            confidence *= 0.5; // Reduz ainda mais para incertos (exceto conversação)
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
        const hasObject = /\b(arquivo|file|pasta|folder|diret[óo]rio|arquivos|files|pastas|folders)\b/i.test(input);

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
