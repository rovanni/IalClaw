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
import { skillManager } from '../capabilities';
import { workspaceService } from '../services/WorkspaceService';
import { SkillResolver } from '../skills/SkillResolver';
import { LoadedSkill } from '../skills/types';
import { runWithTrace } from '../shared/TraceContext';
import { createLogger } from '../shared/AppLogger';
import { emitDebug } from '../shared/DebugBus';
import { agentConfig } from './executor/AgentConfig';

export class AgentController {
    private memory: CognitiveMemory;
    private contextBuilder: ContextBuilder;
    private loop: AgentLoop;
    private runtime: AgentRuntime;
    private inputHandler: TelegramInputHandler;
    private outputHandler: TelegramOutputHandler;
    private skillResolver?: SkillResolver;
    private logger = createLogger('AgentController');

    constructor(
        memory: CognitiveMemory,
        contextBuilder: ContextBuilder,
        loop: AgentLoop,
        inputHandler: TelegramInputHandler,
        outputHandler: TelegramOutputHandler,
        skillResolver?: SkillResolver
    ) {
        this.memory = memory;
        this.contextBuilder = contextBuilder;
        this.loop = loop;
        this.runtime = new AgentRuntime(memory);
        this.inputHandler = inputHandler;
        this.outputHandler = outputHandler;
        this.skillResolver = skillResolver;
    }

    public async handleMessage(ctx: Context) {
        const conversationId = ctx.chat?.id.toString();
        if (!conversationId) return;

        return runWithTrace(async () => {
            const startedAt = Date.now();
            const logger = this.logger.child({ conversation_id: conversationId, channel: 'telegram' });
            logger.info('message_flow_started', 'Iniciando processamento de mensagem do Telegram.', {
                telegram_user_id: ctx.from?.id,
                update_id: ctx.update.update_id
            });

            const payload: CognitiveInputPayload | null = await this.inputHandler.processUpdate(ctx);
            if (!payload) {
                logger.warn('message_ignored', 'Mensagem ignorada antes do pipeline cognitivo.', {
                    duration_ms: Date.now() - startedAt
                });
                return;
            }

            return SessionManager.runWithSession(conversationId, async () => {
                try {
                    const answer = await this.runConversation(conversationId, payload.text);
                    await this.outputHandler.sendResponse(ctx, answer, payload.requires_audio_reply);
                    logger.info('message_flow_completed', 'Resposta enviada ao Telegram com sucesso.', {
                        duration_ms: Date.now() - startedAt,
                        response_length: answer.length,
                        requires_audio_reply: payload.requires_audio_reply
                    });
                } catch (error: any) {
                    logger.error('message_flow_failed', error, 'Falha ao processar mensagem do Telegram.', {
                        duration_ms: Date.now() - startedAt,
                        source_type: payload.source_type
                    });
                    await ctx.reply(`Ocorreu um erro no pipeline cognitivo:\n${error.message}`);
                }
            });
        }, 'telegram_controller');
    }

    public async handleWebMessage(sessionId: string, userQuery: string): Promise<string> {
        return runWithTrace(async () => {
            const startedAt = Date.now();
            const logger = this.logger.child({ conversation_id: sessionId, channel: 'web' });
            logger.info('web_flow_started', 'Iniciando processamento da mensagem web.', {
                query_length: userQuery.length
            });

            return SessionManager.runWithSession(sessionId, async () => {
                try {
                    const answer = await this.runConversation(sessionId, userQuery);
                    logger.info('web_flow_completed', 'Mensagem web processada com sucesso.', {
                        duration_ms: Date.now() - startedAt,
                        response_length: answer.length
                    });
                    return answer;
                } catch (error: any) {
                    logger.error('web_flow_failed', error, 'Falha ao processar mensagem web.', {
                        duration_ms: Date.now() - startedAt
                    });
                    throw error;
                }
            });
        }, 'web_controller');
    }

