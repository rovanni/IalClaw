import { createLogger } from '../shared/AppLogger';
import { MemoryService } from './MemoryService';
import {
    AgentMemoryContext,
    MemoryCaptureResult,
    MemoryQueryOptions,
    MemoryQueryResult,
    MemoryType
} from './MemoryTypes';
import { t } from '../i18n';

type InputAnalysis = {
    explicitRequest: boolean;
    containsEntity: boolean;
    hasTechnicalDecision: boolean;
    isRepeated: boolean;
    isStrategic: boolean;
    score: number;
};

export class MemoryLifecycleManager {
    private memoryService: MemoryService;
    private logger = createLogger('MemoryLifecycleManager');
    private topicFrequency = new Map<string, number>();

    private readonly explicitTriggers = [
        'lembre disso',
        'guarde isso',
        'isso é importante',
        'isso e importante',
        'remember this',
        'save this'
    ];

    private readonly stopWords = new Set([
        'de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'é', 'eh',
        'um', 'uma', 'para', 'com', 'sem', 'que', 'isso', 'isto', 'essa', 'esse',
        'the', 'and', 'for', 'with', 'from', 'this', 'that', 'you', 'your'
    ]);

    constructor(memoryService: MemoryService) {
        this.memoryService = memoryService;
    }

    public async processInput(input: string, context: AgentMemoryContext): Promise<MemoryCaptureResult> {
        const raw = String(input || '').trim();
        if (!raw) {
            return { stored: false, score: 0, reason: 'empty_input' };
        }

        const sanitized = this.sanitizeSensitive(raw);
        const isSensitive = this.isSensitive(raw);
        if (isSensitive && !sanitized.changed) {
            return { stored: false, score: 0, reason: 'blocked_sensitive_content' };
        }

        const content = sanitized.content;
        const entities = this.extractEntities(content, context);
        const analysis = this.analyzeInput(content, entities, context);
        const memoryType = this.classifyMemoryType(content, context);

        if (analysis.score < 0.4) {
            return {
                stored: false,
                score: analysis.score,
                reason: 'low_relevance',
                type: memoryType,
                sanitized: sanitized.changed
            };
        }

        const upsert = await this.memoryService.upsertMemory({
            content,
            type: memoryType,
            importance: this.computeImportance(analysis.score, memoryType),
            relevance: analysis.score,
            entities,
            context: {
                ...context,
                source: analysis.explicitRequest ? 'explicit' : 'implicit'
            }
        });

        this.logger.info('memory_processed', t('log.memory.lifecycle_processed'), {
            session_id: context.sessionId,
            memory_id: upsert.memoryId,
            action: upsert.action,
            memory_type: memoryType,
            score: Number(analysis.score.toFixed(3)),
            sanitized: sanitized.changed
        });

        return {
            stored: true,
            memoryId: upsert.memoryId,
            action: upsert.action,
            score: analysis.score,
            reason: analysis.explicitRequest ? 'explicit_trigger' : 'implicit_capture',
            type: memoryType,
            sanitized: sanitized.changed
        };
    }

    public async storeExplicit(content: string, context: AgentMemoryContext, forcedType?: MemoryType): Promise<MemoryCaptureResult> {
        const sanitized = this.sanitizeSensitive(content);
        if (this.isSensitive(content) && !sanitized.changed) {
            return { stored: false, score: 0, reason: 'blocked_sensitive_content' };
        }

        const entities = this.extractEntities(sanitized.content, context);
        const memoryType = forcedType || this.classifyMemoryType(sanitized.content, context);
        const upsert = await this.memoryService.upsertMemory({
            content: sanitized.content,
            type: memoryType,
            importance: 1,
            relevance: 1,
            entities,
            context: { ...context, source: 'explicit' }
        });

        return {
            stored: true,
            memoryId: upsert.memoryId,
            action: upsert.action,
            score: 1,
            reason: 'explicit_store',
            type: memoryType,
            sanitized: sanitized.changed
        };
    }

    public async queryMemory(query: string, options?: MemoryQueryOptions): Promise<MemoryQueryResult[]> {
        return this.memoryService.queryMemory(query, options);
    }

    public reinforceMemory(memoryId: string): void {
        this.memoryService.reinforceMemory(memoryId);
    }

    public decayMemories(decayRate: number = 0.01): number {
        return this.memoryService.applyDecay(decayRate);
    }

    public isSensitive(content: string): boolean {
        const text = String(content || '');
        const strongPatterns = [
            /-----begin\s+(rsa|ec|dsa|openssh)?\s*private key-----/i,
            /\baws_secret_access_key\b/i,
            /\bghp_[a-z0-9]{30,}\b/i,
            /\bsk-[a-z0-9]{20,}\b/i,
            /\bxox[baprs]-[a-z0-9-]{10,}\b/i
        ];

        const genericCredentialPatterns = [
            /\b(password|senha|passwd)\b\s*[:=]\s*\S+/i,
            /\b(api[_-]?key|secret|token|credencial|credential)\b\s*[:=]\s*\S+/i,
            /\b(authorization|bearer)\b\s*[:=]?\s*bearer\s+[a-z0-9\-_\.=]+/i
        ];

        return strongPatterns.some((pattern) => pattern.test(text))
            || genericCredentialPatterns.some((pattern) => pattern.test(text));
    }

