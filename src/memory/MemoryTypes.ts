export type MemoryType =
    | 'user_profile'
    | 'project'
    | 'decision'
    | 'episodic'
    | 'semantic'
    | 'error_fix'
    | 'skill_usage';

export interface AgentMemoryContext {
    sessionId: string;
    role?: 'user' | 'assistant' | 'system';
    projectId?: string;
    source?: 'explicit' | 'implicit';
    recentMessages?: string[];
    metadata?: Record<string, unknown>;
}

export interface MemoryCaptureResult {
    stored: boolean;
    memoryId?: string;
    action?: 'inserted' | 'updated';
    score: number;
    reason: string;
    type?: MemoryType;
    sanitized?: boolean;
}

export interface MemoryQueryOptions {
    limit?: number;
    reinforce?: boolean;
}

export interface MemoryQueryResult {
    id: string;
    type: MemoryType;
    content: string;
    similarity: number;
    graphScore: number;
    finalScore: number;
    importance: number;
    lastAccessed?: string;
}

export interface StoreMemoryInput {
    content: string;
    type: MemoryType;
    importance: number;
    relevance: number;
    entities: string[];
    context: AgentMemoryContext;
}

export interface UpsertMemoryResult {
    memoryId: string;
    action: 'inserted' | 'updated';
}
