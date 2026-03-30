// Classificação de intenção para onboarding adaptativo
// Permite campos extras como '__skip__' em Partial<UserProfile>
type UserProfileWithSkip = Partial<UserProfile> & { [key: string]: any };

export function classificarEntrada(input: string): Partial<UserProfile> {
    const resposta = input.trim().toLowerCase();
    const result: UserProfileWithSkip = {};

    // Estilo de resposta
    if (/(conciso|curto|resumido|1|short|concise)/i.test(resposta)) {
        result.response_style = 'concise';
    } else if (/(detalhado|longo|explicativo|2|detailed|long)/i.test(resposta)) {
        result.response_style = 'detailed';
    } else if (/(adaptativo|auto|3|adaptive)/i.test(resposta)) {
        result.response_style = 'adaptive';
    }

    // Familiaridade
    if (/(iniciante|1|beginner|basic)/i.test(resposta)) {
        result.familiarity = 'beginner';
    } else if (/(intermediário|intermediario|2|intermediate|medium)/i.test(resposta)) {
        result.familiarity = 'intermediate';
    } else if (/(avançado|avancado|3|advanced|pro|expert)/i.test(resposta)) {
        result.familiarity = 'advanced';
    }

    // Modo de aprendizado
    if (/(sim|yes|ativar|enable|memorizar|aprender|memória|memoria|1)/i.test(resposta)) {
        result.learning_mode = 'enabled';
    } else if (/(não|nao|no|desativar|disable|sem memória|sem memoria|2)/i.test(resposta)) {
        result.learning_mode = 'disabled';
    } else if (/(parcial|feedback|só feedback|apenas feedback|partial|feedback-only|3)/i.test(resposta)) {
        result.learning_mode = 'feedback-only';
    }

    // Integrações
    if (/(github|gitlab|1)/i.test(resposta)) {
        result.integrations = 'github';
    } else if (/(vscode|ide|development|2)/i.test(resposta)) {
        result.integrations = 'vscode';
    } else if (/(google|drive|cloud|3)/i.test(resposta)) {
        result.integrations = 'google_drive';
    } else if (/(api|external|4)/i.test(resposta)) {
        result.integrations = 'external_api';
    } else if (/(nenhuma|none|5)/i.test(resposta)) {
        result.integrations = 'none';
    }

    // Idioma
    if (/(padrão|sistema|pt|br|1)/i.test(resposta)) {
        result.language_preference = 'system';
    } else if (/(inglês|ingles|english|tech|2)/i.test(resposta)) {
        result.language_preference = 'english-tech';
    } else if (/(pergunta|question|dynamic|3)/i.test(resposta)) {
        result.language_preference = 'dynamic';
    }

    // Autonomia
    if (/(conservador|baixo risco|conservative|1)/i.test(resposta)) {
        result.autonomy_level = 'conservative';
    } else if (/(balanceado|equilibrado|balanced|2)/i.test(resposta)) {
        result.autonomy_level = 'balanced';
    } else if (/(confiante|ousado|confident|3)/i.test(resposta)) {
        result.autonomy_level = 'confident';
    }

    // Nome do usuário
    if (/meu nome é|sou |chamo|name is|i am |i'm /i.test(input)) {
        const nome = input.replace(/.*(meu nome é|sou|chamo|name is|i am|i'm)\s*/i, '').split(/[,.!\n]/)[0].trim();
        if (nome.length > 1) result.name = nome;
    }

    // Nome do assistente
    if (/seu nome é|te chamo de|assistant name is|call you /i.test(input)) {
        const nome = input.replace(/.*(seu nome é|te chamo de|assistant name is|call you)\s*/i, '').split(/[,.!\n]/)[0].trim();
        if (nome.length > 1) result.assistant_name = nome;
    }

    // Expertise/contexto
    if (/(professor|engenheiro|dev|designer|médico|advogado|teacher|engineer|developer|doctor|lawyer)/i.test(resposta)) {
        result.expertise = input;
    }

    // Objetivos/goals
    if (/(meu objetivo|quero|preciso|busco|goal|i want|i need|my goal)/i.test(input)) {
        result.goals = input;
    }

    // Pular
    if (/pular|skip|depois|não quero|nao quero|next|proxima|próxima/i.test(resposta)) {
        result['__skip__'] = true;
    }

    // Se nenhum campo foi preenchido e não é intenção de pular, assume que é uma resposta direta
    // Isso evita o loop infinito quando o usuário responde algo simples como "oi"
    const skipWords = ['pular', 'skip', 'depois', 'next', 'proxima', 'próxima'];
    const isSkipIntent = skipWords.some(w => resposta.includes(w));

    if (Object.keys(result).length === 0 && !isSkipIntent && resposta.length >= 2 && resposta.length <= 50) {
        // Trata como nome válido (primeira pergunta do onboarding)
        result.name = input.trim();
    }

    return result;
}
import Database from 'better-sqlite3';
import { createLogger } from '../shared/AppLogger';
import { t } from '../i18n';
import path from 'path';
import os from 'os';

export interface UserProfile {
    user_id: string;
    name: string | null;
    assistant_name: string | null;
    expertise: string | null;
    goals: string | null;
    familiarity: 'beginner' | 'intermediate' | 'advanced' | null;
    response_style: 'concise' | 'detailed' | 'adaptive';
    learning_mode: 'enabled' | 'disabled' | 'feedback-only';
    autonomy_level: 'conservative' | 'balanced' | 'confident';
    workspace_path: string | null;
    integrations: string | null;
    language_preference: 'system' | 'english-tech' | 'dynamic';
    onboarding_completed: number;
    created_at: string;
    updated_at: string;
}

export interface OnboardingState {
    step: number;
    userId: string;
    data: Partial<UserProfile>;
}

const ONBOARDING_STEPS = [
    {
        id: 'name',
        question: (_data: any) => t('onboarding.welcome'),
        parseMode: 'Markdown' as const,
        saveField: 'name'
    },
    {
        id: 'familiarity',
        question: (_data: any) => t('onboarding.familiarity'),
        parseMode: 'Markdown' as const,
        saveField: 'familiarity'
    },
    {
        id: 'expertise',
        question: (_data: any) => t('onboarding.prazer'),
        parseMode: 'Markdown' as const,
        saveField: 'expertise'
    },
    {
        id: 'goals',
        question: (_data: any) => t('onboarding.objetivos'),
        parseMode: 'Markdown' as const,
        saveField: 'goals'
    },
    {
        id: 'response_style',
        question: (_data: any) => t('onboarding.estilo_resposta'),
        parseMode: 'Markdown' as const,
        saveField: 'response_style'
    },
    {
        id: 'autonomy_level',
        question: (_data: any) => t('onboarding.autonomia'),
        parseMode: 'Markdown' as const,
        saveField: 'autonomy_level'
    },
    {
        id: 'workspace_path',
        question: (_data: any) => t('onboarding.workspace'),
        parseMode: 'Markdown' as const,
        saveField: 'workspace_path'
    },
    {
        id: 'integrations',
        question: (_data: any) => t('onboarding.integrations'),
        parseMode: 'Markdown' as const,
        saveField: 'integrations'
    },
    {
        id: 'language_preference',
        question: (_data: any) => t('onboarding.language'),
        parseMode: 'Markdown' as const,
        saveField: 'language_preference'
    }
];

export class OnboardingService {
    private db: Database.Database;
    private logger = createLogger('OnboardingService');
    private states: Map<string, OnboardingState> = new Map();
    private defaultWorkspace: string;

    constructor(db: Database.Database) {
        this.db = db;
        this.defaultWorkspace = path.join(os.homedir(), 'ialclaw', 'workspace');
        this.ensureTable();
    }

    private ensureTable(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS user_profile (
                user_id TEXT PRIMARY KEY,
                name TEXT,
                assistant_name TEXT,
                expertise TEXT,
                goals TEXT,
                response_style TEXT DEFAULT 'adaptive',
                learning_mode TEXT DEFAULT 'feedback-only',
                autonomy_level TEXT DEFAULT 'balanced',
                workspace_path TEXT,
                integrations TEXT,
                language_preference TEXT DEFAULT 'system',
                onboarding_completed INTEGER DEFAULT 0,
                created_at TEXT,
                updated_at TEXT
            )
        `);

        try {
            this.db.exec(`ALTER TABLE user_profile ADD COLUMN assistant_name TEXT`);
        } catch { }
        try {
            this.db.exec(`ALTER TABLE user_profile ADD COLUMN familiarity TEXT`);
        } catch { }
    }

    public isOnboardingCompleted(userId: string): boolean {
        const row = this.db.prepare('SELECT onboarding_completed FROM user_profile WHERE user_id = ?').get(userId) as { onboarding_completed: number } | undefined;
        return row?.onboarding_completed === 1;
    }

    public getUserProfile(userId: string): UserProfile | null {
        return this.db.prepare('SELECT * FROM user_profile WHERE user_id = ?').get(userId) as UserProfile | null;
    }

    public startOnboarding(userId: string): { question: string; parseMode: 'Markdown' | 'HTML' } | null {
        if (this.isOnboardingCompleted(userId)) {
            return null;
        }
        // Estado inicial vazio
        const state: OnboardingState = {
            step: 0,
            userId,
            data: {}
        };
        this.states.set(userId, state);
        return this.getNextAdaptiveQuestion(state.data);
    }

    public processOnboardingAnswer(userId: string, answer: string): { question?: string; parseMode: 'Markdown' | 'HTML'; completed?: boolean; welcomeMessage?: string } | null {
        const state = this.states.get(userId);
        if (!state) {
            if (!this.isOnboardingCompleted(userId)) {
                return this.startOnboarding(userId);
            }
            return null;
        }

        // Classificação adaptativa
        const campos: UserProfileWithSkip = classificarEntrada(answer);
        if (campos && campos['__skip__']) {
            // Usuário optou por pular
            return this.getNextAdaptiveQuestion(state.data);
        }
        Object.assign(state.data, campos);

        // Verifica se já tem dados suficientes (mínimo: nome + familiaridade OU 5 campos)
        const preenchidos = Object.keys(state.data).filter(k => state.data[k as keyof UserProfile]);
        if (preenchidos.length >= 6 || (preenchidos.includes('name') && preenchidos.length >= 2)) {
            // Se o usuário responder a última pergunta, ou se já tiver nome e algo mais, podemos considerar terminar
            // Mas para seguir o fluxo, vamos ser mais criteriosos se ele estiver respondendo as perguntas
            if (preenchidos.length >= 9 || (answer.toLowerCase().includes('finalizar') && preenchidos.includes('name'))) {
                this.completeOnboarding(state);
                const welcomeMsg = this.generateWelcomeMessage(state.data);
                this.states.delete(userId);
                return { completed: true, welcomeMessage: welcomeMsg, parseMode: 'Markdown' };
            }
        }

        // Pergunta próxima informação relevante
        return this.getNextAdaptiveQuestion(state.data);
    }

    // Nova função: sugere próxima pergunta relevante, sempre opcional
    private getNextAdaptiveQuestion(data: Partial<UserProfile>): { question: string; parseMode: 'Markdown' | 'HTML' } {
        // Encontra o primeiro campo não preenchido na ordem do ONBOARDING_STEPS
        for (const step of ONBOARDING_STEPS) {
            if (!data[step.saveField as keyof UserProfile] && step.saveField !== 'assistant_name') {
                const question = typeof step.question === 'function' ? step.question(data) : step.question;
                return {
                    question,
                    parseMode: step.parseMode
                };
            }
        }

        // Se tudo preenchido, finaliza
        return {
            question: this.generateWelcomeMessage(data),
            parseMode: 'Markdown'
        };
    }

    public getOnboardingState(userId: string): OnboardingState | undefined {
        return this.states.get(userId);
    }

    public cancelOnboarding(userId: string): void {
        this.states.delete(userId);
    }

    public resetOnboarding(userId: string): void {
        this.db.prepare('UPDATE user_profile SET onboarding_completed = 0 WHERE user_id = ?').run(userId);
        this.states.delete(userId);
    }

    private getQuestionForStep(step: number, data: Partial<UserProfile>): { question: string; parseMode: 'Markdown' | 'HTML' } | null {
        if (step >= ONBOARDING_STEPS.length) return null;

        const stepConfig = ONBOARDING_STEPS[step];
        const question = typeof stepConfig.question === 'function'
            ? stepConfig.question(data)
            : stepConfig.question;

        return {
            question,
            parseMode: stepConfig.parseMode
        };
    }

    private parseResponseStyle(answer: string): 'concise' | 'detailed' | 'adaptive' {
        const normalized = answer.toLowerCase().trim();
        if (normalized === '1' || normalized.includes('conciso')) return 'concise';
        if (normalized === '2' || normalized.includes('detalhado')) return 'detailed';
        return 'adaptive';
    }

    private parseLearningMode(answer: string): 'enabled' | 'disabled' | 'feedback-only' {
        const normalized = answer.toLowerCase().trim();
        if (normalized === '1' || normalized.includes('sim')) return 'enabled';
        if (normalized === '2' || normalized.includes('não') || normalized.includes('nao')) return 'disabled';
        return 'feedback-only';
    }

    private parseAutonomyLevel(answer: string): 'conservative' | 'balanced' | 'confident' {
        const normalized = answer.toLowerCase().trim();
        if (normalized === '1' || normalized.includes('conservador')) return 'conservative';
        if (normalized === '2' || normalized.includes('balanceado')) return 'balanced';
        return 'confident';
    }

    private parseGoals(answer: string): string {
        const goals: string[] = [];
        const normalized = answer.toLowerCase();

        if (normalized.includes('1') || normalized.includes('código') || normalized.includes('codigo') || normalized.includes('desenvolvimento')) {
            goals.push('desenvolvimento_codigo');
        }
        if (normalized.includes('2') || normalized.includes('pesquisa') || normalized.includes('conhecimento')) {
            goals.push('pesquisa_conhecimento');
        }
        if (normalized.includes('3') || normalized.includes('conteúdo') || normalized.includes('conteudo') || normalized.includes('escrita')) {
            goals.push('criacao_conteudo');
        }
        if (normalized.includes('4') || normalized.includes('tarefa') || normalized.includes('produtividade')) {
            goals.push('gestao_tarefas');
        }
        if (normalized.includes('5') || normalized.includes('busca') || normalized.includes('análise') || normalized.includes('analise')) {
            goals.push('busca_analise');
        }
        if (normalized.includes('6') || normalized.includes('aprendizado') || normalized.includes('tutoria')) {
            goals.push('aprendizado_tutoria');
        }
        if (normalized.includes('7') || normalized.includes('outro')) {
            goals.push('outro');
        }

        if (goals.length === 0) {
            goals.push('geral');
        }

        return JSON.stringify(goals);
    }

    private completeOnboarding(state: OnboardingState): void {
        const now = new Date().toISOString();

        this.db.prepare(`
            INSERT OR REPLACE INTO user_profile
            (user_id, name, assistant_name, expertise, goals, familiarity, response_style, learning_mode, autonomy_level, workspace_path, integrations, language_preference, onboarding_completed, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
            state.userId,
            state.data.name || null,
            state.data.assistant_name || null,
            state.data.expertise || null,
            state.data.goals || null,
            state.data.familiarity || null,
            state.data.response_style || 'adaptive',
            'enabled',
            state.data.autonomy_level || 'balanced',
            state.data.workspace_path || this.defaultWorkspace,
            state.data.integrations || 'none',
            state.data.language_preference || 'system',
            now,
            now
        );

        this.logger.info('onboarding_completed', 'Onboarding concluído', { userId: state.userId });
    }

    private generateWelcomeMessage(data: Partial<UserProfile>): string {
        const name = data.name || t('onboarding.default_name');
        const styleText = data.response_style === 'concise' ? t('onboarding.style.concise') : data.response_style === 'detailed' ? t('onboarding.style.detailed') : t('onboarding.style.adaptive');
        const learningText = data.learning_mode === 'enabled' ? t('onboarding.learning.enabled') : data.learning_mode === 'disabled' ? t('onboarding.learning.disabled') : t('onboarding.learning.partial');

        let goalsText = "produtividade geral";
        if (data.goals) {
            try {
                const goals = JSON.parse(data.goals);
                if (goals.length > 0) {
                    goalsText = goals.map((g: string) => g.replace(/_/g, ' ')).join(', ');
                }
            } catch {
                goalsText = data.goals;
            }
        }

        let suggestionText = t('onboarding.suggestion.default');
        if (data.goals) {
            if (data.goals.includes('desenvolvimento_codigo')) suggestionText = t('onboarding.suggestion.code');
            else if (data.goals.includes('pesquisa_conhecimento')) suggestionText = t('onboarding.suggestion.research');
            else if (data.goals.includes('criacao_conteudo')) suggestionText = t('onboarding.suggestion.content');
        }

        return t('onboarding.finalizacao', {
            name,
            goalsText,
            styleText,
            learningText,
            workspace: data.workspace_path || this.defaultWorkspace,
            suggestionText
        });
    }
}
