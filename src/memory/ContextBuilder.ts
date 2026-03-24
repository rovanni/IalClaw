import { NodeResult } from './CognitiveMemory';

export class ContextBuilder {
    public build(context: { identity: NodeResult[], memory: NodeResult[], policy?: any }): string {
        const identityBlock = this.buildIdentity(this.filterIdentity(context.identity));
        const memoryBlock = this.buildMemory(context.memory);
        const policyBlock = this.injectPolicyHints(context.policy);

        return `
${identityBlock}
${policyBlock}

[CONTEXT]
${memoryBlock}
`;
    }

    private injectPolicyHints(policy: any): string {
        if (!policy) return '';
        let hint = '\n[POLICY OVERRIDES]\n';
        if (policy.reasoning?.style) hint += `- REASONING STYLE: ${policy.reasoning.style}\n`;
        if (policy.response?.verbosity) hint += `- VERBOSITY: ${policy.response.verbosity}\n`;
        if (policy.response?.tone) hint += `- TONE: ${policy.response.tone}\n`;
        return hint;
    }

    private filterIdentity(nodes: NodeResult[]): NodeResult[] {
        return nodes.filter(n => {
            if (n.subtype === "soul") return true;
            if (n.subtype === "heartbeat") return true;
            if (n.subtype === "user") return (n.importance || 0.5) >= 0.7;
            if (n.subtype === "agent") return (n.importance || 0.5) >= 0.6;
            return false;
        });
    }

    private groupIdentity(nodes: NodeResult[]): Record<string, NodeResult[]> {
        const map: Record<string, NodeResult[]> = {
            soul: [],
            heartbeat: [],
            user: [],
            agent: []
        };

        for (const n of nodes) {
            const subtype = n.subtype || 'agent';
            if (map[subtype]) {
                map[subtype].push(n);
            }
        }

        return map;
    }

    private buildIdentity(identityNodes: NodeResult[]): string {
        const grouped = this.groupIdentity(identityNodes);

        const joinNodes = (nodes: NodeResult[]) => {
            return nodes
                .sort((a, b) => (b.importance || 0) - (a.importance || 0))
                .map(n => n.content || n.content_preview || n.name)
                .join("\n\n");
        };

        let result = '';
        if (grouped.soul.length) result += `[SOUL]\n${joinNodes(grouped.soul)}\n\n`;
        if (grouped.heartbeat.length) result += `[HEARTBEAT]\n${joinNodes(grouped.heartbeat)}\n\n`;
        if (grouped.user.length) result += `[USER]\n${joinNodes(grouped.user)}\n\n`;
        if (grouped.agent.length) result += `[AGENTS]\n${joinNodes(grouped.agent)}\n\n`;

        return result.trim();
    }

    private buildMemory(nodes: NodeResult[]): string {
        if (nodes.length === 0) {
            return "Nenhum contexto relevante encontrado na memória.";
        }

        const lines = nodes.map(n => {
            return n.content ? `- ${n.name}: ${n.content}` : `- ${n.name}: ${n.content_preview}`;
        });
        return lines.join('\n');
    }
}
