import { Context } from 'grammy';
import { AgentLoop, AgentProgressEvent, RouteAutonomySignal } from '../engine/AgentLoop';
import { CognitiveMemory, ContextBuilder, MemoryLifecycleManager, AgentMemoryContext } from '../memory';
import { TelegramInputHandler, CognitiveInputPayload } from '../telegram/TelegramInputHandler';
import { TelegramOutputHandler } from '../telegram/TelegramOutputHandler';
import { MessagePayload } from '../engine/ProviderFactory';
import { SessionManager, PendingAction } from '../shared/SessionManager';
import { skillManager } from '../capabilities';
import { workspaceService } from '../services/WorkspaceService';
import { SkillResolver } from '../skills/SkillResolver';
import { SkillResolutionManager, ResolutionResult } from '../skills/SkillResolutionManager';
import { LoadedSkill } from '../skills/types';
import { runWithTrace } from '../shared/TraceContext';
import { createLogger } from '../shared/AppLogger';
import { decisionGate } from './agent/decisionGate';
import { emitDebug } from '../shared/DebugBus';
// Removidos duplicados, unificados no import da linha 3
import { detectLanguage, setLanguage, t, withLanguage } from '../i18n';
import { Lang } from '../i18n/types';
import { resolveLanguage, buildLanguageDirective, InputSource } from './language/LanguageControlLayer';
import { TaskType } from './agent/TaskClassifier';
import { OnboardingService } from '../services/OnboardingService';
import {
    clearPendingAction,
    getPendingAction,
    isConfirmation,
    isDecline,
    isRetryIntent,
    setPendingAction,
    shouldDropPendingActionOnTopicShift
} from './agent/PendingActionTracker';
import { FlowManager } from './flow/FlowManager';
import { CognitiveOrchestrator, CognitiveStrategy } from './orchestrator/CognitiveOrchestrator';
import { getActionRouter } from './autonomy/ActionRouter';
import { FlowRegistry } from './flow/FlowRegistry';
import { IntentClassifier } from './intent/IntentClassifier';

