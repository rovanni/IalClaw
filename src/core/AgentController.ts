import { Context } from 'grammy';
import { AgentLoop, AgentProgressEvent } from '../engine/AgentLoop';
import { CognitiveMemory } from '../memory/CognitiveMemory';
import { ContextBuilder } from '../memory/ContextBuilder';
import { TelegramInputHandler, CognitiveInputPayload } from '../telegram/TelegramInputHandler';
import { TelegramOutputHandler } from '../telegram/TelegramOutputHandler';
import { MessagePayload } from '../engine/ProviderFactory';
import { SessionManager } from '../shared/SessionManager';
import { skillManager } from '../capabilities';
import { workspaceService } from '../services/WorkspaceService';
import { SkillResolver } from '../skills/SkillResolver';
import { LoadedSkill } from '../skills/types';
import { runWithTrace } from '../shared/TraceContext';
import { createLogger } from '../shared/AppLogger';
import { decisionGate } from './agent/decisionGate';
import { emitDebug } from '../shared/DebugBus';
import { MemoryLifecycleManager } from '../memory/MemoryLifecycleManager';
import { AgentMemoryContext } from '../memory/MemoryTypes';
import {
    clearPendingAction,
    getPendingAction,
    isConfirmation,
    isDecline,
    setPendingAction,
    shouldDropPendingActionOnTopicShift
} from './agent/PendingActionTracker';

export class AgentController {
    private memory: CognitiveMemory;
    private contextBuilder: ContextBuilder;
    private loop: AgentLoop;
    private inputHandler: TelegramInputHandler;
    private outputHandler: TelegramOutputHandler;
    private skillResolver?: SkillResolver;
    private memoryLifecycle?: MemoryLifecycleManager;
    private logger = createLogger('AgentController');

    private emitStatus(sessionId: string, message: string, channel: 'web' | 'telegram', extra?: Record<string, any>): void {
        emitDebug('agent_status', {
            session_id: sessionId,
            channel,
            message,
            ...extra
        });
    }

    constructor(
        memory: CognitiveMemory,
        contextBuilder: ContextBuilder,
        loop: AgentLoop,
        inputHandler: TelegramInputHandler,
        outputHandler: TelegramOutputHandler,
        skillResolver?: SkillResolver,
        memoryLifecycle?: MemoryLifecycleManager
    ) {
        this.memory = memory;
        this.contextBuilder = contextBuilder;
        this.assertLoopHasProvider(loop);
        this.loop = loop;
        this.inputHandler = inputHandler;
        this.outputHandler = outputHandler;
        this.skillResolver = skillResolver;
        this.memoryLifecycle = memoryLifecycle;
    }

