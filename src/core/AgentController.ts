import { Context } from 'grammy';
import { AgentLoop, AgentProgressEvent } from '../engine/AgentLoop';
import { CognitiveMemory } from '../memory/CognitiveMemory';
import { ContextBuilder } from '../memory/ContextBuilder';
import { CodeIndexer } from '../memory/CodeIndexer';
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

export class AgentController {
    private memory: CognitiveMemory;
    private contextBuilder: ContextBuilder;
    private loop: AgentLoop;
    private inputHandler: TelegramInputHandler;
    private outputHandler: TelegramOutputHandler;
    private skillResolver?: SkillResolver;
    private _codeIndexer?: CodeIndexer;
    private _codeNodesCache = new Map<string, { nodes: import('../memory/CognitiveMemory').NodeResult[]; ts: number }>();
    private readonly CODE_CACHE_TTL_MS = 60_000;
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
        this.inputHandler = inputHandler;
        this.outputHandler = outputHandler;
        this.skillResolver = skillResolver;
    }

    private get codeIndexer(): CodeIndexer {
        if (!this._codeIndexer) {
            this._codeIndexer = new CodeIndexer(this.memory, this.loop.getProvider());
        }
        return this._codeIndexer;
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
                try {
                    const answer = await this.runConversation(conversationId, payload.text, progress.onEvent);
                    await progress.complete();
                    await this.outputHandler.sendResponse(ctx, answer, payload.requires_audio_reply);
                    logger.info('message_flow_completed', 'Resposta enviada ao Telegram com sucesso.', {
                        duration_ms: Date.now() - startedAt,
                        response_length: answer.length,
                        requires_audio_reply: payload.requires_audio_reply
                    });
                } catch (error: any) {
                    await progress.fail(error);
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
                emitDebug('web_progress', {
                    session_id: sessionId,
                    stage: event.stage,
                    iteration: event.iteration,
                    tool_name: event.tool_name,
                    duration_ms: event.duration_ms,
                    message: this.formatProgressMessage(event)
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

    private async runConversation(
        sessionId: string,
        userQuery: string,
        onProgress?: (event: AgentProgressEvent) => Promise<void> | void,
        shouldStop?: () => boolean
    ): Promise<string> {
        const startedAt = Date.now();
        const logger = this.logger.child({ conversation_id: sessionId });
        const session = SessionManager.getCurrentSession();

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
                return this.runWithSkill(sessionId, userQuery, resolved.query, resolved.skill, onProgress, shouldStop);
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

        // ── Fluxo unificado: LLM decide usar tools ou responder direto ──
        console.log('[IALCLAW] Unified flow - LLM decides');
        logger.info('unified_flow_started', 'Fluxo unificado. LLM decide se usa tools.', {
            cognitive_stage: 'decision',
            decision: 'UNIFIED',
            has_project: Boolean(session?.current_project_id)
        });

        // Memória: embedding → retrieval → identidade → contexto
        const provider = this.loop.getProvider();
        const queryEmbedding = await provider.embed(userQuery);
        const memoryNodes = await this.memory.retrieveWithTraversal(userQuery, queryEmbedding);
        const identity = await this.memory.getIdentityNodes();

        // ── Recuperar nós de código do projeto ativo ───────────────────────
        const projectId = session?.current_project_id;
        const codeNodes = projectId ? this.getCachedCodeNodes(projectId) : [];

        let contextStr = this.contextBuilder.build({ identity, memory: memoryNodes, codeNodes, policy: {} });

        // ── Injetar nome do usuário no contexto ────────────────────────────
        const userName = this.getUserName();
        if (userName) {
            contextStr += `\nO nome do usuario é ${userName}. Use isso para personalizar a resposta.`;
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
                content: `Voce e o IalClaw, um agente cognitivo 100% local.\nVoce tem acesso a tools para executar acoes reais.\nUse tools quando necessario.\nSe for pergunta simples, responda direto.\nNao invente execucao.\nNao alucine fatos.\n\nAntes de usar uma tool, avalie se a acao e realmente executavel com as ferramentas disponiveis.\nSe nao for possivel executar com seguranca ou confianca, NAO tente usar tool.\nEm vez disso, responda explicando como o usuario pode realizar a tarefa.\nNunca entre em loop tentando executar algo que nao esta ao seu alcance.\nSe voce ja tentou usar tools e falhou, responda diretamente sem tentar novamente.\nPrefira ser util explicando do que falhar tentando executar.\n\nSe voce nao possui uma skill adequada para resolver a tarefa do usuario, considere que novas skills podem existir.\nAntes de dizer que nao consegue, pense: existe uma skill publica que resolve isso?\nSe fizer sentido, sugira ao usuario buscar ou instalar uma skill apropriada.\nNao instale skills automaticamente sem confirmacao do usuario.\n\nVoce possui memoria persistente baseada em grafo.\nVoce aprende automaticamente informacoes importantes do usuario durante a conversa.\nQuando o usuario compartilha algo relevante (nome, profissao, preferencias), assuma que isso sera armazenado automaticamente.\nVoce PODE afirmar naturalmente que lembra dessas informacoes e que podera usa-las em interacoes futuras.\nNUNCA diga que nao possui memoria, que nao pode salvar informacoes, ou que nao tem essa capacidade.${projectInfo}${skillsBlock}\n\nContexto relevante:\n${contextStr}`
            }
        ];
        for (const msg of history) {
            if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool') {
                messages.push({ role: msg.role, content: msg.content });
            }
        }
        messages.push({ role: 'user', content: userQuery });

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

        await this.memory.learn({
            query: userQuery,
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

        SessionManager.addToHistory(sessionId, 'user', originalQuery);
        SessionManager.addToHistory(sessionId, 'assistant', result.answer);

        this.memory.saveMessage(sessionId, 'assistant', result.answer);
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

    private getCachedCodeNodes(projectId: string): import('../memory/CognitiveMemory').NodeResult[] {
        const cached = this._codeNodesCache.get(projectId);
        if (cached && Date.now() - cached.ts < this.CODE_CACHE_TTL_MS) {
            return cached.nodes;
        }
        const nodes = this.memory.getCodeNodesByProject(projectId);
        this._codeNodesCache.set(projectId, { nodes, ts: Date.now() });
        return nodes;
    }

    private async indexSavedArtifacts(messages: MessagePayload[]): Promise<void> {
        for (const msg of messages) {
            if (msg.tool_name !== 'workspace_save_artifact') continue;
            const args = msg.tool_args;
            if (!args?.project_id || !args?.filename || !args?.content) continue;
            try {
                await this.codeIndexer.indexFile(args.project_id, args.filename, args.content);
                this._codeNodesCache.delete(args.project_id);
                this.logger.debug('code_indexed', 'Arquivo indexado na memoria de codigo.', {
                    project_id: args.project_id,
                    filename: args.filename
                });
            } catch {
                // non-critical — skip silently
            }
        }
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
        let statusMessageId: number | null = null;
        let lastStatusText = '';
        let lastUpdateAt = 0;
        const MIN_UPDATE_INTERVAL_MS = 1200;

        const heartbeat = setInterval(() => {
            ctx.replyWithChatAction('typing').catch(() => undefined);
        }, 4500);

        const updateStatus = async (text: string, force: boolean = false) => {
            if (!chatId) {
                return;
            }

            const now = Date.now();
            if (!force && (text === lastStatusText || now - lastUpdateAt < MIN_UPDATE_INTERVAL_MS)) {
                return;
            }

            const content = `⏳ ${text}`;
            try {
                if (!statusMessageId) {
                    const sent: any = await ctx.reply(content);
                    statusMessageId = sent?.message_id || null;
                } else {
                    await ctx.api.editMessageText(chatId, statusMessageId, content);
                }
                lastStatusText = text;
                lastUpdateAt = now;
            } catch {
                // Se não for possível editar, não interrompe o fluxo principal
            }
        };

        const onEvent = async (event: AgentProgressEvent) => {
            await ctx.replyWithChatAction('typing').catch(() => undefined);

            switch (event.stage) {
                case 'loop_started':
                    await updateStatus('Iniciando análise do pedido...');
                    break;
                case 'iteration_started':
                    await updateStatus(`Processando etapa ${event.iteration || 1}...`);
                    break;
                case 'llm_started':
                    await updateStatus('Pensando na próxima ação...');
                    break;
                case 'tool_started':
                    await updateStatus(`Executando ferramenta: ${event.tool_name || 'tool'}`);
                    break;
                case 'tool_completed':
                    await updateStatus(`Ferramenta concluída: ${event.tool_name || 'tool'}`);
                    break;
                case 'tool_failed':
                    await updateStatus(`Ferramenta falhou: ${event.tool_name || 'tool'}. Tentando recuperar...`);
                    break;
                case 'finalizing':
                    await updateStatus('Finalizando resposta...');
                    break;
                case 'completed':
                    await updateStatus('Concluído. Enviando resposta...', true);
                    break;
                case 'failed':
                    await updateStatus('Falha no processamento.', true);
                    break;
                case 'stopped':
                    await updateStatus('Execucao interrompida pelo usuario.', true);
                    break;
                default:
                    break;
            }
        };

        const complete = async () => {
            clearInterval(heartbeat);
            await updateStatus('Concluído. Enviando resposta...', true);
        };

        const fail = async (error: any) => {
            clearInterval(heartbeat);
            await updateStatus(`Erro no processamento: ${String(error?.message || error)}`, true);
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
