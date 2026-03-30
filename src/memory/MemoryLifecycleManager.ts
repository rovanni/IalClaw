import { MemoryService } from './MemoryService';
import { AgentMemoryContext } from './MemoryTypes';
import { createLogger } from '../shared/AppLogger';

export class MemoryLifecycleManager {
    private memoryService: MemoryService;
    private logger = createLogger('MemoryLifecycleManager');

    constructor(memoryService: MemoryService) {
        this.memoryService = memoryService;
    }

    /**
     * Processa uma entrada (usuário ou assistente) para capturar fatos e memórias relevantes.
     */
    public async processInput(input: string, context: AgentMemoryContext): Promise<void> {
        if (!input || input.trim().length < 5) return;

        try {
            // Define o tipo de memória baseado no papel e conteúdo
            let type: any = 'episodic';
            let importance = 0.5;

            if (context.role === 'assistant') {
                type = 'semantic';
            }

            // Se o conteúdo contém informações que parecem de perfil, aumenta importância
            if (this.isProfileRelated(input)) {
                type = 'user_profile';
                importance = 0.8;
            }

            await this.memoryService.upsertMemory({
                content: input.trim(),
                type,
                importance,
                relevance: 0.5,
                entities: this.extractEntities(input),
                context
            });

        } catch (error: any) {
            this.logger.error('process_input_failed', `Erro ao processar input para lifecycle: ${error.message}`);
        }
    }

    private isProfileRelated(text: string): boolean {
        const patterns = [
            /meu nome/i, /me chamo/i, /sou (um|uma)/i,
            /trabalho com/i, /gosto de/i, /prefiro/i,
            /minha profiss[aã]o/i, /moro em/i
        ];
        return patterns.some(p => p.test(text));
    }

    private extractEntities(text: string): string[] {
        // Extração simples de entidades (palavras com iniciais maiúsculas no meio da frase, etc)
        // Por enquanto, retorna vazio para deixar o MemoryService lidar com o que puder
        return [];
    }

    public async storeExplicit(input: string, context: AgentMemoryContext, type: any = 'semantic'): Promise<any> {
        const res = await this.memoryService.upsertMemory({
            content: input.trim(),
            type: type || 'semantic',
            importance: 0.7,
            relevance: 1.0,
            entities: [],
            context
        });
        return {
            stored: true,
            action: res.action,
            memoryId: res.memoryId,
            type: type || 'semantic',
            score: 0.7
        };
    }

    public async queryMemory(query: string, options: { limit: number }): Promise<any[]> {
        // Usa queryMemory do MemoryService diretamente
        return this.memoryService.queryMemory(query, options);
    }
}
