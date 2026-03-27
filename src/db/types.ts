export const NodeType = {
    IDENTITY: "identity",
    MEMORY: "memory",
    CONCEPT: "concept",
    FACT: "fact",
    CODE: "code"
} as const;

export type NodeTypeValue = typeof NodeType[keyof typeof NodeType];

export const IdentitySubtype = {
    SOUL: "soul",
    USER: "user",
    AGENT: "agent",
    HEARTBEAT: "heartbeat"
} as const;

export type IdentitySubtypeValue = typeof IdentitySubtype[keyof typeof IdentitySubtype];

export interface CognitiveNode {
    id: string;
    doc_id?: string;
    type: NodeTypeValue;
    subtype?: IdentitySubtypeValue | string;
    name?: string;
    content: string;
    content_preview?: string;
    importance: number;
    score: number;
    freshness: number;
    embedding?: string;
    category?: string;
    tags?: string;
    auto_indexed: number;
    created_at?: string;
    modified?: string;
}
