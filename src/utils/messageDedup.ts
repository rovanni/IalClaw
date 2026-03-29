/**
 * Message Deduplication Utility
 * 
 * Previne processamento duplicado de mensagens do Telegram.
 * O Telegram pode reenviar mensagens devido a timeouts de rede,
 * e isso garante idempotência no processamento.
 */

const processedMessages = new Map<number, number>(); // message_id -> timestamp
const MESSAGE_DEDUP_TTL_MS = 60000; // 1 minuto
const MAX_CACHE_SIZE = 1000;

export function isDuplicateMessage(messageId: number | undefined): boolean {
    if (!messageId) return false;
    
    const now = Date.now();
    const lastProcessed = processedMessages.get(messageId);
    
    // Se a mensagem foi processada nos últimos 60 segundos, é duplicada
    if (lastProcessed && (now - lastProcessed) < MESSAGE_DEDUP_TTL_MS) {
        return true;
    }
    
    processedMessages.set(messageId, now);
    
    // Limpa mensagens antigas quando o cache cresce demais
    if (processedMessages.size > MAX_CACHE_SIZE) {
        for (const [id, timestamp] of processedMessages) {
            if ((now - timestamp) > MESSAGE_DEDUP_TTL_MS) {
                processedMessages.delete(id);
            }
        }
    }
    
    return false;
}

export function clearDedupCache(): void {
    processedMessages.clear();
}