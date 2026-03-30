import { TaskType } from '../agent/TaskClassifier';
import { createLogger } from '../../shared/AppLogger';

export enum ExecutionRoute {
    DIRECT_LLM = 'direct_llm',
    TOOL_LOOP = 'tool_loop'
}

export enum IntentSubtype {
    COMMAND = 'command',       // "mova os arquivos"
    SUGGESTION = 'suggestion', // "acho que deveria mover"
    DOUBT = 'doubt'            // "por que os arquivos estão aí?"
}

export interface RouteDecision {
    route: ExecutionRoute;
    subtype: IntentSubtype;
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
        DOUBT: /\?|^(por que|como|onde|qual|quais|when|why|where|how)\b/i
    };

    /**
     * Decide a rota de execução para uma tarefa.
     */
    public decideRoute(input: string, taskType: TaskType | null): RouteDecision {
        const normalizedInput = input.toLowerCase();

        // 1. Detectar Subtipo
        const subtype = this.detectSubtype(normalizedInput);

        // 2. Verificar Agibilidade (Actionability)
        const requiresTool = this.requiresToolExecution(normalizedInput);

        // 3. Rota Inicial
        let route = ExecutionRoute.TOOL_LOOP;
        let confidence = requiresTool ? 0.99 : 0.50;

        if (!requiresTool && (taskType === 'content_generation' || taskType === 'information_request')) {
            route = ExecutionRoute.DIRECT_LLM;
            confidence = 0.90;
        }

        // 4. Ajustar confiança baseada no subtipo
        if (subtype === IntentSubtype.SUGGESTION) {
            confidence *= 0.8; // Reduz confiança para sugestões
        } else if (subtype === IntentSubtype.DOUBT) {
            confidence *= 0.6; // Reduz confiança para dúvidas
        }

        const decision: RouteDecision = { route, subtype, confidence };

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
        return IntentSubtype.COMMAND;
    }

    /**
     * Detecta se o input exige ação no mundo real (uso de tools).
     */
    private requiresToolExecution(input: string): boolean {
        // Verificar padrões regex (mais forte)
        if (this.ACTION_PATTERNS.some(pattern => pattern.test(input))) {
            return true;
        }

        // Verificar keywords (heurística simples)
        // Só conta como ação se houver um verbo de ação claro
        const tokens = input.split(/\s+/);
        const actionScore = tokens.filter(token => this.ACTION_KEYWORDS.includes(token)).length;

        // Se tiver 2 ou mais termos de ação, é altamente provável que precise de tools
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
