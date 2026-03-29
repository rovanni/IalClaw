import Database from 'better-sqlite3';
import { createLogger } from '../shared/AppLogger';
import { t } from '../i18n';
import path from 'path';
import os from 'os';

export interface UserProfile {
    user_id: string;
    name: string | null;
    expertise: string | null;
    goals: string | null;
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
        question: () => t('onboarding.welcome'),
        parseMode: 'Markdown' as const,
        saveField: 'name'
    },
    {
        id: 'expertise',
        question: (data: any) => t('onboarding.prazer', { name: data.name || '' }),
        parseMode: 'Markdown' as const,
        saveField: 'expertise'
    },
    {
        id: 'goals',
        question: () => t('onboarding.objetivos'),
        parseMode: 'Markdown' as const,
        saveField: 'goals'
    },
    {
        id: 'response_style',
        question: () => t('onboarding.estilo_resposta'),
        parseMode: 'Markdown' as const,
        saveField: 'response_style'
    },
    {
        id: 'learning_mode',
        question: () => t('onboarding.aprendizado'),
        parseMode: 'Markdown' as const,
        saveField: 'learning_mode'
    },
    {
        id: 'autonomy_level',
        question: () => t('onboarding.autonomia'),
        parseMode: 'Markdown' as const,
        saveField: 'autonomy_level'
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

        const state: OnboardingState = {
            step: 0,
            userId,
            data: {}
        };

        this.states.set(userId, state);
        return this.getQuestionForStep(0, state.data);
    }

    public processOnboardingAnswer(userId: string, answer: string): { question?: string; parseMode: 'Markdown' | 'HTML'; completed?: boolean; welcomeMessage?: string } | null {
        const state = this.states.get(userId);

        if (!state) {
            if (!this.isOnboardingCompleted(userId)) {
                return this.startOnboarding(userId);
            }
            return null;
        }

        const currentStep = ONBOARDING_STEPS[state.step];
        const fieldName = currentStep.saveField;

        if (fieldName === 'response_style') {
            state.data[fieldName] = this.parseResponseStyle(answer);
        } else if (fieldName === 'learning_mode') {
            state.data[fieldName] = this.parseLearningMode(answer);
        } else if (fieldName === 'autonomy_level') {
            state.data[fieldName] = this.parseAutonomyLevel(answer);
        } else if (fieldName === 'goals') {
            state.data[fieldName] = this.parseGoals(answer);
        } else {
            (state.data as any)[fieldName] = answer.trim();
        }

        state.step++;

        if (state.step >= ONBOARDING_STEPS.length) {
            this.completeOnboarding(state);
            const welcomeMsg = this.generateWelcomeMessage(state.data);
            this.states.delete(userId);
            return { completed: true, welcomeMessage: welcomeMsg, parseMode: 'Markdown' };
        }

        const nextQuestion = this.getQuestionForStep(state.step, state.data);
        if (nextQuestion) {
            return { ...nextQuestion, completed: false };
        }

        return null;
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
            (user_id, name, expertise, goals, response_style, learning_mode, autonomy_level, workspace_path, language_preference, onboarding_completed, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
            state.userId,
            state.data.name || null,
            state.data.expertise || null,
            state.data.goals || null,
            state.data.response_style || 'adaptive',
            state.data.learning_mode || 'feedback-only',
            state.data.autonomy_level || 'balanced',
            this.defaultWorkspace,
            'system',
            now,
            now
        );

        this.logger.info('onboarding_completed', 'Onboarding concluído', { userId: state.userId });
    }

    private generateWelcomeMessage(data: Partial<UserProfile>): string {
        const name = data.name || t('onboarding.default_name');
        const styleText = data.response_style === 'concise' ? t('onboarding.style.concise') : data.response_style === 'detailed' ? t('onboarding.style.detailed') : t('onboarding.style.adaptive');
        const learningText = data.learning_mode === 'enabled' ? t('onboarding.learning.enabled') : data.learning_mode === 'disabled' ? t('onboarding.learning.disabled') : t('onboarding.learning.partial');
        const autonomyText = data.autonomy_level === 'conservative' ? t('onboarding.autonomy.conservative') : data.autonomy_level === 'confident' ? t('onboarding.autonomy.confident') : t('onboarding.autonomy.balanced');

        let suggestionText = t('onboarding.suggestion.default');
        if (data.goals) {
            try {
                const goals = JSON.parse(data.goals);
                if (goals.includes('desenvolvimento_codigo') || goals.includes('code_development')) {
                    suggestionText = t('onboarding.suggestion.code');
                } else if (goals.includes('pesquisa_conhecimento') || goals.includes('research')) {
                    suggestionText = t('onboarding.suggestion.research');
                } else if (goals.includes('criacao_conteudo') || goals.includes('content')) {
                    suggestionText = t('onboarding.suggestion.content');
                }
            } catch {
                // ignore
            }
        }

        return t('onboarding.pronto', {
            name,
            styleText,
            learningText,
            autonomyText,
            workspace: this.defaultWorkspace,
            suggestionText
        });
    }
}