    private async runConversation(sessionId: string, userQuery: string): Promise<string> {
        const startedAt = Date.now();
        const logger = this.logger.child({ conversation_id: sessionId });
        const session = SessionManager.getCurrentSession();
        this.memory.saveMessage(sessionId, 'user', userQuery);
        logger.info('conversation_started', 'Processando nova interacao do usuario.', {
            cognitive_stage: 'start',
            summary: 'MESSAGE_RECEIVED',
            route: 'conversation',
            query_length: userQuery.length,
            has_current_project: Boolean(session?.current_project_id)
        });

        // ── Resolução de skill ──────────────────────────────────────────────
        if (this.skillResolver) {
            const resolved = this.skillResolver.resolve(userQuery);
            if (resolved) {
                logger.info('skill_resolved', 'Mensagem roteada para uma skill dedicada.', {
                    skill_name: resolved.skill.name
                });
                return this.runWithSkill(sessionId, userQuery, resolved.query, resolved.skill);
            }
        }

        const sessionDirectiveReply = await this.handleSessionDirective(userQuery, session);
        if (sessionDirectiveReply) {
            this.memory.saveMessage(sessionId, 'assistant', sessionDirectiveReply);
            logger.info('session_directive_handled', 'Diretiva de sessao processada sem acionar o pipeline principal.', {
                duration_ms: Date.now() - startedAt
            });
            return sessionDirectiveReply;
        }

        if (agentConfig.isSafeModeEnabled()) {
            logger.info('safe_mode_selected', 'Safe mode ativo. Ignorando planner e AgentLoop para garantir resposta direta.', {
                cognitive_stage: 'decision',
                decision: 'SAFE_MODE',
                mode: 'DIRECT_ONLY',
                current_project_id: session?.current_project_id
            });

            const answer = await this.runtime.execute(userQuery, 'planner');
            const success = !answer.startsWith('Falha');

            SessionManager.addToHistory(sessionId, 'user', userQuery);
            SessionManager.addToHistory(sessionId, 'assistant', answer);
            this.memory.saveMessage(sessionId, 'assistant', answer);
            await this.memory.learn({
                query: userQuery,
                nodes_used: [],
                success,
                response: answer
            });

            logger.info('safe_mode_completed', 'Resposta direta concluida em safe mode.', {
                cognitive_stage: 'result',
                result: success ? 'SUCCESS' : 'FAILED',
                duration_ms: Date.now() - startedAt,
                success
            });

            this.logExecutionSummary(logger, {
                decision: 'DIRECT_EXECUTION',
                mode: 'SAFE_MODE',
                success,
                durationMs: Date.now() - startedAt,
                responseLength: answer.length
            });

            return answer;
        }

        if (this.shouldUsePlannerRuntime(userQuery, session?.current_project_id)) {
            logger.info('planner_runtime_selected', 'Roteando consulta para o runtime de planejamento.', {
                cognitive_stage: 'decision',
                decision: 'PLANNER_RUNTIME',
                mode: 'PLANNED',
                current_project_id: session?.current_project_id
            });
            const answer = await this.runtime.execute(userQuery, 'planner');
            const success = !answer.startsWith('Falha');

            SessionManager.addToHistory(sessionId, 'user', userQuery);
            SessionManager.addToHistory(sessionId, 'assistant', answer);
            this.memory.saveMessage(sessionId, 'assistant', answer);
            await this.memory.learn({
                query: userQuery,
                nodes_used: [],
                success,
                response: answer
            });

            logger.info('planner_runtime_completed', 'Execucao do runtime de planejamento concluida.', {
                cognitive_stage: 'result',
                result: success ? 'SUCCESS' : 'FAILED',
                duration_ms: Date.now() - startedAt,
                success
            });

            this.logExecutionSummary(logger, {
                decision: 'PLANNER_RUNTIME',
                mode: 'PLANNED',
                success,
                durationMs: Date.now() - startedAt,
                responseLength: answer.length
            });

            return answer;
        }

        const provider = this.loop.getProvider();
        logger.debug('embedding_query_started', 'Gerando embedding para a consulta do usuario.');
        const queryEmbedding = await provider.embed(userQuery);
        logger.debug('embedding_query_completed', 'Embedding da consulta processado.', {
            embedding_dimensions: queryEmbedding.length
        });

        const gateway = new AgentGateway(this.memory, provider);
        const agentId = await gateway.selectAgent(userQuery, queryEmbedding);
        logger.info('agent_selected', 'Agente de identidade selecionado para a conversa.', {
            agent_id: agentId
        });

        const memory = await this.memory.retrieveWithTraversal(userQuery, queryEmbedding);
        const identity = await this.memory.getIdentityNodes(agentId);
        logger.info('memory_context_built', 'Contexto de memoria recuperado para a resposta.', {
            retrieved_memory_nodes: memory.length,
            identity_nodes: identity.length
        });

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

        for (const message of history) {
            if (message.role === 'user' || message.role === 'assistant' || message.role === 'tool') {
                messages.push({ role: message.role, content: message.content });
            }
        }

        messages.push({ role: 'user', content: userQuery });

        const result = await this.loop.run(messages, policy);

        for (const newMessage of result.newMessages) {
            this.memory.saveMessage(
                sessionId,
                newMessage.role,
                newMessage.content,
                newMessage.tool_name,
                newMessage.tool_args ? JSON.stringify(newMessage.tool_args) : undefined
            );
        }

        SessionManager.addToHistory(sessionId, 'user', userQuery);
        SessionManager.addToHistory(sessionId, 'assistant', result.answer);
        await this.memory.learn({
            query: userQuery,
            nodes_used: memory,
            success: true,
            response: result.answer
        });

        logger.info('conversation_completed', 'Pipeline conversacional concluido com sucesso.', {
            cognitive_stage: 'result',
            result: 'SUCCESS',
            duration_ms: Date.now() - startedAt,
            response_length: result.answer.length,
            new_messages_count: result.newMessages.length
        });

        this.logExecutionSummary(logger, {
            decision: 'AGENT_LOOP',
            mode: 'COGNITIVE',
            success: true,
            durationMs: Date.now() - startedAt,
            responseLength: result.answer.length
        });

        return result.answer;
    }

