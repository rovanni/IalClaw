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
            /\b(converte|convertei|converter)\b/i,
            /\.md\s+(para|to|into|em)\s+(html|pptx|pdf)/i,
            /\.html\s+(para|to|em)\s+(md|markdown)/i,
            /\.pptx\b/i,
            /\.pdf\b/i,
            /\b(passar para|passar o)\b.*\b(md|html|pptx|pdf)\b/i,
            /\bexportar\b.*\b(md|html|pdf)\b/i,
            /\bmarkdown\b.*\b(pptx|powerpoint|apresentação)\b/i,
            /\bpptx\b/i,
            /\bpowerpoint\b/i,
            /\bapresentação\b.*\b(markdown|md)\b/i,
            /arquivo.*\.md.*pptx/i,
            /\.md\b.*\b(pptx|powerpoint|apresentação)\b/i
        ],
        confidence: 0.90
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
            /\b(executar|rodar|run|execute)\b/i,
            /\b(iniciar|start|stop|parar)\b/i,
            /\brun\b.*\b(npm|yarn|pnpm|python|node)\b/i,
            /\b(instale|instalar)\s+(o|a)?\s*\w+/i,  // "instale o pandoc"
            /\b(apt|apt-get)\s+(install|update|upgrade)/i,  // "apt install"
            /\b(pip|npm|yarn)\s+(install|add)/i,  // "pip install"
            /\b(sudo)\b/i,
            /\b(chmod|chown)\b/i,
            /\b(configure|setup)\b/i,
            /\bsenha\b/i  // "senha" indica comando sudo
        ],
        confidence: 0.90
    },
    {
        type: 'skill_installation',
        patterns: [
            /\b(instalar|instale)\s+(uma\s+)?skill\b/i,  // "instalar skill"
            /\b(install\s+skill|skill\s+install)\b/i,
            /\b(adicione|adicionar)\s+(uma\s+)?skill\b/i,
            /\b(buscar|procurar)\s+(uma\s+)?skill\b/i,
            /\bfind\s+skill\b/i,
            /\b(encontre|busque)\s+(uma\s+)?skill\b/i,
            /\bskill\b.*\b(instalar|instale)\b/i  // "skill para instalar"
        ],
        confidence: 0.95
    }
];

export function classifyTask(text: string): TaskClassification {
    const normalized = text.toLowerCase().trim();
    let bestMatch: TaskClassification = { type: 'unknown', confidence: 0 };

    // VERIFICAÇÕES ESPECIAIS ANTES DOS PADRÕES
    
    // 1. Se menciona "senha" ou "sudo" ou pacotes do sistema, é system_operation
    if (/\b(senha|sudo)\b/.test(normalized) || 
        /\b(apt|apt-get|pip|npm|yarn)\s+(install|add|update)/.test(normalized) ||
        /\b(instale|instalar)\s+(o|a|os|as)\s+\w+/.test(normalized)) {  // "instale o pandoc"
        return { type: 'system_operation', confidence: 0.95 };
    }
    
    // 2. Se menciona "skill" explicitamente, é skill_installation
    if (/\bskill\b/.test(normalized) && /\b(instalar|instale|buscar|procurar|encontre)\b/.test(normalized)) {
        return { type: 'skill_installation', confidence: 0.95 };
    }

    // Verificar se menciona caminho de arquivo específico
    const hasFilePath = /\/[\w\-\.\/]+\.(md|html|pptx|pdf|txt|json)/i.test(text) ||
                         /[\w\-]+\/[\w\-]+\.(md|html|pptx|pdf)/i.test(text);
    
    // Verificar se menciona conversão explicitamente
    const hasConversionWord = /\b(converter|transformar|convert|transform|pptx|powerpoint|apresentação)\b/i.test(text);
    
    // Se tem caminho de arquivo E palavra de conversão, é file_conversion
    if (hasFilePath && hasConversionWord) {
        return { type: 'file_conversion', confidence: 0.95 };
    }
    
    // Se tem caminho de arquivo .md e contexto sugere conversão
    if (hasFilePath && /\.md\b/i.test(text)) {
        return { type: 'file_conversion', confidence: 0.85 };
    }

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
                'verificar formato do arquivo',
                'converter para formato de destino',
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
