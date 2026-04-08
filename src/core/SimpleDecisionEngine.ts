/**
 * SimpleDecisionEngine — Motor de decisão simplificado do IalClaw
 * 
 * Princípio: O LLM decide. O sistema executa. Apenas protege contra destruição.
 * 
 * 3 categorias:
 * - EXECUTE: Usuário pediu algo → usa tools
 * - DIRECT_REPLY: Pergunta ou conversa → LLM responde direto
 * - CONFIRM: Ação destrutiva → pede confirmação
 */

import { createLogger } from '../shared/AppLogger';
import { t } from '../i18n';

const logger = createLogger('SimpleDecisionEngine');

export type SimpleDecision = 'EXECUTE' | 'DIRECT_REPLY' | 'CONFIRM';

export interface SimpleDecisionResult {
    decision: SimpleDecision;
    reason: string;
    taskType: string;
    confidence: number;
    context?: {
        isContinuation: boolean;
        lastTask?: string;
        hasToolKeywords: boolean;
        isDestructive: boolean;
    };
}

/**
 * Palavras que indicam pedido de ação (EXECUTE)
 */
const ACTION_KEYWORDS = [
    // Criação/Geração
    'criar', 'create', 'cria', 'gerar', 'generate', 'gera', 'escrever', 'escreve',
    'salvar', 'save', 'salva', 'fazer', 'faça', 'faca', 'montar', 'monte',
    
    // Instalação/Configuração
    'instalar', 'install', 'instale', 'add', 'adicionar', 'configure', 'configurar',
    'setup', 'configura',
    
    // Envio/Comunicação
    'enviar', 'send', 'manda', 'mande', 'envia', 'mensagem', 'notificar',
    
    // Áudio/Voz
    'áudio', 'audio', 'voz', 'voice', 'tts', 'ogg', 'mp3', 'falar', 'ouvir',
    
    // Busca/Pesquisa
    'buscar', 'search', 'procurar', 'pesquisar', 'pesquise', 'encontrar',
    
    // Manipulação de Arquivos
    'mover', 'move', 'mova', 'copiar', 'copia', 'deletar', 'delete', 'remove',
    'renomear', 'rename', 'listar', 'list', 'converter', 'convert',
    
    // Execução
    'executar', 'run', 'rodar', 'aplicar', 'apply', 'abrir', 'open',
    
    // Download/Upload
    'baixar', 'download', 'upload', 'carregar',
    
    // Análise/Dados
    'analisar', 'análise', 'analisar', 'calcular', 'calcule', 'comparar',
    
    // Web/Automação
    'navegar', 'browser', 'automatizar', 'script',
];

/**
 * Palavras que indicam pergunta (DIRECT_REPLY)
 */
const QUESTION_KEYWORDS = [
    'o que é', 'o que e', 'oque é', 'oque e', 'oq é', 'oq e',
    'como funciona', 'como faz', 'por que', 'porque', 'qual o',
    'quem é', 'quem e', 'onde fica', 'quando', 'quanto',
    'o que significa', 'o que quer dizer', 'explique', 'defina',
    'diferença entre', 'diferenca entre', 'para que serve',
    'posso saber', 'me explica', 'me ensina',
];

/**
 * Ações destrutivas que requerem confirmação (CONFIRM)
 */
const DESTRUCTIVE_KEYWORDS = [
    'rm -rf', 'rm -r', 'del /', 'format', 'formatar', 'drop database',
    'drop table', 'delete all', 'truncate', 'sudo rm', 'mkfs',
    'dd if=', ':(){:|:&};:', 'chmod -R 777',
];

/**
 * Palavras que indicam continuação de conversa
 */
const CONTINUATION_KEYWORDS = [
    'isso', 'isso mesmo', 'exato', 'sim', 'claro', 'pode',
    'continue', 'continua', 'prosseguir', 'prosseguir',
    'faça isso', 'faca isso', 'mande', 'envia', 'ok', 'okay',
    'e dai', 'e então', 'e depois', 'conseguiu', 'deu certo',
    '1', '2', '3', // respostas numéricas a opções
];

export class SimpleDecisionEngine {
    