    private logExecutionSummary(logger: ReturnType<typeof this.logger.child>, summary: {
        decision: string;
        mode: string;
        success: boolean;
        durationMs: number;
        responseLength?: number;
    }) {
        logger.info('execution_summary', 'Resumo cognitivo da execucao.', {
            cognitive_stage: 'result',
            summary: summary.success ? 'SUCCESS' : 'FAILED',
            decision: summary.decision,
            mode: summary.mode,
            success: summary.success,
            duration_ms: summary.durationMs,
            response_length: summary.responseLength
        });

        emitDebug('execution_summary', {
            decision: summary.decision,
            mode: summary.mode,
            success: summary.success,
            duration_ms: summary.durationMs,
            response_length: summary.responseLength
        });
    }

    /**
     * Executa a conversa utilizando o contexto de uma skill ativada.
     * O corpo da skill é injetado no system prompt e os caminhos OpenClaw
     * são adaptados para o padrão IalClaw (workspace/skills/<nome>/).
     */
    private async runWithSkill(
        sessionId: string,
        originalQuery: string,
        cleanQuery: string,
        skill: LoadedSkill
    ): Promise<string> {
        const logger = this.logger.child({ conversation_id: sessionId, skill_name: skill.name });
        // Adapta caminhos OpenClaw para o espaço de trabalho do IalClaw
        const adaptedBody = skill.body.replace(
            /\.agent\/skills\//g,
            'workspace/skills/'
        );

        const systemPrompt =
            `Voce e o IalClaw, um agente cognitivo 100% local e privado.\n` +
            `A skill abaixo foi ativada pelo usuario. Siga suas instrucoes rigorosamente.\n` +
            `Nao execute nenhum script sem antes planejar e confirmar com o usuario.\n\n` +
            `## Skill ativa: ${skill.name}\n\n` +
            `${adaptedBody}`;

        const messages: MessagePayload[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: cleanQuery }
        ];

        const result = await this.loop.run(messages);

        this.memory.saveMessage(sessionId, 'assistant', result.answer);
        await this.memory.learn({
            query: originalQuery,
            nodes_used: [],
            success: true,
            response: result.answer
        });

