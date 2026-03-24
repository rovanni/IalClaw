import { Context } from 'grammy';
import { AgentLoop } from '../engine/AgentLoop';
import { PolicyEngine } from '../engine/PolicyEngine';
import { CognitiveMemory } from '../memory/CognitiveMemory';
import { ContextBuilder } from '../memory/ContextBuilder';
import { TelegramInputHandler, CognitiveInputPayload } from '../telegram/TelegramInputHandler';
import { TelegramOutputHandler } from '../telegram/TelegramOutputHandler';
import { MessagePayload } from '../engine/ProviderFactory';
import { AgentGateway } from '../engine/AgentGateway';

export class AgentController {
    private memory: CognitiveMemory;
    private contextBuilder: ContextBuilder;
    private loop: AgentLoop;
    private inputHandler: TelegramInputHandler;
    private outputHandler: TelegramOutputHandler;

    constructor(
        memory: CognitiveMemory,
        contextBuilder: ContextBuilder,
        loop: AgentLoop,
        inputHandler: TelegramInputHandler,
        outputHandler: TelegramOutputHandler
    ) {
        this.memory = memory;
        this.contextBuilder = contextBuilder;
        this.loop = loop;
        this.inputHandler = inputHandler;
        this.outputHandler = outputHandler;
    }

    public async handleMessage(ctx: Context) {
        try {
            const payload: CognitiveInputPayload | null = await this.inputHandler.processUpdate(ctx);
            if (!payload) return;

            const conversationId = ctx.chat?.id.toString();
            if (!conversationId) return;

            const userQuery = payload.text;

            // Generate Intention Embedding ONCE
            const provider = this.loop.getProvider();
            const queryEmbedding = await provider.embed(userQuery);

            // 1. Gateway Routing
            const gateway = new AgentGateway(this.memory, provider);
            const agentId = await gateway.selectAgent(userQuery, queryEmbedding);

            // 2. Memory & Identity Fetching
            const memory = await this.memory.retrieveWithTraversal(userQuery, queryEmbedding);
            const identity = await this.memory.getIdentityNodes(agentId);

            const policyEngine = new PolicyEngine();
            const policy = policyEngine.resolvePolicy(identity);

            // 2. Build Context
            const contextStr = this.contextBuilder.build({ identity, memory, policy });

            // 3. Prepare Loop messages
            const history = this.memory.getConversationHistory(conversationId, 10);
            const messages: MessagePayload[] = [];

            messages.push({
                role: 'system',
                content: `Você é o IalClaw, um agente cognitivo 100% local.
Use o contexto abaixo processado usando RAG via Grafo para embasar sua resposta.
NÃO alucine fatos.\n\n${contextStr}`
            });

            for (const msg of history) {
                if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool') {
                    messages.push({ role: msg.role, content: msg.content });
                }
            }

            messages.push({ role: 'user', content: userQuery });
            this.memory.saveMessage(conversationId, 'user', userQuery);

            // 4. Run AgentLoop
            const result = await this.loop.run(messages, policy);

            // Persist newly generated messages
            for (const nm of result.newMessages) {
                this.memory.saveMessage(
                    conversationId,
                    nm.role,
                    nm.content,
                    nm.tool_name,
                    nm.tool_args ? JSON.stringify(nm.tool_args) : undefined
                );
            }

            // 5. Memory Learn (Agora Async devido aos embeddings)
            await this.memory.learn({
                query: userQuery,
                nodes_used: memory,
                success: true,
                response: result.answer
            });

            // 6. Output
            await this.outputHandler.sendResponse(ctx, result.answer, payload.requires_audio_reply);

        } catch (e: any) {
            console.error("[AgentController] Error executing flow:", e);
            ctx.reply(`⚠️ Ocorreu um erro no pipeline cognitivo:\n${e.message}`);
        }
    }

    public async handleWebMessage(sessionId: string, userQuery: string): Promise<string> {
        try {
            const provider = this.loop.getProvider();
            const queryEmbedding = await provider.embed(userQuery);

            const gateway = new AgentGateway(this.memory, provider);
            const agentId = await gateway.selectAgent(userQuery, queryEmbedding);

            const memory = await this.memory.retrieveWithTraversal(userQuery, queryEmbedding);
            const identity = await this.memory.getIdentityNodes(agentId);

            const policyEngine = new PolicyEngine();
            const policy = policyEngine.resolvePolicy(identity);

            const contextStr = this.contextBuilder.build({ identity, memory, policy });

            const history = this.memory.getConversationHistory(sessionId, 10);
            const messages: MessagePayload[] = [];

            messages.push({
                role: 'system',
                content: `Você é o IalClaw, um agente cognitivo 100% local.
Use o contexto abaixo processado usando RAG via Grafo para embasar sua resposta.
NÃO alucine fatos.\n\n${contextStr}`
            });

            for (const msg of history) {
                if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool') {
                    messages.push({ role: msg.role, content: msg.content });
                }
            }

            messages.push({ role: 'user', content: userQuery });
            this.memory.saveMessage(sessionId, 'user', userQuery);

            const result = await this.loop.run(messages, policy);

            for (const nm of result.newMessages) {
                this.memory.saveMessage(
                    sessionId,
                    nm.role,
                    nm.content,
                    nm.tool_name,
                    nm.tool_args ? JSON.stringify(nm.tool_args) : undefined
                );
            }

            await this.memory.learn({
                query: userQuery,
                nodes_used: memory,
                success: true,
                response: result.answer
            });

            return result.answer;

        } catch (e: any) {
            console.error("[AgentController] Error executing web flow:", e);
            throw e;
        }
    }
}