    /**
     * Classifica o input do usuário em 3 categorias simples.
     * O LLM decide o que fazer. O sistema apenas protege contra destruição.
     */
    classify(input: string, lastTask?: string): SimpleDecisionResult {
        const normalized = input.toLowerCase().trim();
        
        // 1. Verificar se é continuação de conversa
        const isContinuation = this.isContinuation(normalized, lastTask);
        
        // 2. Verificar se é ação destrutiva (CONFIRM)
        const isDestructive = this.isDestructive(normalized);
        if (isDestructive) {
            logger.info('decision_destructive', '[SIMPLE] Ação destrutiva detectada → CONFIRM', {
                input: normalized.slice(0, 50),
                lastTask
            });
            return {
                decision: 'CONFIRM',
                reason: 'destructive_action',
                taskType: 'system_operation',
                confidence: 0.99,
                context: {
                    isContinuation,
                    lastTask,
                    hasToolKeywords: true,
                    isDestructive: true
                }
            };
        }
        
        // 3. Verificar se é pedido de ação (EXECUTE)
        const hasToolKeywords = this.hasActionKeywords(normalized);
        
        if (hasToolKeywords) {
            logger.info('decision_execute', '[SIMPLE] Pedido de ação detectado → EXECUTE', {
                input: normalized.slice(0, 50),
                taskType: this.inferTaskType(normalized)
            });
            return {
                decision: 'EXECUTE',
                reason: 'action_request',
                taskType: this.inferTaskType(normalized),
                confidence: 0.9,
                context: {
                    isContinuation,
                    lastTask,
                    hasToolKeywords: true,
                    isDestructive: false
                }
            };
        }
        
        // 4. Se é continuação de tarefa anterior → EXECUTE
        if (isContinuation && lastTask) {
            logger.info('decision_continuation', '[SIMPLE] Continuação de tarefa → EXECUTE', {
                input: normalized.slice(0, 50),
                lastTask
            });
            return {
                decision: 'EXECUTE',
                reason: 'continuation',
                taskType: lastTask,
                confidence: 0.85,
                context: {
                    isContinuation: true,
                    lastTask,
                    hasToolKeywords: false,
                    isDestructive: false
                }
            };
        }
        
        // 5. Verificar se é pergunta (DIRECT_REPLY)
        const isQuestion = this.isQuestion(normalized);
        if (isQuestion) {
            logger.info('decision_question', '[SIMPLE] Pergunta detectada → DIRECT_REPLY', {
                input: normalized.slice(0, 50)
            });
            return {
                decision: 'DIRECT_REPLY',
                reason: 'question',
                taskType: 'information_request',
                confidence: 0.9,
                context: {
                    isContinuation,
                    lastTask,
                    hasToolKeywords: false,
                    isDestructive: false
                }
            };
        }
        
        // 6. Verificar se é small talk (DIRECT_REPLY)
        const isSmallTalk = this.isSmallTalk(normalized);
        if (isSmallTalk) {
            logger.info('decision_small_talk', '[SIMPLE] Small talk detectado → DIRECT_REPLY', {
                input: normalized.slice(0, 50)
            });
            return {
                decision: 'DIRECT_REPLY',
                reason: 'small_talk',
                taskType: 'conversation',
                confidence: 0.95,
                context: {
                    isContinuation: false,
                    lastTask,
                    hasToolKeywords: false,
                    isDestructive: false
                }
            };
        }
        
        // 7. Default: se tem contexto de tarefa anterior, continuar (EXECUTE)
        // Se não, DIRECT_REPLY (deixa o LLM decidir)
        if (lastTask) {
            return {
                decision: 'EXECUTE',
                reason: 'context_continuation',
                taskType: lastTask,
                confidence: 0.7,
                context: {
                    isContinuation: true,
                    lastTask,
                    hasToolKeywords: false,
                    isDestructive: false
                }
            };
        }
        
        // 8. Fallback: LLM decide
        logger.info('decision_fallback', '[SIMPLE] Fallback → DIRECT_REPLY (LLM decide)', {
            input: normalized.slice(0, 50)
        });
        return {
            decision: 'DIRECT_REPLY',
            reason: 'fallback',
            taskType: 'conversation',
            confidence: 0.5,
            context: {
                isContinuation: false,
                lastTask,
                hasToolKeywords: false,
                isDestructive: false
            }
        };
    }
    
    private hasActionKeywords(input: string): boolean {
        return ACTION_KEYWORDS.some(kw => input.includes(kw));
    }
    
    private isDestructive(input: string): boolean {
        return DESTRUCTIVE_KEYWORDS.some(kw => input.includes(kw));
    }
    
    private isQuestion(input: string): boolean {
        if (input.includes('?')) return true;
        return QUESTION_KEYWORDS.some(kw => input.includes(kw));
    }
    
    private isSmallTalk(input: string): boolean {
        if (input.length <= 15 && /^(oi+|ol[aá]+|opa+|eai+|e aí|fala+|salve+|bom dia|boa tarde|boa noite|tudo bem|td bem|blz+|beleza+|tranquilo|obrigado|obg+|valeu+|kk+|haha+|rs+|👋|😊|😁|😄|😆|🙂|😀|🤝)\s*[!.?]*$/i.test(input)) {
            return true;
        }
        return false;
    }
    
    private isContinuation(input: string, lastTask?: string): boolean {
        if (!lastTask) return false;
        return CONTINUATION_KEYWORDS.some(kw => input.includes(kw));
    }
    
    private inferTaskType(input: string): string {
        if (/\b(instalar|install|pip|npm|apt|brew)\b/i.test(input)) return 'system_operation';
        if (/\b(áudio|audio|voz|voice|tts|ogg|mp3|falar|ouvir)\b/i.test(input)) return 'system_operation';
        if (/\b(enviar|manda|mande|envia|mensagem|notificar|telegram)\b/i.test(input)) return 'system_operation';
        if (/\b(criar|create|gerar|gera|escrever|escreve|fazer|faça|faca|montar)\b/i.test(input)) return 'content_generation';
        if (/\b(buscar|search|procurar|pesquisar|pesquise|encontrar)\b/i.test(input)) return 'information_request';
        if (/\b(analisar|análise|analisar|calcular|calcule|comparar)\b/i.test(input)) return 'data_analysis';
        return 'system_operation'; // default para actions
    }
}