    private assertLoopHasProvider(loop: AgentLoop): void {
        const maybeLoop = loop as any;
        if (typeof maybeLoop?.getProvider !== 'function') {
            throw new Error('[IALCLAW] Invalid AgentLoop: getProvider() missing');
        }
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
                const progress = this.createTelegramProgressTracker(ctx);
                let answer: string | null = null;
                
                try {
                    answer = await this.runConversation(conversationId, payload.text, progress.onEvent);
                    await progress.complete();
                } catch (error: any) {
                    await progress.fail(error);
                    logger.error('conversation_execution_failed', error, 'Falha ao executar conversação.', {
                        duration_ms: Date.now() - startedAt,
                        source_type: payload.source_type
                    });
                    answer = `Ocorreu um erro no pipeline cognitivo:\n${error.message}`;
                }
                
                // GARANTIA DE ENTREGA: Sempre tentar enviar resposta, mesmo se houve erro
                if (answer) {
                    try {
                        await this.outputHandler.sendResponse(ctx, answer, payload.requires_audio_reply);
                        logger.info('message_flow_completed', 'Resposta enviada ao Telegram com sucesso.', {
                            duration_ms: Date.now() - startedAt,
                            response_length: answer.length,
                            requires_audio_reply: payload.requires_audio_reply
                        });
                    } catch (sendError: any) {
                        // CRÍTICO: sendResponse falhou completamente (incluindo todos os retries e fallbacks)
                        logger.error('send_response_critical_failure', sendError, '[IALCLAW] FALHA CRÍTICA: Impossível enviar resposta ao usuário.', {
                            duration_ms: Date.now() - startedAt,
                            response_length: answer.length,
                            error_message: sendError.message
                        });
                        
                        console.error(`\n[IALCLAW] ⚠️  FALHA CRÍTICA DE ENTREGA`);
                        console.error(`[IALCLAW] 📱 Chat ID: ${conversationId}`);
                        console.error(`[IALCLAW] ❌ Erro: ${sendError.message}`);
                        console.error(`[IALCLAW] 📝 Resposta não entregue (${answer.length} caracteres)\n`);
                        
                        // Última tentativa: mensagem de erro mínima sem retry
                        try {
                            await ctx.reply('❌ Erro ao enviar resposta. Verifique os logs do sistema.');
                        } catch {
                            // Ignorar - já logamos tudo que podíamos
                        }
                    }
                }
            });
        }, 'telegram_controller');
    }

    public async handleWebMessage(sessionId: string, userQuery: string): Promise<string> {
        return this.handleWebMessageWithOptions(sessionId, userQuery);
    }

    public async handleWebMessageWithOptions(
        sessionId: string,
        userQuery: string,
        options?: { shouldStop?: () => boolean }
    ): Promise<string> {
        return runWithTrace(async () => {
            const startedAt = Date.now();
            const logger = this.logger.child({ conversation_id: sessionId, channel: 'web' });
            logger.info('web_flow_started', 'Iniciando processamento da mensagem web.', {
                query_length: userQuery.length
            });

            const emitWebProgress = async (event: AgentProgressEvent) => {
                const message = this.formatProgressMessage(event);
                this.emitStatus(sessionId, message, 'web', {
                    stage: event.stage,
                    iteration: event.iteration,
                    tool_name: event.tool_name,
                    duration_ms: event.duration_ms
                });
                emitDebug('web_progress', {
                    session_id: sessionId,
                    stage: event.stage,
                    iteration: event.iteration,
                    tool_name: event.tool_name,
                    duration_ms: event.duration_ms,
                    message
                });
            };

            await emitWebProgress({ stage: 'loop_started' });

            return SessionManager.runWithSession(sessionId, async () => {
                try {
                    const answer = await this.runConversation(sessionId, userQuery, emitWebProgress, options?.shouldStop);
                    logger.info('web_flow_completed', 'Mensagem web processada com sucesso.', {
                        duration_ms: Date.now() - startedAt,
                        response_length: answer.length
                    });
                    return answer;
                } catch (error: any) {
                    await emitWebProgress({ stage: 'failed' });
                    logger.error('web_flow_failed', error, 'Falha ao processar mensagem web.', {
                        duration_ms: Date.now() - startedAt
                    });
                    throw error;
                }
            });
        }, 'web_controller');
    }

    private handleCommand(input: string, sessionId: string): string | null {
        if (!input.startsWith('/')) return null;

        const cmd = input.split(' ')[0].toLowerCase();

        switch (cmd) {
            case '/new':
                SessionManager.resetVolatileState(sessionId);
                const session = SessionManager.getSession(sessionId);
                session.conversation_history = [];
                session.current_project_id = undefined;
                session.continue_project_only = undefined;
                return '🔄 Nova conversa iniciada. Como posso te ajudar?';

            case '/help':
                return 'Comandos disponíveis:\n/new - reiniciar conversa\n/help - ver comandos\n/status - ver estado da sessão';

            case '/status': {
                const s = SessionManager.getSession(sessionId);
                const project = s.current_project_id || 'nenhum';
                const msgs = s.conversation_history.length;
                return `📊 Sessão: ${sessionId}\nProjeto ativo: ${project}\nMensagens na sessão: ${msgs}`;
            }

            default:
                return '⚠️ Comando não reconhecido. Use /help para ver os comandos disponíveis.';
        }
    }

    private tryCaptureUserName(lastAgentMessage: string, userMessage: string): void {
        if (!lastAgentMessage || !userMessage) return;

        const question = lastAgentMessage.toLowerCase();
        const askedName =
            question.includes('seu nome') ||
            question.includes('como voce se chama') ||
            question.includes('como você se chama') ||
            question.includes('qual o seu nome') ||
            question.includes('qual é o seu nome');
        if (!askedName) return;

        const cleaned = userMessage.trim();
        const isValidName =
            cleaned.length >= 2 &&
            cleaned.length <= 40 &&
            /^[a-zA-ZÀ-ÿ\s]+$/.test(cleaned) &&
            cleaned.split(' ').length <= 3;
        if (!isValidName) return;

        const already = this.memory.searchByContent('nome do usuario');
        if (already.length > 0) return;

        this.memory.saveExecutionFix({
            content: `O nome do usuario é ${cleaned}`,
            error_type: 'user_identity',
            fingerprint: `user_name_${cleaned.toLowerCase()}`
        });
        this.logger.info('user_name_captured', 'Nome do usuario capturado.', { name: cleaned });
    }

    private getUserName(): string | null {
        const nodes = this.memory.searchByContent('nome do usuario');
        if (!nodes.length) return null;
        const match = nodes[0].content?.match(/nome do usuario [eé] (.+)/i);
        return match ? match[1].trim() : null;
    }

    private async indexProjectsInMemory(): Promise<void> {
        try {
            const projects = workspaceService.listProjects();
            const existingNodes = this.memory.getProjectNodes(100);
            const indexedIds = new Set(existingNodes.map(n => n.id.replace(/^project:/, '')));

            for (const { id, metadata, files_count } of projects) {
                if (!indexedIds.has(id)) {
                    await this.memory.saveProjectNode({
                        id,
                        name: metadata.name,
                        description: metadata.prompt,
                        files_count
                    });
                    this.logger.info('project_indexed', 'Projeto indexado na memória cognitiva.', { project_id: id, name: metadata.name });
                }
            }
        } catch (err: any) {
            this.logger.warn('project_index_failed', 'Falha ao indexar projetos na memória.', { error: err.message });
        }
    }

    private async runConversation(
        sessionId: string,
        userQuery: string,
        onProgress?: (event: AgentProgressEvent) => Promise<void> | void,
        shouldStop?: () => boolean
    ): Promise<string> {
        const startedAt = Date.now();
        const logger = this.logger.child({ conversation_id: sessionId });
        const session = SessionManager.getCurrentSession();
        let effectiveUserQuery = userQuery;

        // ── Roteamento de comandos (antes do LLM) ──────────────────────────
        const commandResponse = this.handleCommand(userQuery, sessionId);
        if (commandResponse) {
            this.memory.saveMessage(sessionId, 'user', userQuery);
            this.memory.saveMessage(sessionId, 'assistant', commandResponse);
            logger.info('command_handled', 'Comando processado sem acionar LLM.', {
                command: userQuery.split(' ')[0],
                duration_ms: Date.now() - startedAt
            });
            return commandResponse;
        }

        // ── Pending action: confirmação explícita dispara ação pendente ─────
        if (session) {
            const pending = getPendingAction(session);
            if (pending) {
                if (isDecline(userQuery)) {
                    clearPendingAction(session, pending.id);
                    const declined = 'Perfeito, cancelei a acao pendente.';
                    this.memory.saveMessage(sessionId, 'user', userQuery);
                    this.memory.saveMessage(sessionId, 'assistant', declined);
                    return declined;
                }

                if (isConfirmation(userQuery)) {
                    effectiveUserQuery = this.buildPendingActionQuery(pending);
                    clearPendingAction(session, pending.id);
                    logger.info('pending_action_confirmed', 'Confirmacao vinculada a acao pendente.', {
                        action_type: pending.type,
                        payload: pending.payload
                    });
                } else if (shouldDropPendingActionOnTopicShift(userQuery)) {
                    clearPendingAction(session, pending.id);
                    logger.info('pending_action_dropped', 'Acao pendente descartada por mudanca de contexto.', {
                        action_type: pending.type
                    });
                }
            }
        }

        this.memory.saveMessage(sessionId, 'user', userQuery);
        await this.captureLifecycleMemory(userQuery, {
            sessionId,
            role: 'user',
            projectId: session?.current_project_id,
            recentMessages: session?.conversation_history.map((item) => item.content).slice(-5)
        });
        logger.info('conversation_started', 'Processando nova interacao do usuario.', {
            cognitive_stage: 'start',
            summary: 'MESSAGE_RECEIVED',
            route: 'conversation',
            query_length: userQuery.length,
            effective_query_length: effectiveUserQuery.length,
            has_current_project: Boolean(session?.current_project_id)
        });

        // ── Resolução de skill ──────────────────────────────────────────────
        if (this.skillResolver) {
            const resolved = this.skillResolver.resolve(effectiveUserQuery);
            if (resolved) {
                logger.info('skill_resolved', 'Mensagem roteada para uma skill dedicada.', {
                    skill_name: resolved.skill.name
                });
                return this.runWithSkill(sessionId, effectiveUserQuery, resolved.query, resolved.skill, onProgress, shouldStop);
            }
        }

        const sessionDirectiveReply = await this.handleSessionDirective(effectiveUserQuery, session);
        if (sessionDirectiveReply) {
            this.memory.saveMessage(sessionId, 'assistant', sessionDirectiveReply);
            logger.info('session_directive_handled', 'Diretiva de sessao processada sem acionar o pipeline principal.', {
                duration_ms: Date.now() - startedAt
            });
            return sessionDirectiveReply;
        }

        // ── Fluxo unificado: LLM decide usar tools ou responder direto ──
        console.log('[IALCLAW] Unified flow - LLM decides');
        logger.info('unified_flow_started', 'Fluxo unificado. LLM decide se usa tools.', {
            cognitive_stage: 'decision',
            decision: 'UNIFIED',
            has_project: Boolean(session?.current_project_id)
        });

        // Memória: embedding → retrieval → identidade → contexto
        const provider = this.loop.getProvider();
        const queryEmbedding = await provider.embed(effectiveUserQuery);

        // ── Indexar projetos do workspace na memória cognitiva ─────────────
        await this.indexProjectsInMemory();

        const memoryNodes = await this.memory.retrieveWithTraversal(effectiveUserQuery, queryEmbedding);
        const identity = await this.memory.getIdentityNodes();
        let contextStr = this.contextBuilder.build({ identity, memory: memoryNodes, policy: {} });

        // ── Injetar nome do usuário no contexto ────────────────────────────
        const userName = this.getUserName();
        if (userName) {
            contextStr += `\nO nome do usuario é ${userName}. Use isso para personalizar a resposta.`;
        }

        // ── Injetar projetos conhecidos no contexto ────────────────────────
        const projectNodes = this.memory.getProjectNodes(5);
        if (projectNodes.length) {
            const projectLines = projectNodes.map(n => {
                const projectId = n.id.replace(/^project:/, '');
                return `- ${n.name} (id: ${projectId})`;
            }).join('\n');
            contextStr += `\n\nProjetos conhecidos:\n${projectLines}`;
        }

        // ── Auto-resolver projeto ativo a partir da memória ────────────────
        if (!session?.current_project_id) {
            const projectFromMemory = memoryNodes.find(n => n.subtype === 'project');
            if (projectFromMemory && session) {
                const resolvedId = projectFromMemory.id.replace(/^project:/, '');
                if (workspaceService.projectExists(resolvedId)) {
                    session.current_project_id = resolvedId;
                    logger.info('project_auto_resolved', 'Projeto ativo resolvido via memória cognitiva.', { project_id: resolvedId });
                }
            }
        }

        // ── Injetar consciência de skills no contexto ───────────────────────
        let skillsBlock = '';
        if (this.skillResolver) {
            const skills = this.skillResolver.listWithDescriptions();
            if (skills.length) {
                skillsBlock = '\n\nCAPACIDADES DO AGENTE (skills instaladas):\n';
                for (const s of skills) {
                    skillsBlock += `- ${s.name}: ${s.description || 'sem descricao'}\n`;
                }
                skillsBlock += '\nSe uma tarefa puder ser resolvida com uma dessas skills, considere que voce TEM essa capacidade.\n';
                skillsBlock += 'Nunca diga que nao possui ferramentas sem considerar essas skills.\n';
                skillsBlock += 'Se nenhuma skill instalada resolver a tarefa, voce pode sugerir buscar ou instalar uma nova skill.\n';
                skillsBlock += 'Use /install-skill ou /find-skill para buscar novas skills. Nao instale sem confirmacao do usuario.';
            }
        }

        const history = this.memory.getConversationHistory(sessionId, 10);
        const projectInfo = session?.current_project_id
            ? `\nProjeto ativo: ${session.current_project_id}. Use tools para executar acoes reais nesse projeto.`
            : '';
        const messages: MessagePayload[] = [
            {
                role: 'system',
                content: `Voce e o IalClaw, um agente cognitivo 100% local.\nVoce tem acesso a tools para executar acoes reais.\nUse tools quando necessario.\nSe for pergunta simples, responda direto.\nNao invente execucao.\nNao alucine fatos.\n\nAntes de usar uma tool, avalie se a acao e realmente executavel com as ferramentas disponiveis.\nSe nao for possivel executar com seguranca ou confianca, NAO tente usar tool.\nEm vez disso, responda explicando como o usuario pode realizar a tarefa.\nNunca entre em loop tentando executar algo que nao esta ao seu alcance.\nSe voce ja tentou usar tools e falhou, responda diretamente sem tentar novamente.\nPrefira ser util explicando do que falhar tentando executar.\n\nSELECAO DE OPCOES:\nQuando voce apresentar uma lista numerada de opcoes, mantenha explicitamente o contexto da acao antes da lista (ex.: "Essas sao as skills disponiveis para instalacao").\nSe o usuario responder apenas com "1", "2" ou repetir o nome de uma opcao, trate isso como escolha direta da lista ativa e execute a acao correspondente imediatamente.\nNao peca confirmacao redundante.\nNao ignore a escolha.\nNao continue conversa generica quando houver uma selecao valida.\n\nGIT E GITHUB:\nNao gere mensagens automaticas pedindo commit, push, PR ou publicacao de branch.\nSo fale sobre commit/push/PR se o usuario pedir isso explicitamente.\nSe o usuario nao pediu GitHub, mantenha foco apenas na tarefa atual.\n\nSe voce nao possui uma skill adequada para resolver a tarefa do usuario, considere que novas skills podem existir.\nAntes de dizer que nao consegue, pense: existe uma skill publica que resolve isso?\nSe fizer sentido, sugira ao usuario buscar ou instalar uma skill apropriada.\nNao instale skills automaticamente sem confirmacao do usuario.\n\nVoce possui memoria persistente baseada em grafo.\nVoce aprende automaticamente informacoes importantes do usuario durante a conversa.\nQuando o usuario compartilha algo relevante (nome, profissao, preferencias), assuma que isso sera armazenado automaticamente.\nVoce PODE afirmar naturalmente que lembra dessas informacoes e que podera usa-las em interacoes futuras.\nNUNCA diga que nao possui memoria, que nao pode salvar informacoes, ou que nao tem essa capacidade.${projectInfo}${skillsBlock}\n\nContexto relevante:\n${contextStr}`
            }
        ];
        for (const msg of history) {
            if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool') {
                messages.push({ role: msg.role, content: msg.content });
            }
        }
        messages.push({ role: 'user', content: effectiveUserQuery });

        const policy = {
            limits: {
                max_steps: 3,
                max_tool_calls: 2
            },
            progress: {
                onEvent: onProgress
            },
            control: {
                shouldStop
            }
        };

        const result = await this.loop.run(messages, policy);

        for (const newMessage of result.newMessages) {
            this.memory.saveMessage(
                sessionId,
                newMessage.role,
                newMessage.content,
                newMessage.tool_name,
                newMessage.tool_args ? JSON.stringify(newMessage.tool_args) : undefined,
                newMessage.role === 'tool' ? newMessage.content : undefined
            );
        }

        await this.indexCodeArtifactsFromMessages(result.newMessages, session?.current_project_id);
        this.updatePendingActionFromResponse(sessionId, effectiveUserQuery, result.answer);

        SessionManager.addToHistory(sessionId, 'user', userQuery);
        SessionManager.addToHistory(sessionId, 'assistant', result.answer);

        // ── Captura automática do nome do usuário ──────────────────────────
        const lastMessages = this.memory.getConversationHistory(sessionId, 3);
        const lastAssistantMsg = lastMessages[lastMessages.length - 2]?.content || '';
        this.tryCaptureUserName(lastAssistantMsg, userQuery);

        // Detecção direta: "meu nome é X" / "me chamo X"
        const directNameMatch = userQuery.match(/(?:meu nome [eé]|me chamo)\s+([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+)?)/i);
        if (directNameMatch && !this.memory.searchByContent('nome do usuario').length) {
            this.memory.saveExecutionFix({
                content: `O nome do usuario é ${directNameMatch[1].trim()}`,
                error_type: 'user_identity',
                fingerprint: `user_name_${directNameMatch[1].trim().toLowerCase()}`
            });
            logger.info('user_name_captured', 'Nome capturado via frase direta.', { name: directNameMatch[1].trim() });
        }

        await this.captureLifecycleMemory(result.answer, {
            sessionId,
            role: 'assistant',
            projectId: session?.current_project_id,
            recentMessages: [effectiveUserQuery]
        });

        await this.memory.learn({
            query: effectiveUserQuery,
            nodes_used: memoryNodes,
            success: true,
            response: result.answer
        });

        logger.info('unified_flow_completed', 'Pipeline unificado concluido.', {
            cognitive_stage: 'result',
            result: 'SUCCESS',
            duration_ms: Date.now() - startedAt,
            response_length: result.answer.length
        });

        return result.answer;
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
        skill: LoadedSkill,
        onProgress?: (event: AgentProgressEvent) => Promise<void> | void,
        shouldStop?: () => boolean
    ): Promise<string> {
        const logger = this.logger.child({ conversation_id: sessionId, skill_name: skill.name });

        if (typeof (this.loop as any)?.getProvider !== 'function') {
            throw new Error('[IALCLAW] Invalid AgentLoop: getProvider() missing');
        }

        // Memória: embedding → retrieval → contexto
        const provider = this.loop.getProvider();
        const queryEmbedding = await provider.embed(originalQuery);
        const memoryNodes = await this.memory.retrieveWithTraversal(originalQuery, queryEmbedding);
        const identity = await this.memory.getIdentityNodes();
        const contextStr = this.contextBuilder.build({ identity, memory: memoryNodes, policy: {} });

        // Adapta caminhos OpenClaw para o espaço de trabalho do IalClaw
        const adaptedBody = skill.body.replace(
            /\.agent\/skills\//g,
            'workspace/skills/'
        );

        const systemPrompt =
            `Voce e o IalClaw, um agente cognitivo 100% local e privado.\n` +
            `A skill abaixo foi ativada pelo usuario. Siga suas instrucoes rigorosamente.\n` +
            `Voce TEM tools disponiveis para executar acoes reais. USE-AS em vez de dizer ao usuario para executar comandos manualmente.\n` +
            `Nao invente resultados — execute as tools e relate o resultado real.\n\n` +
            `SELECAO DE OPCOES:\n` +
            `Quando voce apresentar uma lista numerada de opcoes, mantenha explicitamente o contexto da acao antes da lista (ex.: "Essas sao as skills disponiveis para instalacao").\n` +
            `Se o usuario responder apenas com "1", "2" ou repetir o nome de uma opcao, trate isso como escolha direta da lista ativa e execute a acao correspondente imediatamente.\n` +
            `Nao peca confirmacao redundante.\n` +
            `Nao ignore a escolha.\n` +
            `Nao continue conversa generica quando houver uma selecao valida.\n\n` +
            `GIT E GITHUB:\n` +
            `Nao gere mensagens automaticas pedindo commit, push, PR ou publicacao de branch.\n` +
            `So fale sobre commit/push/PR se o usuario pedir isso explicitamente.\n\n` +
            `## Skill ativa: ${skill.name}\n\n` +
            `${adaptedBody}\n\n` +
            `${contextStr}`;

        const messages: MessagePayload[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: cleanQuery }
        ];

        // Skills como skill-installer precisam de mais tool calls que o default (5)
        const skillPolicy = {
            limits: {
                max_steps: 10,
                max_tool_calls: 12
            },
            progress: {
                onEvent: onProgress
            },
            control: {
                shouldStop
            }
        };

        const result = await this.loop.run(messages, skillPolicy);
        this.updatePendingActionFromResponse(sessionId, originalQuery, result.answer, skill.name);

        SessionManager.addToHistory(sessionId, 'user', originalQuery);
        SessionManager.addToHistory(sessionId, 'assistant', result.answer);

        this.memory.saveMessage(sessionId, 'assistant', result.answer);
        await this.captureLifecycleMemory(result.answer, {
            sessionId,
            role: 'assistant',
            projectId: SessionManager.getCurrentSession()?.current_project_id
        });
        await this.indexCodeArtifactsFromMessages(result.newMessages, SessionManager.getCurrentSession()?.current_project_id);
        await this.memory.learn({
            query: originalQuery,
            nodes_used: memoryNodes,
            success: true,
            response: result.answer
        });

        logger.info('skill_completed', 'Skill executada com sucesso.', {
            response_length: result.answer.length
        });

        return result.answer;
    }

    private async captureLifecycleMemory(input: string, context: AgentMemoryContext): Promise<void> {
        if (!this.memoryLifecycle) {
            return;
        }

        try {
            await this.memoryLifecycle.processInput(input, context);
        } catch (error: any) {
            this.logger.debug('memory_lifecycle_capture_failed', 'Falha no capture do lifecycle de memoria.', {
                conversation_id: context.sessionId,
                reason: String(error?.message || error)
            });
        }
    }

    private updatePendingActionFromResponse(
        sessionId: string,
        userInput: string,
        assistantAnswer: string,
        activeSkillName?: string
    ): void {
        const session = SessionManager.getCurrentSession();
        if (!session) return;

        // skill-installer executa instalacao publica diretamente (sem loop de confirmacao pendente)
        if (activeSkillName === 'skill-installer') {
            return;
        }

        const pendingSkill = this.extractPendingInstallSkillName(userInput, assistantAnswer, activeSkillName);
        if (!pendingSkill) return;

        const pending = setPendingAction(session, {
            type: 'install_skill',
            payload: { skillName: pendingSkill }
        });

        this.logger.info('pending_action_set', 'Acao pendente registrada em STM.', {
            conversation_id: sessionId,
            action_type: pending.type,
            skill_name: pending.payload.skillName,
            expires_at: pending.expires_at
        });
    }

    private extractPendingInstallSkillName(
        userInput: string,
        assistantAnswer: string,
        activeSkillName?: string
    ): string | null {
        const asksForConfirmation = /\b(confirma|confirmar|confirmacao|confirmac[aã]o|deseja\s+instalar|posso\s+instalar|instalo\?)\b/i.test(assistantAnswer)
            && /\b(instalar|instalacao|instala[çc][aã]o|skill|habilidade)\b/i.test(assistantAnswer);

        if (!asksForConfirmation) {
            return null;
        }

        const fromAnswer = this.extractSkillNameCandidate(assistantAnswer);
        if (fromAnswer) return fromAnswer;

        const fromUser = this.extractSkillNameCandidate(userInput);
        if (fromUser) return fromUser;

        // Em skill-installer, preservar o último token útil como fallback
        if (activeSkillName === 'skill-installer') {
            const token = userInput.trim().split(/\s+/).pop() || '';
            if (/^[a-z0-9][a-z0-9\-_]{1,80}$/i.test(token)) {
                return token.toLowerCase();
            }
        }

        return null;
    }

    private extractSkillNameCandidate(text: string): string | null {
        const patterns: RegExp[] = [
            /(?:\/skill-install|\/install-skill)\s+([a-z0-9][a-z0-9\-_]{1,80})/i,
            /(?:instalar|instale|instalacao\s+da|instala[çc][aã]o\s+da)\s+(?:skill|habilidade)?\s*["'`]?([a-z0-9][a-z0-9\-_]{1,80})["'`]?/i,
            /(?:skill|habilidade)\s*["'`]?([a-z0-9][a-z0-9\-_]{1,80})["'`]?/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match?.[1]) {
                return match[1].toLowerCase();
            }
        }

        return null;
    }

    private buildPendingActionQuery(action: { type: 'install_skill'; payload: { skillName: string } }): string {
        if (action.type === 'install_skill') {
            return `instalar skill ${action.payload.skillName}`;
        }
        return 'continuar';
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

            const connectMsg = `Projeto existente conectado a esta sessao: ${projectIdFromPath}. Vou continuar editando os arquivos desse projeto sem criar um novo.`;

            // Se o input é APENAS um path (sem pedido real), retorna confirmação.
            // Se tem conteúdo além do path, registra a conexão e deixa o pipeline processar o pedido.
            const withoutPaths = userQuery.replace(/(?:[A-Za-z]:\\|\/)[^\s"'`]+/g, '').trim();
            if (withoutPaths.length < 5) {
                return `${connectMsg}\n\nO que voce deseja fazer com esse projeto?`;
            }

            this.memory.saveMessage(session.conversation_id, 'assistant', connectMsg);
            // Não retorna — continua para o pipeline processar a mensagem
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

        // ── Decision Gate: intent + contexto → decisão ─────────────────────
        const decision = decisionGate({ text: normalized, session: session ?? undefined });

        if (decision.type === 'execute') {
            if (session && !session.continue_project_only) {
                session.continue_project_only = true;
                session.last_error = undefined;
                session.last_error_type = undefined;
                session.last_error_hash = undefined;
                session.last_error_fingerprint = undefined;
                session._tool_input_attempts = 0;
                session._input_history = [];
            }
            return decision.message;
        }

        if (decision.type === 'confirm') {
            return decision.message;
        }

        return null;
    }

    private isPuppeteerInstallAuthorization(normalizedQuery: string): boolean {
        return /\b(pode instalar|pode tentar instalar|autorizo instalar|autorizo tentar instalar|instale o puppeteer|instalar o puppeteer)\b/.test(normalizedQuery)
            && normalizedQuery.includes('puppeteer');
    }

    private formatProgressMessage(event: AgentProgressEvent): string {
        switch (event.stage) {
            case 'loop_started':
                return 'Iniciando analise do pedido...';
            case 'iteration_started':
                return `Processando etapa ${event.iteration || 1}...`;
            case 'llm_started':
                return 'Pensando na proxima acao...';
            case 'llm_completed':
                return 'Analise concluida. Validando proximo passo...';
            case 'tool_started':
                return `Executando ferramenta: ${event.tool_name || 'tool'}`;
            case 'tool_completed':
                return `Ferramenta concluida: ${event.tool_name || 'tool'}`;
            case 'tool_failed':
                return `Falha na ferramenta: ${event.tool_name || 'tool'}. Tentando recuperar...`;
            case 'finalizing':
                return 'Finalizando resposta...';
            case 'completed':
                return 'Concluido. Enviando resposta...';
            case 'stopped':
                return 'Execucao interrompida pelo usuario.';
            case 'failed':
                return 'Erro no processamento da requisicao.';
            default:
                return 'Processando...';
        }
    }

    private createTelegramProgressTracker(ctx: Context): {
        onEvent: (event: AgentProgressEvent) => Promise<void>;
        complete: () => Promise<void>;
        fail: (error: any) => Promise<void>;
    } {
        const chatId = ctx.chat?.id;
        const sessionId = String(chatId || 'telegram-session');
        let lastStatusText = '';
        let lastUpdateAt = 0;
        const MIN_UPDATE_INTERVAL_MS = 1200;

        const heartbeat = setInterval(() => {
            ctx.replyWithChatAction('typing').catch(() => undefined);
        }, 4500);

        const emitStatus = async (text: string, force: boolean = false) => {
            const now = Date.now();
            if (!force && (text === lastStatusText || now - lastUpdateAt < MIN_UPDATE_INTERVAL_MS)) {
                return;
            }

            this.emitStatus(sessionId, text, 'telegram');
            lastStatusText = text;
            lastUpdateAt = now;
        };

        const onEvent = async (event: AgentProgressEvent) => {
            await ctx.replyWithChatAction('typing').catch(() => undefined);

            switch (event.stage) {
                case 'loop_started':
                    await emitStatus('Iniciando análise do pedido...');
                    break;
                case 'iteration_started':
                    await emitStatus(`Processando etapa ${event.iteration || 1}...`);
                    break;
                case 'llm_started':
                    await emitStatus('Pensando na próxima ação...');
                    break;
                case 'tool_started':
                    await emitStatus(`Executando ferramenta: ${event.tool_name || 'tool'}`);
                    break;
                case 'tool_completed':
                    await emitStatus(`Ferramenta concluída: ${event.tool_name || 'tool'}`);
                    break;
                case 'tool_failed':
                    await emitStatus(`Ferramenta falhou: ${event.tool_name || 'tool'}. Tentando recuperar...`);
                    break;
                case 'finalizing':
                    await emitStatus('Finalizando resposta...');
                    break;
                case 'completed':
                    await emitStatus('Concluído. Enviando resposta...', true);
                    break;
                case 'failed':
                    await emitStatus('Falha no processamento.', true);
                    break;
                case 'stopped':
                    await emitStatus('Execucao interrompida pelo usuario.', true);
                    break;
                default:
                    break;
            }
        };

        const complete = async () => {
            clearInterval(heartbeat);
            await emitStatus('Concluído. Enviando resposta...', true);
        };

        const fail = async (error: any) => {
            clearInterval(heartbeat);
            await emitStatus(`Erro no processamento: ${String(error?.message || error)}`, true);
        };

        return { onEvent, complete, fail };
    }

    private async indexCodeArtifactsFromMessages(messages: MessagePayload[], fallbackProjectId?: string): Promise<void> {
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role !== 'assistant' || !msg.tool_name || !msg.tool_args) {
                continue;
            }

            if (msg.tool_name !== 'workspace_save_artifact' && msg.tool_name !== 'workspace_apply_diff') {
                continue;
            }

            const args = this.parseToolArgs(msg.tool_args);
            if (!args) {
                continue;
            }

            const projectId = String(args.project_id || fallbackProjectId || '').trim();
            const relativePath = String(args.filename || args.filePath || '').trim();
            if (!projectId || !relativePath) {
                continue;
            }

            let rawContent = '';

            if (msg.tool_name === 'workspace_save_artifact') {
                rawContent = String(args.content || '');
            }

            if (msg.tool_name === 'workspace_apply_diff') {
                const toolResultMessage = messages[i + 1];
                if (!toolResultMessage || toolResultMessage.role !== 'tool' || !this.isSuccessfulToolResult(toolResultMessage.content)) {
                    continue;
                }

                rawContent = workspaceService.readArtifact(projectId, relativePath) || '';
            }

            if (!rawContent.trim()) {
                continue;
            }

            try {
                await this.memory.indexCodeNode({
                    project_id: projectId,
                    relative_path: relativePath,
                    raw_content: rawContent
                });
                this.memory.setActiveCodeFiles(projectId, [relativePath]);
            } catch (error: any) {
                this.logger.debug('code_indexing_skipped', 'Falha ao indexar arquivo de codigo para memoria.', {
                    project_id: projectId,
                    relative_path: relativePath,
                    reason: String(error?.message || error)
                });
            }
        }
    }

    private parseToolArgs(toolArgs: any): any | null {
        if (!toolArgs) {
            return null;
        }

        if (typeof toolArgs === 'object') {
            return toolArgs;
        }

        if (typeof toolArgs !== 'string') {
            return null;
        }

        try {
            const parsed = JSON.parse(toolArgs);
            return typeof parsed === 'object' && parsed !== null ? parsed : null;
        } catch {
            return null;
        }
    }

    private isSuccessfulToolResult(content: string): boolean {
        if (typeof content !== 'string' || !content.trim()) {
            return false;
        }

        try {
            const parsed = JSON.parse(content);
            if (typeof parsed?.success === 'boolean') {
                return parsed.success;
            }
        } catch {
            // fallback para resultados textuais
        }

        return /"success"\s*:\s*true|\bsucesso\b|\bOK:\b/i.test(content);
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