    private analyzeInput(content: string, entities: string[], context: AgentMemoryContext): InputAnalysis {
        const normalized = content.toLowerCase();
        const explicitRequest = this.explicitTriggers.some((trigger) => normalized.includes(trigger));
        const containsEntity = entities.length > 0;
        const hasTechnicalDecision = /\b(decidimos|decidido|escolhemos|arquitetura|padr[aã]o|trade-?off|optei|vamos usar)\b/i.test(content);
        const isStrategic = this.isStrategicInformation(content, context);
        const isRepeated = this.isRepeatedTopic(content, context);

        let score = 0;
        if (explicitRequest) score = 1;
        if (!explicitRequest && isStrategic) score += 0.35;
        if (containsEntity) score += 0.3;
        if (hasTechnicalDecision) score += 0.4;
        if (isRepeated) score += 0.2;

        return {
            explicitRequest,
            containsEntity,
            hasTechnicalDecision,
            isRepeated,
            isStrategic,
            score: Math.max(0, Math.min(1, score))
        };
    }

    private classifyMemoryType(content: string, context: AgentMemoryContext): MemoryType {
        const normalized = content.toLowerCase();

        if (/\b(erro|stack trace|exception|corrigido|resolvido|fix|bug)\b/i.test(content)) {
            return 'error_fix';
        }
        if (/\b(decidimos|decis[aã]o|arquitetura|escolhemos|trade-?off|padrao)\b/i.test(content)) {
            return 'decision';
        }
        if (/\b(skill|tool|ferramenta|plugin)\b/i.test(content)) {
            return 'skill_usage';
        }
        if (/\b(meu nome|eu sou|prefiro|gosto de|trabalho com|minha prefer[eê]ncia|minhas prefer[eê]ncias)\b/i.test(content)) {
            return 'user_profile';
        }
        if (/\b(projeto|repo|reposit[oó]rio|sistema|c[oó]digo|arquivo|branch|deploy)\b/i.test(content) || Boolean(context.projectId)) {
            return 'project';
        }
        if (/\b(fato|conceito|regra|sempre|nunca|defini[cç][aã]o)\b/i.test(content)) {
            return 'semantic';
        }
        return context.role === 'assistant' ? 'episodic' : 'semantic';
    }

    private isStrategicInformation(content: string, context: AgentMemoryContext): boolean {
        const strategicPattern = /\b(projeto|prefer[eê]ncia|stack|arquitetura|contexto t[eé]cnico|pipeline|objetivo|meta|roadmap)\b/i;
        const importantExecution = /\b(resolvido|erro corrigido|decis[aã]o arquitetural|li[cç][aã]o aprendida)\b/i;
        return strategicPattern.test(content)
            || importantExecution.test(content)
            || Boolean(context.projectId);
    }

    private isRepeatedTopic(content: string, context: AgentMemoryContext): boolean {
        const topic = this.extractTopicKey(content);
        if (!topic) return false;

        const key = `${context.sessionId}:${topic}`;
        const current = this.topicFrequency.get(key) || 0;
        const updated = current + 1;
        this.topicFrequency.set(key, updated);

        const firstKeyword = topic.split('|')[0] || '';
        const historicalHits = firstKeyword ? this.memoryService.countMemoriesContaining(firstKeyword) : 0;
        return updated >= 2 || historicalHits > 0;
    }

    private extractTopicKey(content: string): string {
        const tokens = content
            .toLowerCase()
            .split(/[^a-z0-9à-ÿ_]+/i)
            .map((token) => token.trim())
            .filter((token) => token.length >= 4 && !this.stopWords.has(token));

        if (!tokens.length) return '';
        const unique = Array.from(new Set(tokens)).slice(0, 4);
        return unique.sort().join('|');
    }

    private extractEntities(content: string, context: AgentMemoryContext): string[] {
        const entities = new Set<string>();
        const withDashes = /\b[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+\b/g;
        const properNames = /\b[A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+){0,2}\b/g;

        for (const match of content.match(withDashes) || []) {
            if (match.length >= 3) entities.add(match);
        }
        for (const match of content.match(properNames) || []) {
            if (match.length >= 3) entities.add(match);
        }

        if (/\bialclaw\b/i.test(content)) {
            entities.add('IalClaw');
        }
        if (context.projectId) {
            entities.add(context.projectId);
        }

        return Array.from(entities).slice(0, 12);
    }

    private computeImportance(score: number, type: MemoryType): number {
        const typeBonus: Record<MemoryType, number> = {
            user_profile: 0.1,
            project: 0.1,
            decision: 0.15,
            episodic: 0,
            semantic: 0.05,
            error_fix: 0.15,
            skill_usage: 0.05,
            tool_decision: 0.12
        };
        return Math.max(0.4, Math.min(1, score + typeBonus[type]));
    }

    private sanitizeSensitive(content: string): { content: string; changed: boolean } {
        let sanitized = content;
        const redactionPatterns = [
            /\b(password|senha|passwd)\b\s*[:=]\s*[^\s,;]+/gi,
            /\b(api[_-]?key|token|secret|credencial|credential)\b\s*[:=]\s*[^\s,;]+/gi,
            /\b(authorization|bearer)\b\s*[:=]?\s*bearer\s+[a-z0-9\-_.=]+/gi
        ];

        for (const pattern of redactionPatterns) {
            sanitized = sanitized.replace(pattern, (match) => {
                const key = match.split(/[:=]/)[0]?.trim() || 'secret';
                return `${key}=[REDACTED]`;
            });
        }

        return { content: sanitized, changed: sanitized !== content };
    }
}
