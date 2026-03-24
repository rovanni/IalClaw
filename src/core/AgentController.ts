import { Context } from 'grammy';
import { AgentLoop } from '../engine/AgentLoop';
import { PolicyEngine } from '../engine/PolicyEngine';
import { CognitiveMemory } from '../memory/CognitiveMemory';
import { ContextBuilder } from '../memory/ContextBuilder';
import { TelegramInputHandler, CognitiveInputPayload } from '../telegram/TelegramInputHandler';
import { TelegramOutputHandler } from '../telegram/TelegramOutputHandler';
import { MessagePayload } from '../engine/ProviderFactory';
import { AgentGateway } from '../engine/AgentGateway';
import { SessionManager } from '../shared/SessionManager';
import { AgentRuntime } from './AgentRuntime';

export class AgentController {
    private memory: CognitiveMemory;
    private contextBuilder: ContextBuilder;
    private loop: AgentLoop;
    private runtime: AgentRuntime;
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
        this.runtime = new AgentRuntime(memory);
        this.inputHandler = inputHandler;
        this.outputHandler = outputHandler;
    }

    public async handleMessage(ctx: Context) {
        const payload: CognitiveInputPayload | null = await this.inputHandler.processUpdate(ctx);
        if (!payload) return;

        const conversationId = ctx.chat?.id.toString();
        if (!conversationId) return;

        return SessionManager.runWithSession(conversationId, async () => {
            try {
                const answer = await this.runConversation(conversationId, payload.text);
                await this.outputHandler.sendResponse(ctx, answer, payload.requires_audio_reply);
            } catch (e: any) {
                console.error('[AgentController] Error executing flow:', e);
                ctx.reply(`Ocorreu um erro no pipeline cognitivo:\n${e.message}`);
            }
        });
    }

    public async handleWebMessage(sessionId: string, userQuery: string): Promise<string> {
        return SessionManager.runWithSession(sessionId, async () => {
            try {
                return await this.runConversation(sessionId, userQuery);
            } catch (e: any) {
                console.error('[AgentController] Error executing web flow:', e);
                throw e;
            }
        });
    }

    private async runConversation(sessionId: string, userQuery: string): Promise<string> {
        const session = SessionManager.getCurrentSession();
        this.memory.saveMessage(sessionId, 'user', userQuery);

        const sessionDirectiveReply = this.handleSessionDirective(userQuery, session);
        if (sessionDirectiveReply) {
            this.memory.saveMessage(sessionId, 'assistant', sessionDirectiveReply);
            return sessionDirectiveReply;
        }

        if (this.shouldUsePlannerRuntime(userQuery, session?.current_project_id)) {
            const answer = await this.runtime.execute(userQuery, 'planner');

            this.memory.saveMessage(sessionId, 'assistant', answer);
            await this.memory.learn({
                query: userQuery,
                nodes_used: [],
                success: !answer.startsWith('Falha'),
                response: answer
            });

            return answer;
        }

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
        const messages: MessagePayload[] = [
            {
                role: 'system',
                content: `Voce e o IalClaw, um agente cognitivo 100% local.
Use o contexto abaixo processado usando RAG via Grafo para embasar sua resposta.
Nao alucine fatos.\n\n${contextStr}`
            }
        ];

        for (const msg of history) {
            if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool') {
                messages.push({ role: msg.role, content: msg.content });
            }
        }

        messages.push({ role: 'user', content: userQuery });

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
    }

    private shouldUsePlannerRuntime(userQuery: string, currentProjectId?: string): boolean {
        if (currentProjectId) {
            return /\b(criar|crie|gere|gerar|montar|monte|projeto|workspace|arquivo|arquivos|html|css|javascript|site|pagina|frontend|continuar|continue|ajuste|corrija|corrigir|adicione|instale|instalar)\b/i.test(userQuery);
        }

        return /\b(criar|crie|gere|gerar|montar|monte|projeto|workspace|arquivo|arquivos|html|css|javascript|site|pagina|frontend)\b/i.test(userQuery);
    }

    private handleSessionDirective(userQuery: string, session?: ReturnType<typeof SessionManager.getCurrentSession>): string | null {
        const normalized = userQuery.toLowerCase().trim();

        if (this.isPuppeteerInstallAuthorization(normalized)) {
            return `Recebi sua autorização para instalar o puppeteer.

No runtime atual do dashboard, a instalação automática ainda não está conectada ao sistema de execução do agente, então esse pedido não será enviado ao planner nem ao executor por engano.

Enquanto isso, vou continuar tratando o projeto atual como continuidade da mesma sessão.`;
        }

        if (this.isContinueProjectDirective(normalized) && session?.current_project_id) {
            session.continue_project_only = true;
            session.last_error = undefined;
            session.last_error_type = undefined;
            session.last_error_hash = undefined;
            session.last_error_fingerprint = undefined;
            session._tool_input_attempts = 0;
            session._input_history = [];

            return `Vou continuar apenas o projeto atual desta sessão (${session.current_project_id}) e não vou criar um projeto novo.`;
        }

        return null;
    }

    private isPuppeteerInstallAuthorization(normalizedQuery: string): boolean {
        return /\b(pode instalar|pode tentar instalar|autorizo instalar|autorizo tentar instalar|instale o puppeteer|instalar o puppeteer)\b/.test(normalizedQuery)
            && normalizedQuery.includes('puppeteer');
    }

    private isContinueProjectDirective(normalizedQuery: string): boolean {
        return /\b(s[oó] continue|continuar|continue o projeto|continue os projetos|nao recrie|não recrie|nao crie novo projeto|não crie novo projeto)\b/.test(normalizedQuery);
    }
}