export class AgentController {
    private memory: CognitiveMemory;
    private contextBuilder: ContextBuilder;
    private loop: AgentLoop;
    private inputHandler: TelegramInputHandler;
    private outputHandler: TelegramOutputHandler;
    private skillResolver?: SkillResolver;
    private skillResolution?: SkillResolutionManager;
    private memoryLifecycle?: MemoryLifecycleManager;
    private onboardingService?: OnboardingService;
    private flowManager: FlowManager;
    private orchestrator: CognitiveOrchestrator;
    private intentClassifier: IntentClassifier;
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
        memoryLifecycle?: MemoryLifecycleManager,
        onboardingService?: OnboardingService
    ) {
        this.memory = memory;
        this.contextBuilder = contextBuilder;
        this.assertLoopHasProvider(loop);
        this.loop = loop;
        this.inputHandler = inputHandler;
        this.outputHandler = outputHandler;
        this.skillResolver = skillResolver;
        this.skillResolution = new SkillResolutionManager();
        this.memoryLifecycle = memoryLifecycle;
        this.onboardingService = onboardingService;
        this.flowManager = new FlowManager();
        this.intentClassifier = new IntentClassifier();
        this.orchestrator = new CognitiveOrchestrator(
            this.memory,
            this.flowManager,
            this.loop.getDecisionMemory()
        );
        // ETAPA 5 — injeta o Orchestrator no AgentLoop para governança ativa dos signals.
        if (typeof (this.loop as AgentLoop & { setOrchestrator?: (orchestrator: CognitiveOrchestrator) => void })?.setOrchestrator === 'function') {
            this.loop.setOrchestrator(this.orchestrator);
        }
    }

    private assertLoopHasProvider(loop: AgentLoop): void {
        const maybeLoop = loop as any;
        if (typeof maybeLoop?.getProvider !== 'function') {
            throw new Error(t('error.agent.invalid_loop_provider'));
        }
    }

    private formatSkillList(results: { name: string; description: string; source: string; rank?: number; installs?: string }[]): string {
        let text = `Encontrei ${results.length} skills para essa busca:\n\n`;
        for (const r of results) {
            const rank = r.rank ? `â­ Rank #${r.rank}` : '';
            const installs = r.installs ? `| ðŸ“¥ ${r.installs} instalaÃ§Ãµes` : '';
            text += `${r.name}: ${r.description}\n  ${rank} ${installs}\n  Fonte: ${r.source}\n\n`;
        }
        text += 'Para instalar, digite "instale essa: [nome]" ou "instale o nÃºmero X"';
        return text;
    }

    private mapRouteSignalToAuditDecision(signal?: RouteAutonomySignal): {
        action: 'execute' | 'confirm' | 'pass';
        confidence: number;
        reason: RouteAutonomySignal['reason'];
        requiresConfirmation: boolean;
    } | undefined {
        if (!signal) {
            return undefined;
        }

        const action: 'execute' | 'confirm' | 'pass' =
            signal.recommendedStrategy === 'CONFIRM'
                ? 'confirm'
                : signal.recommendedStrategy === 'ASK'
                    ? 'pass'
                    : 'execute';

        return {
            action,
            confidence: signal.confidence,
            reason: signal.reason,
            requiresConfirmation: signal.requiresUserConfirmation
        };
    }

    public async handleMessage(ctx: Context) {
        const conversationId = ctx.chat?.id.toString();
        if (!conversationId) return;

        return runWithTrace(async () => {
            const startedAt = Date.now();
            const logger = this.logger.child({ conversation_id: conversationId, channel: 'telegram' });
            logger.info('message_flow_started', t('log.agent.message_flow_started'), {
                telegram_user_id: ctx.from?.id,
                update_id: ctx.update.update_id
            });

            const payload: CognitiveInputPayload | null = await this.inputHandler.processUpdate(ctx);
            if (!payload) {
                logger.warn('message_ignored', t('log.agent.message_ignored'), {
                    duration_ms: Date.now() - startedAt
                });
                return;
            }

            return SessionManager.runWithSession(conversationId, async () => {
                const progress = this.createTelegramProgressTracker(ctx);
                let answer: string | null = null;
                const session = SessionManager.getCurrentSession();

                // Propagate capability gap signal to session (transient evidence)
                if (session && !session.last_input_gap && payload.capability_gap) {
                    session.last_input_gap = payload.capability_gap;
                    logger.info('capability_gap_signaled', '[COGNITIVE] Sinal de capability gap recebido no input', {
                        capability: payload.capability_gap.capability
                    });
                }

                try {
                    answer = await this.runConversation(conversationId, payload.text, progress.onEvent);
                    await progress.complete();
                } catch (error: any) {
                    await progress.fail(error);
                    logger.error('conversation_execution_failed', error, t('log.agent.conversation_execution_failed'), {
                        duration_ms: Date.now() - startedAt,
                        source_type: payload.source_type
                    });
                    answer = t('agent.error.pipeline', { message: error.message });
                }

                // GARANTIA DE ENTREGA: Sempre tentar enviar resposta, mesmo se houve erro
                if (answer) {
                    try {
                        await this.outputHandler.sendResponse(ctx, answer, payload.requires_audio_reply);
                        logger.info('message_flow_completed', t('log.agent.message_flow_completed'), {
                            duration_ms: Date.now() - startedAt,
                            response_length: answer.length,
                            requires_audio_reply: payload.requires_audio_reply
                        });
                    } catch (sendError: any) {
                        // CRÃTICO: sendResponse falhou completamente (incluindo todos os retries e fallbacks)
                        logger.error('send_response_critical_failure', sendError, t('log.agent.send_response_critical_failure'), {
                            duration_ms: Date.now() - startedAt,
                            response_length: answer.length,
                            error_message: sendError.message
                        });

                        console.error(t('agent.error.delivery_critical_header'));
                        console.error(t('agent.error.delivery_critical_chat', { chatId: conversationId }));
                        console.error(t('agent.error.delivery_critical_error', { message: sendError.message }));
                        console.error(t('agent.error.delivery_critical_response', { length: answer.length }));

                        // Ãšltima tentativa: mensagem de erro mÃ­nima sem retry
                        try {
                            await ctx.reply(t('agent.error.delivery'));
                        } catch {
                            // Ignorar - jÃ¡ logamos tudo que podÃ­amos
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
            logger.info('web_flow_started', t('log.agent.web_flow_started'), {
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
                const lang = this.resolveSessionLanguage(userQuery, SessionManager.getCurrentSession());
                return withLanguage(lang, async () => {
                    try {
                        const answer = await this.runConversation(sessionId, userQuery, emitWebProgress, options?.shouldStop);
                        logger.info('web_flow_completed', t('log.agent.web_flow_completed'), {
                            duration_ms: Date.now() - startedAt,
                            response_length: answer.length
                        });
                        return answer;
                    } catch (error: any) {
                        await emitWebProgress({ stage: 'failed' });
                        logger.error('web_flow_failed', error, t('log.agent.web_flow_failed'), {
                            duration_ms: Date.now() - startedAt
                        });
                        throw error;
                    }
                });
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
                return t('agent.command.new');

            case '/help':
                return t('agent.command.help');

            case '/status': {
                const s = SessionManager.getSession(sessionId);
                const project = s.current_project_id || 'nenhum';
                const msgs = s.conversation_history.length;
                return t('agent.command.status', { sessionId, project, messages: msgs });
            }

            default:
                return t('agent.command.unknown');
        }
    }

    private tryCaptureUserName(lastAgentMessage: string, userMessage: string): void {
        if (!lastAgentMessage || !userMessage) return;

        const question = lastAgentMessage.toLowerCase();
        const askedName =
            question.includes('seu nome') ||
            question.includes('como voce se chama') ||
            question.includes('como vocÃª se chama') ||
            question.includes('qual o seu nome') ||
            question.includes('qual Ã© o seu nome');
        if (!askedName) return;

        const cleaned = userMessage.trim();
        const isValidName =
            cleaned.length >= 2 &&
            cleaned.length <= 40 &&
            /^[\p{L}\s]+$/u.test(cleaned) &&
            cleaned.split(' ').length <= 3;
        if (!isValidName) return;

        const already = this.memory.searchByContent('nome do usuario');
        if (already.length > 0) return;

        this.memory.saveExecutionFix({
            content: `O nome do usuario Ã© ${cleaned}`,
            error_type: 'user_identity',
            fingerprint: `user_name_${cleaned.toLowerCase()}`
        });
        this.logger.info('user_name_captured', t('log.agent.user_name_captured'), { name: cleaned });
    }

    private getUserName(): string | null {
        const nodes = this.memory.searchByContent('nome do usuario');
        if (!nodes.length) return null;
        const match = nodes[0].content?.match(/nome do usuario (?:e|é|Ã©) (.+)/i);
        return match ? match[1].trim() : null;
    }

    private getAssistantName(userId: string): string {
        if (!this.onboardingService) return 'IalClaw';
        const profile = this.onboardingService.getUserProfile(userId);
        return profile?.assistant_name || 'IalClaw';
    }

    private async indexProjectsInMemory(): Promise<void> {
        try {
            const projects = workspaceService.listProjects();
            const existingNodes = this.memory.getProjectNodes(100);
            const indexedIds = new Set(existingNodes.map((n: any) => n.id.replace(/^project:/, '')));

            for (const { id, metadata, files_count } of projects) {
                if (!indexedIds.has(id)) {
                    await this.memory.saveProjectNode({
                        id,
                        name: metadata.name,
                        description: metadata.prompt,
                        files_count
                    });
                    this.logger.info('project_indexed', t('log.agent.project_indexed'), { project_id: id, name: metadata.name });
                }
            }
        } catch (err: any) {
            this.logger.warn('project_index_failed', t('log.agent.project_index_failed'), { error: err.message });
        }
    }

    private async runConversation(
        sessionId: string,
        userQuery: string,
        onProgress?: (event: AgentProgressEvent) => Promise<void> | void,
        shouldStop?: () => boolean,
        isRetry: boolean = false
    ): Promise<string> {
        const startedAt = Date.now();
        const logger = this.logger.child({ conversation_id: sessionId });
        const session = SessionManager.getCurrentSession();

        if (!session) {
            logger.warn('session_not_found', t('log.agent.session_not_found'), {
                conversation_id: sessionId
            });
            return t('agent.session.not_found');
        }

        let effectiveUserQuery = userQuery;
        this.resolveSessionLanguage(userQuery, session, 'user');

        // Extrair e limpar signal de gap (transiente)
        const inputGap = session.last_input_gap;
        if (inputGap) {
            session.last_input_gap = undefined; // Clear immediately to ensure it's transient
            logger.info('consuming_input_gap_signal', '[COGNITIVE] Consumindo sinal de gap para orquestraÃ§Ã£o', {
                capability: inputGap.capability
            });
        }

        // Guard: evitar retry sem contexto vÃ¡lido (edge-case de dupla execuÃ§Ã£o)
        if (isRetry && !session.lastCompletedAction) {
            logger.warn('retry_without_context', '[CONTINUITY] Retry solicitado mas lastCompletedAction ausente, tratando como query normal', {
                query: userQuery.slice(0, 80)
            });
            isRetry = false;
        }

        // NOVO: DetecÃ§Ã£o de intenÃ§Ã£o manual de retry (ex: "tente novamente")
        if (!isRetry && isRetryIntent(userQuery) && session.lastCompletedAction) {
            logger.info('manual_retry_detected', '[CONTINUITY] Detetada intenÃ§Ã£o manual de retry', {
                query: userQuery,
                lastAction: session.lastCompletedAction.type
            });
            isRetry = true;
        }

        // â”€â”€ Roteamento de comandos (antes do LLM) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const commandResponse = this.handleCommand(userQuery, sessionId);
        if (commandResponse) {
            this.memory.saveMessage(sessionId, 'user', userQuery);
            this.memory.saveMessage(sessionId, 'assistant', commandResponse);
            logger.info('command_handled', t('log.agent.command_handled'), {
                command: userQuery.split(' ')[0],
                duration_ms: Date.now() - startedAt
            });
            await this.memory.learn({
                query: userQuery,
                nodes_used: [],
                success: true,
                response: commandResponse
            }).catch(() => { });
            return commandResponse;
        }

        // â”€â”€ Pending action: (Movido para o Orquestrador) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        let pending = getPendingAction(session);

        // [CONTINUITY] DetecÃ§Ã£o de topic shift para limpar aÃ§Ãµes pendentes
        if (pending && shouldDropPendingActionOnTopicShift(userQuery)) {
            logger.info('pending_action_dropped_topic_shift', '[CONTINUITY] MudanÃ§a de assunto detectada, limpando aÃ§Ã£o pendente');
            clearPendingAction(session, pending.id);
            pending = null;
        }

        // â”€â”€ NOVO: ResiliÃªncia de Flow (Registry + Persistence) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (session.flow_state && !this.flowManager.isInFlow()) {
            const flow = FlowRegistry.get(session.flow_state.flowId);
            if (flow) {
                logger.info('flow_resumed_from_session', '[FLOW] Resumindo flow da sessÃ£o', { flowId: flow.id });
                this.flowManager.resume(session.flow_state, flow);
            } else {
                logger.warn('flow_registry_miss', '[FLOW] FlowId nÃ£o encontrado no registry, limpando estado Ã³rfÃ£o', { flowId: session.flow_state.flowId });
                session.flow_state = undefined;
            }
        }
        await this.captureLifecycleMemory(userQuery, {
            sessionId,
            language: session?.language,
            role: 'user',
            projectId: session?.current_project_id,
            recentMessages: session?.conversation_history.map((item) => item.content).slice(-5)
        });
        logger.info('conversation_started', t('log.agent.conversation_started'), {
            cognitive_stage: 'start',
            summary: 'MESSAGE_RECEIVED',
            route: 'conversation',
            query_length: userQuery.length,
            effective_query_length: effectiveUserQuery.length,
            has_current_project: Boolean(session?.current_project_id)
        });

        // â”€â”€ ResoluÃ§Ã£o de skill com sistema robusto â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (this.skillResolver && this.skillResolution) {
            const hasListReference = /(?:essa|esse|a|o|numero|n)\s*[:\-]?\s*\d+/i.test(effectiveUserQuery);
            const hasInstallIntent = /(?:instala|instalar|instale|adicione|adicionar)/i.test(effectiveUserQuery);

            if (!hasListReference && hasInstallIntent) {
                this.skillResolution.clearPendingList();
            }

            const resolution = this.skillResolution.resolve(effectiveUserQuery);

            // Se for apenas um nÃºmero e NÃƒO temos uma lista pendente de skills, 
            // ignoramos a resoluÃ§Ã£o de skill para deixar o LLM tratar como opÃ§Ã£o de chat normal.
            const isJustNumber = /^\d+$/.test(effectiveUserQuery.trim());
            const hasPendingSkills = (this.skillResolution.getPendingList()?.length || 0) > 0;

            if (isJustNumber && !hasPendingSkills) {
                // Deixa passar para o fluxo normal do LLM
            } else {
                if (resolution.action === 'install' && resolution.skillName) {
                    const installer = this.skillResolver.resolve(`instale ${resolution.skillName}`);
                    if (installer) {
                        logger.info('skill_resolved', t('log.agent.skill_resolved'), {
                            skill_name: resolution.skillName
                        });
                        return this.runWithSkill(sessionId, effectiveUserQuery, installer.query, installer.skill, onProgress, shouldStop);
                    }
                }

                if (resolution.action === 'list' && resolution.searchResults) {
                    const listText = this.formatSkillList(resolution.searchResults);
                    this.memory.saveMessage(sessionId, 'assistant', listText);
                    logger.info('skill_list_shown', '[SKILL] Lista de skills apresentada', {
                        count: resolution.searchResults.length
                    });
                    return listText;
                }

                if (resolution.action === 'ask_input' && resolution.message) {
                    this.memory.saveMessage(sessionId, 'assistant', resolution.message);
                    return resolution.message;
                }
            }

            if (resolution.action === 'none') {
                const resolved = this.skillResolver.resolve(effectiveUserQuery);
                if (resolved) {
                    logger.info('skill_resolved', t('log.agent.skill_resolved'), {
                        skill_name: resolved.skill.name
                    });
                    return this.runWithSkill(sessionId, effectiveUserQuery, resolved.query, resolved.skill, onProgress, shouldStop);
                }
            }
        } else if (this.skillResolver) {
            const resolved = this.skillResolver.resolve(effectiveUserQuery);
            if (resolved) {
                logger.info('skill_resolved', t('log.agent.skill_resolved'), {
                    skill_name: resolved.skill.name
                });
                return this.runWithSkill(sessionId, effectiveUserQuery, resolved.query, resolved.skill, onProgress, shouldStop);
            }
        }

        // â”€â”€ DECISÃƒO COGNITIVA (ORQUESTRADOR) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // O Orquestrador centraliza a precedÃªncia: Recovery > Flow > Pending > Normal
        const intent = this.intentClassifier.classify(effectiveUserQuery);
        logger.info('input_intent_classified', '[INTENT] Intenção classificada para contexto do orquestrador', {
            mode: intent.mode,
            confidence: intent.confidence
        });

        const decision = await this.orchestrator.decide({
            input: effectiveUserQuery,
            sessionId,
            intent
        });

        this.logger.info('orchestration_strategy_selected', '[ORCHESTRATOR] EstratÃ©gia selecionada', {
            strategy: decision.strategy,
            reason: decision.reason
        });

        // â”€â”€ ExecuÃ§Ã£o baseada na estratÃ©gia (Delegado ao Orquestrador) â”€â”€â”€â”€â”€â”€
        const execResult = await this.orchestrator.executeDecision(decision, session as any, effectiveUserQuery);

        if (execResult.answer) {
            return execResult.answer;
        }

        if (execResult.retryQuery) {
            // Se houve uma recuperaÃ§Ã£o reativa (Retry), reinicia o loop com a query corrigida
            return await this.runConversation(sessionId, execResult.retryQuery, onProgress, shouldStop, true);
        }

        if (execResult.interrupted) {
            return t('error.agent.execution_interrupted');
        }

        // â”€â”€ Fluxo unificado (AgentLoop) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        console.log(t('log.agent.unified_flow_console'));
        logger.info('unified_flow_started', t('log.agent.unified_flow_started'), {
            cognitive_stage: 'decision',
            decision: decision.strategy,
            has_project: Boolean(session?.current_project_id)
        });

        // MemÃ³ria: embedding â†’ retrieval â†’ identidade â†’ contexto
        const provider = this.loop.getProvider();
        const queryEmbedding = await provider.embed(effectiveUserQuery);

        // â”€â”€ Indexar projetos do workspace na memÃ³ria cognitiva â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        await this.indexProjectsInMemory();

        const memoryNodes = await this.memory.retrieveWithTraversal(effectiveUserQuery, queryEmbedding);
        const identity = await this.memory.getIdentityNodes();
        let contextStr = this.contextBuilder.build({ identity, memory: memoryNodes, policy: {}, chatId: sessionId });

        // â”€â”€ Injetar nome do usuÃ¡rio no contexto â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const userName = this.getUserName();
        if (userName) {
            contextStr += `\nO nome do usuario Ã© ${userName}. Use isso para personalizar a resposta.`;
        }

        // â”€â”€ Injetar projetos conhecidos no contexto â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const projectNodes = this.memory.getProjectNodes(5);
        if (projectNodes.length) {
            const projectLines = projectNodes.map((n: any) => {
                const projectId = n.id.replace(/^project:/, '');
                return `- ${n.name} (id: ${projectId})`;
            }).join('\n');
            contextStr += `\n\nProjetos conhecidos:\n${projectLines}`;
        }

        // â”€â”€ Auto-resolver projeto ativo a partir da memÃ³ria â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (!session?.current_project_id) {
            const projectFromMemory = memoryNodes.find(n => n.subtype === 'project');
            if (projectFromMemory && session) {
                const resolvedId = projectFromMemory.id.replace(/^project:/, '');
                if (workspaceService.projectExists(resolvedId)) {
                    session.current_project_id = resolvedId;
                    logger.info('project_auto_resolved', t('log.agent.project_auto_resolved'), { project_id: resolvedId });
                }
            }
        }

        // â”€â”€ Injetar consciÃªncia de skills no contexto â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        const assistantName = this.getAssistantName(sessionId);

        // â”€â”€ LANGUAGE CONTROL LAYER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const langResolution = resolveLanguage(userQuery, session, 'user');
        const languageDirective = buildLanguageDirective(langResolution.lang);
        this.logger.info('language_directive_injected', '[LCL] Diretiva de idioma injetada no prompt', {
            lang: langResolution.lang,
            detected_from_input: langResolution.detectedFromInput,
            confidence: langResolution.confidence.toFixed(2)
        });

        const messages: MessagePayload[] = [
            {
                role: 'system',
                content: `Voce e o ${assistantName}, um agente cognitivo 100% local.\nVoce tem acesso a tools para executar acoes reais.\nUse tools quando necessario.\nSe for pergunta simples, responda direto.\nNao invente execucao.\nNao alucine fatos.\n\nAntes de usar uma tool, avalie se a acao e realmente executavel com as ferramentas disponiveis.\nSe nao for possivel executar com seguranca ou confianca, NAO tente usar tool.\nEm vez disso, responda explicando como o usuario pode realizar a tarefa.\nNunca entre em loop tentando executar algo que nao esta ao seu alcance.\nSe voce ja tentou usar tools e falhou, responda diretamente sem tentar novamente.\nPrefira ser util explicando do que falhar tentando executar.\n\nSELECAO DE OPCOES:
Quando voce apresentar uma lista numerada de opcoes (ex: 1. Fazer X, 2. Fazer Y), mantenha explicitamente o contexto da acao.
Se o usuario responder apenas com um numero ("1", "2") ou repetir o nome de uma opcao, trate isso como a escolha correspondente a SUA ultima pergunta.
APENAS se nao houver nenhuma lista ativa ou contexto recente, informe educadamente que nao entendeu a selecao.
Nao peca confirmacao redundante.
\n\nGIT E GITHUB:\nNao gere mensagens automaticas pedindo commit, push, PR ou publicacao de branch.\nSo fale sobre commit/push/PR se o usuario pedir isso explicitamente.\nSe o usuario nao pediu GitHub, mantenha foco apenas na tarefa atual.\n\nSe voce nao possui uma skill adequada para resolver a tarefa do usuario, considere que novas skills podem existir.\nAntes de dizer que nao consegue, pense: existe uma skill publica que resolve isso?\nSe fizer sentido, sugira ao usuario buscar ou instalar uma skill apropriada.\nNao instale skills automaticamente sem confirmacao do usuario.\n\nVoce possui memoria persistente baseada em grafo.\nVoce aprende automaticamente informacoes importantes do usuario durante a conversa.\nQuando o usuario compartilha algo relevante (nome, profissao, preferencias), assuma que isso sera armazenado automaticamente.\nVoce PODE afirmar naturalmente que lembra dessas informacoes e que podera usa-las em interacoes futuras.\nNUNCA diga que nao possui memoria, que nao pode salvar informacoes, ou que nao tem essa capacidade.${languageDirective}${projectInfo}${skillsBlock}\n\nContexto relevante:\n${contextStr}`
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
            },
            taskType: session?.task_type,
            taskConfidence: session?.task_confidence,
            intent,
            orchestrationResult: decision // Passamos a decisÃ£o para o loop
        };

        const result = await this.loop.run(messages, policy);

        // â”€â”€ PASSIVE SIGNAL INGESTION (Safe Mode) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // TODO (Single Brain): Ingest signals from AgentLoop for future decision-making.
        // For now, the Orchestrator only OBSERVES without affecting the loop's decisions.
        // When ready for active mode, the Orchestrator will use these signals to decide
        // whether to stop, retry, or continue instead of the AgentLoop deciding locally.
        const signals = this.loop.getSignalsSnapshot();
        this.orchestrator.ingestSignalsFromLoop(signals, sessionId);

        // â”€â”€ ACTIVE DECISION: StopContinue (Controlled Evolution - Safe Mode) â”€â”€â”€â”€â”€â”€â”€
        // Now the Orchestrator ACTIVELY decides on StopContinueSignal
        // This is the first real governance transition: Signal created by AgentLoop,
        // Decision applied by Orchestrator, but fallback preserved in Orchestrator.
        // If orchestrator decision is undefined, AgentLoop's decision stands (automatic fallback).
        const orchestratorStopContinueDecision = this.orchestrator.decideStopContinue(sessionId);
        this.logger.debug('stop_continue_active_decision_checked', '[ACTIVE MODE] StopContinueSignal decisÃ£o do orquestrador recebida', {
            sessionId,
            hasOrchestratorDecision: !!orchestratorStopContinueDecision,
            orchestratorDecision: orchestratorStopContinueDecision ? {
                shouldStop: orchestratorStopContinueDecision.shouldStop,
                reason: orchestratorStopContinueDecision.reason
            } : undefined
        });

        // â”€â”€ ACTIVE DECISION: ToolFallback (ETAPA 4 - Safe Mode) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // O Orchestrator aplica apenas o ToolFallbackSignal observado.
        // undefined => fallback automÃ¡tico ao AgentLoop (sem alteraÃ§Ã£o de comportamento).
        const orchestratorFallbackDecision = this.orchestrator.decideToolFallback(sessionId);
        this.logger.debug('tool_fallback_active_decision_checked', '[ACTIVE MODE] ToolFallbackSignal decisÃ£o do orquestrador recebida', {
            sessionId,
            hasOrchestratorDecision: !!orchestratorFallbackDecision,
            signalFromLoop: signals.fallback ? {
                trigger: signals.fallback.trigger,
                fallbackRecommended: signals.fallback.fallbackRecommended,
                originalTool: signals.fallback.originalTool,
                fallbackTool: signals.fallback.suggestedTool,
                reason: signals.fallback.reason
            } : undefined,
            orchestratorDecision: orchestratorFallbackDecision ? {
                trigger: orchestratorFallbackDecision.trigger,
                fallbackRecommended: orchestratorFallbackDecision.fallbackRecommended,
                originalTool: orchestratorFallbackDecision.originalTool,
                fallbackTool: orchestratorFallbackDecision.suggestedTool,
                reason: orchestratorFallbackDecision.reason
            } : undefined
        });

        // â”€â”€ ACTIVE DECISION: StepValidation (ETAPA 5 - Safe Mode) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // O Orchestrator aplica apenas o StepValidationSignal observado.
        // undefined => fallback automÃ¡tico ao validation jÃ¡ calculado no loop.
        const orchestratorValidationDecision = this.orchestrator.decideStepValidation(sessionId);
        const finalValidationDecision = orchestratorValidationDecision ?? signals.validation;
        this.logger.debug('step_validation_active_decision_checked', '[ACTIVE MODE] StepValidationSignal decisÃ£o do orquestrador recebida', {
            sessionId,
            hasOrchestratorDecision: !!orchestratorValidationDecision,
            loopValidation: signals.validation ? {
                success: signals.validation.validationPassed,
                errors: signals.validation.failureReason,
                confidence: signals.validation.confidence,
                reason: signals.validation.reason,
                requiresLlmReview: signals.validation.requiresLlmReview
            } : undefined,
            orchestratorDecision: orchestratorValidationDecision ? {
                success: orchestratorValidationDecision.validationPassed,
                errors: orchestratorValidationDecision.failureReason,
                confidence: orchestratorValidationDecision.confidence,
                reason: orchestratorValidationDecision.reason,
                requiresLlmReview: orchestratorValidationDecision.requiresLlmReview
            } : undefined,
            appliedValidation: finalValidationDecision ? {
                success: finalValidationDecision.validationPassed,
                errors: finalValidationDecision.failureReason,
                confidence: finalValidationDecision.confidence,
                reason: finalValidationDecision.reason,
                requiresLlmReview: finalValidationDecision.requiresLlmReview
            } : undefined,
            safeModeFallbackApplied: !orchestratorValidationDecision && !!signals.validation
        });

        const routeDecision = this.orchestrator.decideRouteAutonomy(sessionId);
        const finalRoute = routeDecision ?? signals.route;
        this.logger.debug('route_autonomy_active_decision_checked', '[ACTIVE MODE] RouteAutonomySignal decisÃ£o do orquestrador recebida', {
            sessionId,
            loopDecision: this.mapRouteSignalToAuditDecision(signals.route),
            orchestratorDecision: this.mapRouteSignalToAuditDecision(routeDecision),
            appliedDecision: this.mapRouteSignalToAuditDecision(finalRoute),
            safeModeFallbackApplied: !routeDecision && !!signals.route
        });

        // â”€â”€ ACTIVE DECISION: FailSafe (ETAPA 7 - Safe Mode) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // O Orchestrator aplica o FailSafeSignal observado.
        // undefined => fallback automÃ¡tico ao valor gerado pelo loop (sem alteraÃ§Ã£o de comportamento).
        // FailSafe tem PRIORIDADE sobre Route â€” conflito apenas auditado nesta etapa.
        const failSafeDecision = this.orchestrator.decideFailSafe(sessionId);
        const finalFailSafe = failSafeDecision ?? signals.failSafe;
        this.logger.debug('failsafe_active_decision_checked', '[ACTIVE MODE] FailSafeSignal decisÃ£o do orquestrador recebida', {
            sessionId,
            loopDecision: signals.failSafe ? {
                activated: signals.failSafe.activated,
                trigger: signals.failSafe.trigger
            } : undefined,
            orchestratorDecision: failSafeDecision ? {
                activated: failSafeDecision.activated,
                trigger: failSafeDecision.trigger
            } : undefined,
            appliedDecision: finalFailSafe ? {
                activated: finalFailSafe.activated,
                trigger: finalFailSafe.trigger
            } : undefined,
            safeModeFallbackApplied: !failSafeDecision && !!signals.failSafe
        });

        this.orchestrator.auditSignalConsistency(sessionId);

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
        this.updatePendingActionFromResponse(sessionId, effectiveUserQuery, result.answer);

        SessionManager.addToHistory(sessionId, 'user', userQuery);
        SessionManager.addToHistory(sessionId, 'assistant', result.answer);

        // â”€â”€ Captura automÃ¡tica do nome do usuÃ¡rio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const lastMessages = this.memory.getConversationHistory(sessionId, 3);
        const lastAssistantMsg = lastMessages[lastMessages.length - 2]?.content || '';
        this.tryCaptureUserName(lastAssistantMsg, userQuery);

        // DetecÃ§Ã£o direta: "meu nome Ã© X" / "me chamo X"
        const directNameMatch = userQuery.match(/(?:meu nome (?:e|é|Ã©)|me chamo)\s+([\p{L}]+(?:\s+[\p{L}]+)?)/u);
        if (directNameMatch && !this.memory.searchByContent('nome do usuario').length) {
            this.memory.saveExecutionFix({
                content: `O nome do usuario Ã© ${directNameMatch[1].trim()}`,
                error_type: 'user_identity',
                fingerprint: `user_name_${directNameMatch[1].trim().toLowerCase()}`
            });
            logger.info('user_name_captured', t('log.agent.user_name_captured_direct'), { name: directNameMatch[1].trim() });
        }

        await this.captureLifecycleMemory(result.answer, {
            sessionId,
            language: session?.language,
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

        logger.info('unified_flow_completed', t('log.agent.unified_flow_completed'), {
            cognitive_stage: 'result',
            result: 'SUCCESS',
            duration_ms: Date.now() - startedAt,
            response_length: result.answer.length,
            isRetry
        });

        // Clear lastCompletedAction after successful final response
        if (session.lastCompletedAction) {
            logger.info('execution_continuity_completed', '[CONTINUITY] Tarefa original concluÃ­da com sucesso, limpando estado', {
                originalRequest: session.lastCompletedAction.originalRequest,
                isRetry
            });
            session.lastCompletedAction = undefined;
        }

        if (this.skillResolution) {
            this.skillResolution.clearPendingList();
        }

        return result.answer;
    }

    /**
     * Executa a conversa utilizando o contexto de uma skill ativada.
     * O corpo da skill Ã© injetado no system prompt e os caminhos OpenClaw
     * sÃ£o adaptados para o padrÃ£o IalClaw (workspace/skills/<nome>/).
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
            throw new Error(t('error.agent.invalid_loop_provider'));
        }

        // ForÃ§ar tipo de task para skill_installation APENAS se for instalaÃ§Ã£o de skill
        // NÃƒO forÃ§ar se for instalaÃ§Ã£o de pacote do sistema (apt, pip, npm, etc.)
        const isSkillInstallIntent = /(?:instala|instalar|instale)\s+(?:uma\s+)?skill\b/i.test(originalQuery) ||
            /skill\b.*\b(?:instala|instalar|instale)\b/i.test(originalQuery) ||
            /(?:buscar|procurar|encontre)\s+(?:uma\s+)?skill\b/i.test(originalQuery);

        // NÃƒO forÃ§ar se mencionar pacotes do sistema
        const isSystemPackage = /(?:apt|apt-get|pip|npm|yarn|pacote|package)\b/i.test(originalQuery) ||
            /(?:instala|instalar|instale)\s+(?:o|a|os|as)\s+\w+\b/i.test(originalQuery) && !/\bskill\b/i.test(originalQuery);

        if (isSkillInstallIntent && !isSystemPackage) {
            (this.loop as any).forceTaskType('skill_installation', 1.0);
            logger.info('skill_installation_forced', '[FORCE] Tipo de task forÃ§ado para skill_installation');
        }

        // MemÃ³ria: embedding â†’ retrieval â†’ contexto
        const provider = this.loop.getProvider();
        const queryEmbedding = await provider.embed(originalQuery);
        const memoryNodes = await this.memory.retrieveWithTraversal(originalQuery, queryEmbedding);
        const identity = await this.memory.getIdentityNodes();
        const contextStr = this.contextBuilder.build({ identity, memory: memoryNodes, policy: {} });

        // Adapta caminhos OpenClaw para o espaco de trabalho do IalClaw
        const adaptedBody = skill.body.replace(
            /\.agent\/skills\//g,
            'workspace/skills/'
        );

        const assistantName = this.getAssistantName(sessionId);

        // â”€â”€ LANGUAGE CONTROL LAYER (Skill Flow) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const skillLangResolution = resolveLanguage(originalQuery, SessionManager.getCurrentSession(), 'user');
        const skillLanguageDirective = buildLanguageDirective(skillLangResolution.lang);
        this.logger.info('language_directive_injected', '[LCL] Diretiva de idioma injetada no prompt (skill)', {
            lang: skillLangResolution.lang,
            skill: skill.name
        });

        const systemPrompt =
            `Voce e o ${assistantName}, um agente cognitivo 100% local e privado.\n` +
            `A skill abaixo foi ativada pelo usuario. Siga suas instrucoes rigorosamente.\n` +
            `Voce TEM tools disponiveis para executar acoes reais. USE-AS em vez de dizer ao usuario para executar comandos manualmente.\n` +
            `Nao invente resultados â€” execute as tools e relate o resultado real.\n\n` +
            `SELECAO DE OPCOES:\n` +
            `Quando voce apresentar uma lista numerada de opcoes, mantenha explicitamente o contexto da acao antes da lista (ex.: "Essas sao as skills disponiveis para instalacao").\n` +
            `Se o usuario responder apenas com "1", "2" ou repetir o nome de uma opcao, trate isso como escolha direta da lista ativa e execute a acao correspondente imediatamente.\n` +
            `Nao peca confirmacao redundante.\n` +
            `Nao ignore a escolha.\n` +
            `Nao continue conversa generica quando houver uma selecao valida.\n\n` +
            `GIT E GITHUB:\n` +
            `Nao gere mensagens automaticas pedindo commit, push, PR ou publicacao de branch.\n` +
            `So fale sobre commit/push/PR se o usuario pedir isso explicitamente.` +
            `${skillLanguageDirective}\n\n` +
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

        // â”€â”€ PASSIVE SIGNAL INGESTION (Safe Mode) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // TODO (Single Brain): Same as main flow - ingest signals in passive mode.
        const skillSignals = this.loop.getSignalsSnapshot();
        this.orchestrator.ingestSignalsFromLoop(skillSignals, sessionId);

        // â”€â”€ ACTIVE DECISION: StopContinue (Controlled Evolution - Skill Path) â”€â”€â”€â”€â”€â”€â”€
        // Same active governance for skills - consistency across execution paths
        const skillStopContinueDecision = this.orchestrator.decideStopContinue(sessionId);
        this.logger.debug('stop_continue_active_decision_skill', '[ACTIVE MODE] StopContinueSignal decisÃ£o do orquestrador (skill)', {
            sessionId,
            skillName: skill.name,
            hasOrchestratorDecision: !!skillStopContinueDecision,
            orchestratorDecision: skillStopContinueDecision ? {
                shouldStop: skillStopContinueDecision.shouldStop,
                reason: skillStopContinueDecision.reason
            } : undefined
        });

        const skillFallbackDecision = this.orchestrator.decideToolFallback(sessionId);
        this.logger.debug('tool_fallback_active_decision_skill', '[ACTIVE MODE] ToolFallbackSignal decisÃ£o do orquestrador (skill)', {
            sessionId,
            skillName: skill.name,
            hasOrchestratorDecision: !!skillFallbackDecision,
            signalFromLoop: skillSignals.fallback ? {
                trigger: skillSignals.fallback.trigger,
                fallbackRecommended: skillSignals.fallback.fallbackRecommended,
                originalTool: skillSignals.fallback.originalTool,
                fallbackTool: skillSignals.fallback.suggestedTool,
                reason: skillSignals.fallback.reason
            } : undefined,
            orchestratorDecision: skillFallbackDecision ? {
                trigger: skillFallbackDecision.trigger,
                fallbackRecommended: skillFallbackDecision.fallbackRecommended,
                originalTool: skillFallbackDecision.originalTool,
                fallbackTool: skillFallbackDecision.suggestedTool,
                reason: skillFallbackDecision.reason
            } : undefined
        });

        const skillValidationDecision = this.orchestrator.decideStepValidation(sessionId);
        const finalSkillValidationDecision = skillValidationDecision ?? skillSignals.validation;
        this.logger.debug('step_validation_active_decision_skill', '[ACTIVE MODE] StepValidationSignal decisÃ£o do orquestrador (skill)', {
            sessionId,
            skillName: skill.name,
            hasOrchestratorDecision: !!skillValidationDecision,
            loopValidation: skillSignals.validation ? {
                success: skillSignals.validation.validationPassed,
                errors: skillSignals.validation.failureReason,
                confidence: skillSignals.validation.confidence,
                reason: skillSignals.validation.reason,
                requiresLlmReview: skillSignals.validation.requiresLlmReview
            } : undefined,
            orchestratorDecision: skillValidationDecision ? {
                success: skillValidationDecision.validationPassed,
                errors: skillValidationDecision.failureReason,
                confidence: skillValidationDecision.confidence,
                reason: skillValidationDecision.reason,
                requiresLlmReview: skillValidationDecision.requiresLlmReview
            } : undefined,
            appliedValidation: finalSkillValidationDecision ? {
                success: finalSkillValidationDecision.validationPassed,
                errors: finalSkillValidationDecision.failureReason,
                confidence: finalSkillValidationDecision.confidence,
                reason: finalSkillValidationDecision.reason,
                requiresLlmReview: finalSkillValidationDecision.requiresLlmReview
            } : undefined,
            safeModeFallbackApplied: !skillValidationDecision && !!skillSignals.validation
        });

        const skillRouteDecision = this.orchestrator.decideRouteAutonomy(sessionId);
        const finalSkillRoute = skillRouteDecision ?? skillSignals.route;
        this.logger.debug('route_autonomy_active_decision_skill', '[ACTIVE MODE] RouteAutonomySignal decisÃ£o do orquestrador (skill)', {
            sessionId,
            skillName: skill.name,
            loopDecision: this.mapRouteSignalToAuditDecision(skillSignals.route),
            orchestratorDecision: this.mapRouteSignalToAuditDecision(skillRouteDecision),
            appliedDecision: this.mapRouteSignalToAuditDecision(finalSkillRoute),
            safeModeFallbackApplied: !skillRouteDecision && !!skillSignals.route
        });

        // â”€â”€ ACTIVE DECISION: FailSafe (ETAPA 7 - Safe Mode) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Mesmo padrÃ£o do fluxo principal â€” consistÃªncia entre caminhos de execuÃ§Ã£o.
        // FailSafe tem PRIORIDADE sobre Route â€” conflito apenas auditado nesta etapa.
        const skillFailSafeDecision = this.orchestrator.decideFailSafe(sessionId);
        const finalSkillFailSafe = skillFailSafeDecision ?? skillSignals.failSafe;
        this.logger.debug('failsafe_active_decision_skill', '[ACTIVE MODE] FailSafeSignal decisÃ£o do orquestrador (skill)', {
            sessionId,
            skillName: skill.name,
            loopDecision: skillSignals.failSafe ? {
                activated: skillSignals.failSafe.activated,
                trigger: skillSignals.failSafe.trigger
            } : undefined,
            orchestratorDecision: skillFailSafeDecision ? {
                activated: skillFailSafeDecision.activated,
                trigger: skillFailSafeDecision.trigger
            } : undefined,
            appliedDecision: finalSkillFailSafe ? {
                activated: finalSkillFailSafe.activated,
                trigger: finalSkillFailSafe.trigger
            } : undefined,
            safeModeFallbackApplied: !skillFailSafeDecision && !!skillSignals.failSafe
        });

        this.updatePendingActionFromResponse(sessionId, originalQuery, result.answer, skill.name);

        SessionManager.addToHistory(sessionId, 'user', originalQuery);
        SessionManager.addToHistory(sessionId, 'assistant', result.answer);

        this.memory.saveMessage(sessionId, 'assistant', result.answer);
        await this.captureLifecycleMemory(result.answer, {
            sessionId,
            language: SessionManager.getCurrentSession()?.language,
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

        logger.info('skill_completed', t('log.agent.skill_completed'), {
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
            this.logger.debug('memory_lifecycle_capture_failed', t('log.agent.memory_lifecycle_capture_failed'), {
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

        this.logger.info('pending_action_set', t('log.agent.pending_action_set'), {
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
        const asksForConfirmation = /\b(confirma|confirmar|confirmacao|confirmação|confirmac[aÃ£]o|deseja\s+instalar|posso\s+instalar|instalo\?)\b/i.test(assistantAnswer)
            && /\b(instalar|instalacao|instalação|instala[Ã§c][aÃ£]o|skill|habilidade)\b/i.test(assistantAnswer);

        if (!asksForConfirmation) {
            return null;
        }

        const fromAnswer = this.extractSkillNameCandidate(assistantAnswer);
        if (fromAnswer) return fromAnswer;

        const fromUser = this.extractSkillNameCandidate(userInput);
        if (fromUser) return fromUser;

        // Em skill-installer, preservar o Ãºltimo token Ãºtil como fallback
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
            /(?:instalar|instale|instalacao\s+da|instalação\s+da|instala[Ã§c][aÃ£]o\s+da)\s+(?:skill|habilidade)?\s*["'`]?([a-z0-9][a-z0-9\-_]{1,80})["'`]?/i,
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

    private buildPendingActionQuery(action: PendingAction): string {
        if (action.type === 'install_skill') {
            return `instalar skill ${action.payload.skillName}`;
        }
        if (action.type === 'install_capability') {
            return action.payload.originalQuery || t('agent.directive.continue');
        }
        return t('agent.directive.continue');
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

            const connectMsg = t('agent.project.connected', { projectId: projectIdFromPath });

            // Se o input Ã© APENAS um path (sem pedido real), retorna confirmaÃ§Ã£o.
            // Se tem conteÃºdo alÃ©m do path, registra a conexÃ£o e deixa o pipeline processar o pedido.
            const withoutPaths = userQuery.replace(/(?:[A-Za-z]:\\|\/)[^\s"'`]+/g, '').trim();
            if (withoutPaths.length < 5) {
                return `${connectMsg}\n\n${t('agent.project.ask_action')}`;
            }

            this.memory.saveMessage(session.conversation_id, 'assistant', connectMsg);
            // NÃ£o retorna â€” continua para o pipeline processar a mensagem
        }

        if (this.isPuppeteerInstallAuthorization(normalized)) {
            if (!session) {
                return t('agent.session.not_found');
            }

            session.capability_policy_overrides = {
                ...(session.capability_policy_overrides || {}),
                browser_execution: 'auto-install'
            };

            const installed = await skillManager.ensure('browser_execution', 'auto-install');
            if (installed) {
                return t('agent.install.browser.success');
            }

            return t('agent.install.browser.failed');
        }

        // â”€â”€ Decision Gate: intent + contexto â†’ decisÃ£o â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    private resolveSessionLanguage(input: string, session?: ReturnType<typeof SessionManager.getCurrentSession>, source: InputSource = 'unknown'): Lang {
        const resolution = resolveLanguage(input, session, source);
        setLanguage(resolution.lang);
        return resolution.lang;
    }

    private formatProgressMessage(event: AgentProgressEvent): string {
        switch (event.stage) {
            case 'loop_started':
                return t('agent.progress.starting');
            case 'iteration_started':
                return t('agent.progress.iteration', { iteration: event.iteration || 1 });
            case 'llm_started':
                return t('agent.progress.thinking');
            case 'llm_completed':
                return t('agent.progress.analysis_completed');
            case 'tool_started':
                return t('agent.progress.tool_started', { tool: event.tool_name || 'tool' });
            case 'tool_completed':
                return t('agent.progress.tool_completed', { tool: event.tool_name || 'tool' });
            case 'tool_failed':
                return t('agent.progress.tool_failed', { tool: event.tool_name || 'tool' });
            case 'finalizing':
                return t('agent.progress.finalizing');
            case 'completed':
                return t('agent.progress.completed');
            case 'stopped':
                return t('agent.progress.stopped');
            case 'failed':
                return t('agent.progress.failed');
            default:
                return t('agent.progress.processing');
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
                    await emitStatus(t('agent.progress.starting'));
                    break;
                case 'iteration_started':
                    await emitStatus(t('agent.progress.iteration', { iteration: event.iteration || 1 }));
                    break;
                case 'llm_started':
                    await emitStatus(t('agent.progress.thinking'));
                    break;
                case 'tool_started':
                    await emitStatus(t('agent.progress.tool_started', { tool: event.tool_name || 'tool' }));
                    break;
                case 'tool_completed':
                    await emitStatus(t('agent.progress.tool_completed', { tool: event.tool_name || 'tool' }));
                    break;
                case 'tool_failed':
                    await emitStatus(t('agent.progress.tool_failed', { tool: event.tool_name || 'tool' }));
                    break;
                case 'finalizing':
                    await emitStatus(t('agent.progress.finalizing'));
                    break;
                case 'completed':
                    await emitStatus(t('agent.progress.completed'), true);
                    break;
                case 'failed':
                    await emitStatus(t('agent.progress.failed'), true);
                    break;
                case 'stopped':
                    await emitStatus(t('agent.progress.stopped'), true);
                    break;
                default:
                    break;
            }
        };

        const complete = async () => {
            clearInterval(heartbeat);
            await emitStatus(t('agent.progress.completed'), true);
        };

        const fail = async (error: any) => {
            clearInterval(heartbeat);
            await emitStatus(t('agent.error.pipeline', { message: String(error?.message || error) }), true);
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
                this.logger.debug('code_indexing_skipped', t('log.agent.code_indexing_skipped'), {
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

