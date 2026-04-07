import { Context } from 'grammy';
import { AgentLoop } from '../engine/AgentLoop';
import { AgentProgressEvent, RouteAutonomySignal } from '../engine/AgentLoopTypes';
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
import { ActiveDecisionsResult, CognitiveOrchestrator, CognitiveStrategy } from './orchestrator/CognitiveOrchestrator';
import { getActionRouter } from './autonomy/ActionRouter';
import { FlowRegistry } from './flow/FlowRegistry';
import { IntentClassifier } from './intent/IntentClassifier';

type ConversationContext = {
    contextStr: string;
    languageDirective: string;
    projectInfo: string;
    skillsBlock: string;
    history: ReturnType<CognitiveMemory['getConversationHistory']>;
    assistantName: string;
    memoryNodes: any[];
    conversationMode: 'DEFAULT' | 'SOCIAL';
};

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
            const rank = r.rank ? `⭐ Rank #${r.rank}` : '';
            const installs = r.installs ? `| downloads ${r.installs} instalações` : '';
            text += `${r.name}: ${r.description}\n  ${rank} ${installs}\n  Fonte: ${r.source}\n\n`;
        }
        text += 'Para instalar, digite "instale essa: [nome]" ou "instale o número X"';
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
                        // CRÍTICO: sendResponse falhou completamente (incluindo todos os retries e fallbacks)
                        logger.error('send_response_critical_failure', sendError, t('log.agent.send_response_critical_failure'), {
                            duration_ms: Date.now() - startedAt,
                            response_length: answer.length,
                            error_message: sendError.message
                        });

                        console.error(t('agent.error.delivery_critical_header'));
                        console.error(t('agent.error.delivery_critical_chat', { chatId: conversationId }));
                        console.error(t('agent.error.delivery_critical_error', { message: sendError.message }));
                        console.error(t('agent.error.delivery_critical_response', { length: answer.length }));
                        // Última tentativa: mensagem de erro mínima sem retry
                        try {
                            await ctx.reply(t('agent.error.delivery'));
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
            question.includes('como você se chama') ||
            question.includes('qual o seu nome') ||
            question.includes('qual é o seu nome');
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
            content: `O nome do usuario é ${cleaned}`,
            error_type: 'user_identity',
            fingerprint: `user_name_${cleaned.toLowerCase()}`
        });
        this.logger.info('user_name_captured', t('log.agent.user_name_captured'), { name: cleaned });
    }

    private getUserName(): string | null {
        const nodes = this.memory.searchByContent('nome do usuario');
        if (!nodes.length) return null;
        const match = nodes[0].content?.match(/nome do usuario (?:e|é) (.+)/i);
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

    private async buildConversationContext(
        sessionId: string,
        effectiveUserQuery: string,
        userQuery: string,
        session: NonNullable<ReturnType<typeof SessionManager.getCurrentSession>>,
        conversationMode: 'DEFAULT' | 'SOCIAL' = 'DEFAULT'
    ): Promise<ConversationContext> {
        // TODO KB-022: mover para ContextBuildingSignal no Orchestrator
        const isSocialMode = conversationMode === 'SOCIAL';

        let contextStr = '';
        let skillsBlock = '';
        let projectInfo = '';
        let memoryNodes: any[] = [];

        if (!isSocialMode) {
            const provider = this.loop.getProvider();
            const queryEmbedding = await provider.embed(effectiveUserQuery);

            await this.indexProjectsInMemory();

            memoryNodes = await this.memory.retrieveWithTraversal(effectiveUserQuery, queryEmbedding);
            const identity = await this.memory.getIdentityNodes();
            contextStr = this.contextBuilder.build({ identity, memory: memoryNodes, policy: {}, chatId: sessionId });

            const userName = this.getUserName();
            if (userName) {
                contextStr += `\nO nome do usuario é ${userName}. Use isso para personalizar a resposta.`;
            }

            const projectNodes = this.memory.getProjectNodes(5);
            if (projectNodes.length) {
                const projectLines = projectNodes.map((n: any) => {
                    const projectId = n.id.replace(/^project:/, '');
                    return `- ${n.name} (id: ${projectId})`;
                }).join('\n');
                contextStr += `\n\nProjetos conhecidos:\n${projectLines}`;
            }

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

            projectInfo = session.current_project_id
                ? `\nProjeto ativo: ${session.current_project_id}. Use tools para executar acoes reais nesse projeto.`
                : '';
        } else {
            contextStr = 'Interacao social/casual. Responda de forma curta, natural e amigavel.';
        }

        const history = this.memory.getConversationHistory(sessionId, isSocialMode ? 4 : 10);
        const assistantName = this.getAssistantName(sessionId);

        const langResolution = resolveLanguage(userQuery, session, 'user');
        const languageDirective = buildLanguageDirective(langResolution.lang);
        this.logger.info('language_directive_injected', '[LCL] Diretiva de idioma injetada no prompt', {
            lang: langResolution.lang,
            detected_from_input: langResolution.detectedFromInput,
            confidence: langResolution.confidence.toFixed(2)
        });

        return {
            contextStr,
            languageDirective,
            projectInfo,
            skillsBlock,
            history,
            assistantName,
            memoryNodes,
            conversationMode
        };
    }

    private buildSystemPrompt(context: ConversationContext): MessagePayload[] {
        // TODO KB-022: SystemPrompt deve vir como output de signal do Orchestrator
        if (context.conversationMode === 'SOCIAL') {
            return [
                {
                    role: 'system',
                    content: `Voce e o ${context.assistantName}, um assistente amigavel e objetivo.${context.languageDirective}\n\nMODO SOCIAL:\n- Responda de forma curta e natural (1 a 2 frases)\n- Nao faca introspeccao do sistema\n- Nao liste memoria, projetos ou capacidades internas\n- Nao cite logs, pipelines ou detalhes tecnicos\n- Se o usuario apenas cumprimentar, cumprimente de volta de forma calorosa\n\nContexto:\n${context.contextStr}`
                }
            ];
        }

        return [
            {
                role: 'system',
                content: `Voce e o ${context.assistantName}, um agente cognitivo 100% local.\nVoce tem acesso a tools para executar acoes reais.\nUse tools quando necessario.\nSe for pergunta simples, responda direto.\nNao invente execucao.\nNao alucine fatos.\n\nAntes de usar uma tool, avalie se a acao e realmente executavel com as ferramentas disponiveis.\nSe nao for possivel executar com seguranca ou confianca, NAO tente usar tool.\nEm vez disso, responda explicando como o usuario pode realizar a tarefa.\nNunca entre em loop tentando executar algo que nao esta ao seu alcance.\nSe voce ja tentou usar tools e falhou, responda diretamente sem tentar novamente.\nPrefira ser util explicando do que falhar tentando executar.\n\nSELECAO DE OPCOES:\nQuando voce apresentar uma lista numerada de opcoes (ex: 1. Fazer X, 2. Fazer Y), mantenha explicitamente o contexto da acao.\nSe o usuario responder apenas com um numero ("1", "2") ou repetir o nome de uma opcao, trate isso como a escolha correspondente a SUA ultima pergunta.\nAPENAS se nao houver nenhuma lista ativa ou contexto recente, informe educadamente que nao entendeu a selecao.\nNao peca confirmacao redundante.\n\n\nGIT E GITHUB:\nNao gere mensagens automaticas pedindo commit, push, PR ou publicacao de branch.\nSo fale sobre commit/push/PR se o usuario pedir isso explicitamente.\nSe o usuario nao pediu GitHub, mantenha foco apenas na tarefa atual.\n\nSe voce nao possui uma skill adequada para resolver a tarefa do usuario, considere que novas skills podem existir.\nAntes de dizer que nao consegue, pense: existe uma skill publica que resolve isso?\nSe fizer sentido, sugira ao usuario buscar ou instalar uma skill apropriada.\nNao instale skills automaticamente sem confirmacao do usuario.\n\nVoce possui memoria persistente baseada em grafo.\nVoce aprende automaticamente informacoes importantes do usuario durante a conversa.\nQuando o usuario compartilha algo relevante (nome, profissao, preferencias), assuma que isso sera armazenado automaticamente.\nVoce PODE afirmar naturalmente que lembra dessas informacoes e que podera usa-las em interacoes futuras.\nNUNCA diga que nao possui memoria, que nao pode salvar informacoes, ou que nao tem essa capacidade.${context.languageDirective}${context.projectInfo}${context.skillsBlock}\n\nContexto relevante:\n${context.contextStr}`
            }
        ];
    }

    private async executeDirectBypass(messages: MessagePayload[]): Promise<{ answer: string; newMessages: MessagePayload[] }> {
        const provider = this.loop.getProvider();
        const response = await provider.generate(messages);
        const answer = response.final_answer?.trim() || t('error.agent.execution_interrupted');

        return {
            answer,
            newMessages: [{ role: 'assistant', content: answer }]
        };
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

        // Apenas observa o signal; consumo real ocorre no Final Gate do Orchestrator.
        const inputGap = session.last_input_gap;
        if (inputGap) {
            logger.info('input_gap_signal_available', t('log.agent.input_gap_signal_available'), {
                capability: inputGap.capability
            });
        }

        // Guard: evitar retry sem contexto válido (edge-case de dupla execução)
        if (isRetry && !session.lastCompletedAction) {
            logger.warn('retry_without_context', '[CONTINUITY] Retry solicitado mas lastCompletedAction ausente, tratando como query normal', {
                query: userQuery.slice(0, 80)
            });
            isRetry = false;
        }

        // NOVO: Detecção de intenção manual de retry (ex: "tente novamente")
        if (!isRetry && isRetryIntent(userQuery) && session.lastCompletedAction) {
            logger.info('manual_retry_detected', '[CONTINUITY] Detetada intenção manual de retry', {
                query: userQuery,
                lastAction: session.lastCompletedAction.type
            });
            isRetry = true;
        }
        // -- Roteamento de comandos (antes do LLM)
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
        // -- Pending action: (Movido para o Orquestrador)
        let pending = getPendingAction(session);

        // [CONTINUITY] Detecção de topic shift para limpar ações pendentes
        if (pending && shouldDropPendingActionOnTopicShift(userQuery)) {
            logger.info('pending_action_dropped_topic_shift', '[CONTINUITY] Mudança de assunto detectada, limpando ação pendente');
            clearPendingAction(session, pending.id);
            pending = null;
        }
        // -- NOVO: Resiliência de Flow (Registry + Persistence)
        if (session.flow_state && !this.flowManager.isInFlow()) {
            const flow = FlowRegistry.get(session.flow_state.flowId);
            if (flow) {
                logger.info('flow_resumed_from_session', '[FLOW] Resumindo flow da sessão', { flowId: flow.id });
                this.flowManager.resume(session.flow_state, flow);
            } else {
                logger.warn('flow_registry_miss', '[FLOW] FlowId não encontrado no registry, limpando estado órfão', { flowId: session.flow_state.flowId });
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
        // -- Resolução de skill com sistema robusto
        if (this.skillResolver && this.skillResolution) {
            const hasListReference = /(?:essa|esse|a|o|numero|n)\s*[:\-]?\s*\d+/i.test(effectiveUserQuery);
            const hasInstallIntent = /(?:instala|instalar|instale|adicione|adicionar)/i.test(effectiveUserQuery);

            if (!hasListReference && hasInstallIntent) {
                this.skillResolution.clearPendingList();
            }

            const resolution = this.skillResolution.resolve(effectiveUserQuery);

            // Se for apenas um número e NAO temos uma lista pendente de skills, 
            // ignoramos a resolução de skill para deixar o LLM tratar como opção de chat normal.
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
        // -- DECISAO COGNITIVA (ORQUESTRADOR)
        // O Orquestrador centraliza a precedência: Recovery > Flow > Pending > Normal
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

        this.logger.info('orchestration_strategy_selected', '[ORCHESTRATOR] Estratégia selecionada', {
            strategy: decision.strategy,
            reason: decision.reason
        });
        // -- Execução baseada na estratégia (Delegado ao Orquestrador)
        const execResult = await this.orchestrator.executeDecision(decision, session as any, effectiveUserQuery);

        if (execResult.answer) {
            return execResult.answer;
        }

        if (execResult.retryQuery) {
            // Se houve uma recuperação reativa (Retry), reinicia o loop com a query corrigida
            return await this.runConversation(sessionId, execResult.retryQuery, onProgress, shouldStop, true);
        }

        if (execResult.interrupted) {
            return t('error.agent.execution_interrupted');
        }
        // -- Fluxo unificado (AgentLoop)
        console.log(t('log.agent.unified_flow_console'));
        logger.info('unified_flow_started', t('log.agent.unified_flow_started'), {
            cognitive_stage: 'decision',
            decision: decision.strategy,
            has_project: Boolean(session?.current_project_id)
        });

        const conversationMode: 'DEFAULT' | 'SOCIAL' = decision.skipPlanning === true ? 'SOCIAL' : 'DEFAULT';
        const conversationContext = await this.buildConversationContext(sessionId, effectiveUserQuery, userQuery, session, conversationMode);

        // Auto-resolver projeto ativo a partir da memória.
        if (conversationMode !== 'SOCIAL' && !session?.current_project_id) {
            const projectFromMemory = conversationContext.memoryNodes.find(n => n.subtype === 'project');
            if (projectFromMemory && session) {
                const resolvedId = projectFromMemory.id.replace(/^project:/, '');
                if (workspaceService.projectExists(resolvedId)) {
                    session.current_project_id = resolvedId;
                    logger.info('project_auto_resolved', t('log.agent.project_auto_resolved'), { project_id: resolvedId });
                }
            }
        }
        const messages = this.buildSystemPrompt(conversationContext);
        for (const msg of conversationContext.history) {
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
            orchestrationResult: decision // Passamos a decisão para o loop
        };
        const shouldBypassLoop = decision.skipPlanning === true;
        let result: { answer: string; newMessages: MessagePayload[] };

        if (shouldBypassLoop) {
            this.logger.info('small_talk_hard_bypass_activated', '[ORCHESTRATOR] Hard bypass do AgentLoop ativado por skipPlanning', {
                sessionId,
                reason: decision.reason,
                strategy: decision.strategy,
                skipToolLoop: decision.skipToolLoop === true
            });
            result = await this.executeDirectBypass(messages);
        } else {
            result = await this.loop.run(messages, policy);

            // PASSIVE SIGNAL INGESTION (Safe Mode)
            // TODO (Single Brain): Ingest signals from AgentLoop for future decision-making.
            // For now, the Orchestrator only OBSERVES without affecting the loop's decisions.
            // When ready for active mode, the Orchestrator will use these signals to decide
            // whether to stop, retry, or continue instead of the AgentLoop deciding locally.
            const signals = this.loop.getSignalsSnapshot();
            this.orchestrator.ingestSignalsFromLoop(signals, sessionId);
            const activeDecisions: ActiveDecisionsResult = this.orchestrator.applyActiveDecisions(sessionId);

            // ACTIVE DECISION: StopContinue (Controlled Evolution - Safe Mode)
            // Now the Orchestrator ACTIVELY decides on StopContinueSignal
            // This is the first real governance transition: Signal created by AgentLoop,
            // Decision applied by Orchestrator, but fallback preserved in Orchestrator.
            // If orchestrator decision is undefined, AgentLoop's decision stands (automatic fallback).
            const orchestratorStopContinueDecision = activeDecisions.orchestrator.stop;
            this.logger.debug('stop_continue_active_decision_checked', '[ACTIVE MODE] StopContinueSignal decisão do orquestrador recebida', {
                sessionId,
                hasOrchestratorDecision: !!orchestratorStopContinueDecision,
                orchestratorDecision: orchestratorStopContinueDecision ? {
                    shouldStop: orchestratorStopContinueDecision.shouldStop,
                    reason: orchestratorStopContinueDecision.reason
                } : undefined
            });

            // ACTIVE DECISION: ToolFallback (ETAPA 4 - Safe Mode)
            // O Orchestrator aplica apenas o ToolFallbackSignal observado.
            // undefined => fallback automático ao AgentLoop (sem alteração de comportamento).
            const orchestratorFallbackDecision = activeDecisions.orchestrator.fallback;
            this.logger.debug('tool_fallback_active_decision_checked', '[ACTIVE MODE] ToolFallbackSignal decisão do orquestrador recebida', {
                sessionId,
                hasOrchestratorDecision: !!orchestratorFallbackDecision,
                signalFromLoop: activeDecisions.loop.fallback ? {
                    trigger: activeDecisions.loop.fallback.trigger,
                    fallbackRecommended: activeDecisions.loop.fallback.fallbackRecommended,
                    originalTool: activeDecisions.loop.fallback.originalTool,
                    fallbackTool: activeDecisions.loop.fallback.suggestedTool,
                    reason: activeDecisions.loop.fallback.reason
                } : undefined,
                orchestratorDecision: orchestratorFallbackDecision ? {
                    trigger: orchestratorFallbackDecision.trigger,
                    fallbackRecommended: orchestratorFallbackDecision.fallbackRecommended,
                    originalTool: orchestratorFallbackDecision.originalTool,
                    fallbackTool: orchestratorFallbackDecision.suggestedTool,
                    reason: orchestratorFallbackDecision.reason
                } : undefined
            });

            // ACTIVE DECISION: StepValidation (ETAPA 5 - Safe Mode)
            // O Orchestrator aplica apenas o StepValidationSignal observado.
            // undefined => fallback automático ao validation já calculado no loop.
            const orchestratorValidationDecision = activeDecisions.orchestrator.validation;
            const finalValidationDecision = activeDecisions.applied.validation;
            this.logger.debug('step_validation_active_decision_checked', '[ACTIVE MODE] StepValidationSignal decisão do orquestrador recebida', {
                sessionId,
                hasOrchestratorDecision: !!orchestratorValidationDecision,
                loopValidation: activeDecisions.loop.validation ? {
                    success: activeDecisions.loop.validation.validationPassed,
                    errors: activeDecisions.loop.validation.failureReason,
                    confidence: activeDecisions.loop.validation.confidence,
                    reason: activeDecisions.loop.validation.reason,
                    requiresLlmReview: activeDecisions.loop.validation.requiresLlmReview
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
                safeModeFallbackApplied: activeDecisions.safeModeFallbackApplied.validation
            });

            const routeDecision = activeDecisions.orchestrator.route;
            const finalRoute = activeDecisions.applied.route;
            this.logger.debug('route_autonomy_active_decision_checked', '[ACTIVE MODE] RouteAutonomySignal decisão do orquestrador recebida', {
                sessionId,
                loopDecision: this.mapRouteSignalToAuditDecision(activeDecisions.loop.route),
                orchestratorDecision: this.mapRouteSignalToAuditDecision(routeDecision),
                appliedDecision: this.mapRouteSignalToAuditDecision(finalRoute),
                safeModeFallbackApplied: activeDecisions.safeModeFallbackApplied.route
            });

            // ACTIVE DECISION: FailSafe (ETAPA 7 - Safe Mode)
            // O Orchestrator aplica o FailSafeSignal observado.
            // undefined => fallback automático ao valor gerado pelo loop (sem alteração de comportamento).
            // FailSafe tem PRIORIDADE sobre Route; conflito apenas auditado nesta etapa.
            const failSafeDecision = activeDecisions.orchestrator.failSafe;
            const finalFailSafe = activeDecisions.applied.failSafe;
            this.logger.debug('failsafe_active_decision_checked', '[ACTIVE MODE] FailSafeSignal decisão do orquestrador recebida', {
                sessionId,
                loopDecision: activeDecisions.loop.failSafe ? {
                    activated: activeDecisions.loop.failSafe.activated,
                    trigger: activeDecisions.loop.failSafe.trigger
                } : undefined,
                orchestratorDecision: failSafeDecision ? {
                    activated: failSafeDecision.activated,
                    trigger: failSafeDecision.trigger
                } : undefined,
                appliedDecision: finalFailSafe ? {
                    activated: finalFailSafe.activated,
                    trigger: finalFailSafe.trigger
                } : undefined,
                safeModeFallbackApplied: activeDecisions.safeModeFallbackApplied.failSafe
            });

            this.orchestrator.auditSignalConsistency(sessionId);
        }

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

        // Captura automática do nome do usuário.
        const lastMessages = this.memory.getConversationHistory(sessionId, 3);
        const lastAssistantMsg = lastMessages[lastMessages.length - 2]?.content || '';
        this.tryCaptureUserName(lastAssistantMsg, userQuery);

        // Detecção direta: "meu nome é X" / "me chamo X"
        const directNameMatch = userQuery.match(/(?:meu nome (?:e|é)|me chamo)\s+([\p{L}]+(?:\s+[\p{L}]+)?)/u);
        if (directNameMatch && !this.memory.searchByContent('nome do usuario').length) {
            this.memory.saveExecutionFix({
                content: `O nome do usuario é ${directNameMatch[1].trim()}`,
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
            nodes_used: conversationContext.memoryNodes,
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
            logger.info('execution_continuity_completed', '[CONTINUITY] Tarefa original concluída com sucesso, limpando estado', {
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
            throw new Error(t('error.agent.invalid_loop_provider'));
        }

        // Forçar tipo de task para skill_installation APENAS se for instalação de skill
        // NAO forçar se for instalação de pacote do sistema (apt, pip, npm, etc.)
        const isSkillInstallIntent = /(?:instala|instalar|instale)\s+(?:uma\s+)?skill\b/i.test(originalQuery) ||
            /skill\b.*\b(?:instala|instalar|instale)\b/i.test(originalQuery) ||
            /(?:buscar|procurar|encontre)\s+(?:uma\s+)?skill\b/i.test(originalQuery);

        // NAO forçar se mencionar pacotes do sistema
        const isSystemPackage = /(?:apt|apt-get|pip|npm|yarn|pacote|package)\b/i.test(originalQuery) ||
            /(?:instala|instalar|instale)\s+(?:o|a|os|as)\s+\w+\b/i.test(originalQuery) && !/\bskill\b/i.test(originalQuery);

        if (isSkillInstallIntent && !isSystemPackage) {
            (this.loop as any).forceTaskType('skill_installation', 1.0);
            logger.info('skill_installation_forced', '[FORCE] Tipo de task forçado para skill_installation');
        }

        // Memória: embedding -> retrieval -> contexto
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

        // LANGUAGE CONTROL LAYER (Skill Flow)
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
            `Nao invente resultados; execute as tools e relate o resultado real.\n\n` +
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

        // PASSIVE SIGNAL INGESTION (Safe Mode)
        // TODO (Single Brain): Same as main flow - ingest signals in passive mode.
        const skillSignals = this.loop.getSignalsSnapshot();
        this.orchestrator.ingestSignalsFromLoop(skillSignals, sessionId);
        const activeDecisions: ActiveDecisionsResult = this.orchestrator.applyActiveDecisions(sessionId);

        // ACTIVE DECISION: StopContinue (Controlled Evolution - Skill Path)
        // Same active governance for skills - consistency across execution paths
        const skillStopContinueDecision = activeDecisions.orchestrator.stop;
        this.logger.debug('stop_continue_active_decision_skill', '[ACTIVE MODE] StopContinueSignal decisão do orquestrador (skill)', {
            sessionId,
            skillName: skill.name,
            hasOrchestratorDecision: !!skillStopContinueDecision,
            orchestratorDecision: skillStopContinueDecision ? {
                shouldStop: skillStopContinueDecision.shouldStop,
                reason: skillStopContinueDecision.reason
            } : undefined
        });

        const skillFallbackDecision = activeDecisions.orchestrator.fallback;
        this.logger.debug('tool_fallback_active_decision_skill', '[ACTIVE MODE] ToolFallbackSignal decisão do orquestrador (skill)', {
            sessionId,
            skillName: skill.name,
            hasOrchestratorDecision: !!skillFallbackDecision,
            signalFromLoop: activeDecisions.loop.fallback ? {
                trigger: activeDecisions.loop.fallback.trigger,
                fallbackRecommended: activeDecisions.loop.fallback.fallbackRecommended,
                originalTool: activeDecisions.loop.fallback.originalTool,
                fallbackTool: activeDecisions.loop.fallback.suggestedTool,
                reason: activeDecisions.loop.fallback.reason
            } : undefined,
            orchestratorDecision: skillFallbackDecision ? {
                trigger: skillFallbackDecision.trigger,
                fallbackRecommended: skillFallbackDecision.fallbackRecommended,
                originalTool: skillFallbackDecision.originalTool,
                fallbackTool: skillFallbackDecision.suggestedTool,
                reason: skillFallbackDecision.reason
            } : undefined
        });

        const skillValidationDecision = activeDecisions.orchestrator.validation;
        const finalSkillValidationDecision = activeDecisions.applied.validation;
        this.logger.debug('step_validation_active_decision_skill', '[ACTIVE MODE] StepValidationSignal decisão do orquestrador (skill)', {
            sessionId,
            skillName: skill.name,
            hasOrchestratorDecision: !!skillValidationDecision,
            loopValidation: activeDecisions.loop.validation ? {
                success: activeDecisions.loop.validation.validationPassed,
                errors: activeDecisions.loop.validation.failureReason,
                confidence: activeDecisions.loop.validation.confidence,
                reason: activeDecisions.loop.validation.reason,
                requiresLlmReview: activeDecisions.loop.validation.requiresLlmReview
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
            safeModeFallbackApplied: activeDecisions.safeModeFallbackApplied.validation
        });

        const skillRouteDecision = activeDecisions.orchestrator.route;
        const finalSkillRoute = activeDecisions.applied.route;
        this.logger.debug('route_autonomy_active_decision_skill', '[ACTIVE MODE] RouteAutonomySignal decisão do orquestrador (skill)', {
            sessionId,
            skillName: skill.name,
            loopDecision: this.mapRouteSignalToAuditDecision(activeDecisions.loop.route),
            orchestratorDecision: this.mapRouteSignalToAuditDecision(skillRouteDecision),
            appliedDecision: this.mapRouteSignalToAuditDecision(finalSkillRoute),
            safeModeFallbackApplied: activeDecisions.safeModeFallbackApplied.route
        });

        // ACTIVE DECISION: FailSafe (ETAPA 7 - Safe Mode)
        // Mesmo padrão do fluxo principal; consistência entre caminhos de execução.
        // FailSafe tem PRIORIDADE sobre Route; conflito apenas auditado nesta etapa.
        const skillFailSafeDecision = activeDecisions.orchestrator.failSafe;
        const finalSkillFailSafe = activeDecisions.applied.failSafe;
        this.logger.debug('failsafe_active_decision_skill', '[ACTIVE MODE] FailSafeSignal decisão do orquestrador (skill)', {
            sessionId,
            skillName: skill.name,
            loopDecision: activeDecisions.loop.failSafe ? {
                activated: activeDecisions.loop.failSafe.activated,
                trigger: activeDecisions.loop.failSafe.trigger
            } : undefined,
            orchestratorDecision: skillFailSafeDecision ? {
                activated: skillFailSafeDecision.activated,
                trigger: skillFailSafeDecision.trigger
            } : undefined,
            appliedDecision: finalSkillFailSafe ? {
                activated: finalSkillFailSafe.activated,
                trigger: finalSkillFailSafe.trigger
            } : undefined,
            safeModeFallbackApplied: activeDecisions.safeModeFallbackApplied.failSafe
        });

        this.orchestrator.auditSignalConsistency(sessionId);

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
        const asksForConfirmation = /\b(confirma|confirmar|confirmacao|confirmacao|confirmação|confirmac[aã]o|deseja\s+instalar|posso\s+instalar|instalo\?)\b/i.test(assistantAnswer)
            && /\b(instalar|instalacao|instalação|instala[çc][aã]o|skill|habilidade)\b/i.test(assistantAnswer);

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
            /(?:instalar|instale|instalacao\s+da|instalação\s+da|instala[çc][aã]o\s+da)\s+(?:skill|habilidade)?\s*["'`]?([a-z0-9][a-z0-9\-_]{1,80})["'`]?/i,
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

            // Se o input é APENAS um path (sem pedido real), retorna confirmação.
            // Se tem conteúdo além do path, registra a conexão e deixa o pipeline processar o pedido.
            const withoutPaths = userQuery.replace(/(?:[A-Za-z]:\\|\/)[^\s"'`]+/g, '').trim();
            if (withoutPaths.length < 5) {
                return `${connectMsg}\n\n${t('agent.project.ask_action')}`;
            }

            this.memory.saveMessage(session.conversation_id, 'assistant', connectMsg);
            // Não retorna; continua para o pipeline processar a mensagem
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

        // Decision Gate: intent + contexto -> decisão
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