        logger.info('skill_completed', 'Skill executada com sucesso.', {
            response_length: result.answer.length
        });

        return result.answer;
    }

    private shouldUsePlannerRuntime(userQuery: string, currentProjectId?: string): boolean {
        if (this.extractWorkspaceProjectId(userQuery)) {
            return true;
        }

        if (currentProjectId) {
            return /\b(criar|crie|gere|gerar|montar|monte|projeto|workspace|arquivo|arquivos|html|css|javascript|site|pagina|frontend|continuar|continue|ajuste|corrija|corrigir|adicione|instale|instalar|som|sons|audio|áudio|efeito|efeitos|index\.html)\b/i.test(userQuery);
        }

        return /\b(criar|crie|gere|gerar|montar|monte|projeto|workspace|arquivo|arquivos|html|css|javascript|site|pagina|frontend|som|sons|audio|áudio|efeito|efeitos|index\.html)\b/i.test(userQuery);
    }

    private async handleSessionDirective(userQuery: string, session?: ReturnType<typeof SessionManager.getCurrentSession>): Promise<string | null> {
        const normalized = userQuery.toLowerCase().trim();
        const projectIdFromPath = this.extractWorkspaceProjectId(userQuery);

        if (projectIdFromPath && session) {
            session.current_project_id = projectIdFromPath;
            session.continue_project_only = true;
            session.last_error = undefined;
            session.last_error_type = undefined;
            session.last_error_hash = undefined;
            session.last_error_fingerprint = undefined;
            session._tool_input_attempts = 0;
            session._input_history = [];

            return `Projeto existente conectado a esta sessao: ${projectIdFromPath}.

Vou continuar editando os arquivos desse projeto sem criar um novo.`;
        }

        if (this.isPuppeteerInstallAuthorization(normalized)) {
            if (!session) {
                return 'Nao encontrei uma sessao ativa para registrar a autorizacao de instalacao.';
            }

            session.capability_policy_overrides = {
                ...(session.capability_policy_overrides || {}),
                browser_execution: 'auto-install'
            };

            const installed = await skillManager.ensure('browser_execution', 'auto-install');
            if (installed) {
                return 'Instalacao do suporte a browser concluida com sucesso. Agora posso validar projetos HTML automaticamente nesta sessao.';
            }

            return `Recebi sua autorizacao e tentei instalar o suporte a browser automaticamente, mas a instalacao nao concluiu com sucesso neste ambiente.

Voce ainda pode:
1. instalar manualmente o puppeteer
2. continuar em modo degradado sem validacao em browser`;
        }

        if (this.isContinueProjectDirective(normalized) && session?.current_project_id) {
            session.continue_project_only = true;
            session.last_error = undefined;
            session.last_error_type = undefined;
            session.last_error_hash = undefined;
            session.last_error_fingerprint = undefined;
            session._tool_input_attempts = 0;
            session._input_history = [];

            return `Vou continuar apenas o projeto atual desta sessao (${session.current_project_id}) e nao vou criar um projeto novo.`;
        }

        return null;
    }

    private isPuppeteerInstallAuthorization(normalizedQuery: string): boolean {
        return /\b(pode instalar|pode tentar instalar|autorizo instalar|autorizo tentar instalar|instale o puppeteer|instalar o puppeteer)\b/.test(normalizedQuery)
            && normalizedQuery.includes('puppeteer');
    }

    private isContinueProjectDirective(normalizedQuery: string): boolean {
        return /\b(so continue|continuar|continue o projeto|continue os projetos|nao recrie|não recrie|nao crie novo projeto|não crie novo projeto)\b/.test(normalizedQuery);
    }

    private extractWorkspaceProjectId(userQuery: string): string | null {
        const matches = userQuery.match(/(?:[A-Za-z]:\\|\/)[^\s"'`]+/g) || [];

        for (const match of matches) {
            const normalized = match.replace(/[)\].,;]+$/, '');
            const projectId = workspaceService.resolveProjectIdFromPath(normalized);
            if (projectId) {
                return projectId;
            }
        }

        return null;
    }
}
