// ── Task Classifier ───────────────────────────────────────────────────────
// Classifica o tipo de tarefa ANTES do AgentLoop para gerar plano correto.

export type TaskType = 
    | 'file_conversion' 
    | 'file_search' 
    | 'content_generation' 
    | 'system_operation' 
    | 'skill_installation'
    | 'generic_task'
    | 'unknown';

export interface TaskClassification {
    type: TaskType;
    confidence: number;
}

interface TaskRule {
    type: TaskType;
    patterns: RegExp[];
    confidence: number;
}

const TASK_RULES: TaskRule[] = [
    {
        type: 'file_conversion',
        patterns: [
            /\b(converter|transformar|convert|transform)\b/i,
            /\.md\s+(para|to|into)\s+(html|pptx|pdf)/i,
            /\.html\s+(para|to)\s+(md|markdown)/i,
            /\.pptx\b/i,
            /\.pdf\s+(para|to)/i,
            /\b(passar para|passar o)\b.*\b(md|html|pptx)\b/i,
            /\bexportar\b.*\b(md|html|pdf)\b/i
        ],
        confidence: 0.85
    },
    {
        type: 'file_search',
        patterns: [
            /\b(procurar|buscar|encontrar)\b.*\b(arquivo|file)\b/i,
            /\b(onde|qual)\b.*\b(arquivo|arquivos)\b/i,
            /\b(localizar|localiza)\b/i,
            /\blista\b.*\b(arquivos|files)\b/i,
            /\bprocure\b/i,
            /\bencontre\b/i,
            /\bsearch\b.*\bfile\b/i,
            /\bfind\b.*\b(file|directory)\b/i
        ],
        confidence: 0.8
    },
    {
        type: 'content_generation',
        patterns: [
            /\b(criar|gerar|escrever|criar novo)\b/i,
            /\b(generate|create|write)\b/i,
            /\bfazer um\b.*\b(texto|artigo|post|email)\b/i,
            /\b(redigir|elaborar|produzir)\b/i,
            /\bme ajude a\b.*\b(escrever|criar)\b/i
        ],
        confidence: 0.75
    },
    {
        type: 'system_operation',
        patterns: [
            /\b(executar|rodar|instalar|run|install|execute)\b/i,
            /\b(iniciar|start|stop|parar)\b/i,
            /\brun\b.*\b(npm|yarn|pnpm|python|node)\b/i,
            /\binstall\b.*\b(npm|yarn|pnpm|pip)\b/i,
            /\bapt\b/i,
            /\b(sudo|chmod|chown)\b/i
        ],
        confidence: 0.8
    },
    {
        type: 'skill_installation',
        patterns: [
            /\b(instalar|instale|instalacao|instalação|instalar uma|instalar uma skill)\b/i,
            /\b(install\s+skill|skill\s+install|instalar skill)\b/i,
            /\b(adicione|adicionar)\s+(?:uma\s+)?skill\b/i,
            /\b(buscar|procurar)\s+(?:uma\s+)?skill\b/i,
            /\bfind\s+skill\b/i,
            /\b(encontre|busque)\s+(?:uma\s+)?skill\b/i
        ],
        confidence: 0.9
    }
];

export function classifyTask(text: string): TaskClassification {
    const normalized = text.toLowerCase().trim();
    let bestMatch: TaskClassification = { type: 'unknown', confidence: 0 };

    for (const rule of TASK_RULES) {
        let ruleConfidence = 0;
        
        for (const pattern of rule.patterns) {
            if (pattern.test(normalized)) {
                ruleConfidence = Math.max(ruleConfidence, rule.confidence);
            }
        }

        if (ruleConfidence > bestMatch.confidence) {
            bestMatch = { type: rule.type, confidence: ruleConfidence };
        }
    }

    if (bestMatch.type === 'unknown' || bestMatch.confidence === 0) {
        bestMatch = { type: 'generic_task', confidence: 0.6 };
    }

    const logMsg = `[CLASSIFIER] type=${bestMatch.type} confidence=${bestMatch.confidence.toFixed(2)}`;
    console.log(logMsg);

    return bestMatch;
}

export function getForcedPlanForTaskType(type: TaskType): string[] | null {
    switch (type) {
        case 'file_conversion':
            return [
                'localizar arquivo de origem',
                'ler conteúdo do arquivo',
                'converter conteúdo',
                'salvar resultado'
            ];
        case 'file_search':
            return [
                'determinar localização de busca',
                'buscar arquivo',
                'retornar resultado'
            ];
        case 'content_generation':
            return [
                'definir estrutura do conteúdo',
                'gerar conteúdo',
                'salvar conteúdo'
            ];
        case 'system_operation':
            return [
                'verificar pré-requisitos',
                'executar operação',
                'verificar resultado'
            ];
        case 'skill_installation':
            return [
                'identificar nome da skill',
                'verificar se já está instalada',
                'buscar skill no repositório público',
                'instalar skill',
                'verificar instalação'
            ];
        case 'generic_task':
            return [
                'analisar entrada',
                'executar ação',
                'retornar resultado'
            ];
        default:
            return null;
    }
}
