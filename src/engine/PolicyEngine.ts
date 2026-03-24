import { NodeResult } from '../memory/CognitiveMemory';

export type Policy = {
    tool_policy?: {
        allow?: string[];
        deny?: string[];
        priority?: string[];
    };
    reasoning?: {
        style?: string;
        depth?: string;
    };
    response?: {
        verbosity?: string;
        tone?: string;
    };
    limits?: {
        max_steps?: number;
        max_tool_calls?: number;
    };
};

export class PolicyEngine {
    public resolvePolicy(identityNodes: NodeResult[]): Policy {
        // We collect JSON segments from identity nodes securely.
        const policies = identityNodes
            .map(n => this.safeParse(n.content || ''))
            .filter(Boolean) as Policy[];

        return this.mergePolicies(policies);
    }

    private safeParse(content: string): Policy | null {
        try {
            // Find the first JSON block within the content
            const match = content.match(/\{[\s\S]*\}/);
            if (match) {
                return JSON.parse(match[0]);
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    private mergePolicies(policies: Policy[]): Policy {
        const result: Policy = {
            tool_policy: { allow: [], deny: [], priority: [] },
            reasoning: {},
            response: {},
            limits: {}
        };

        // Note: policies array natively follows DB returned order
        // `deny` always overrides `allow`.

        for (const p of policies) {
            if (p.tool_policy?.allow) result.tool_policy!.allow = [...(result.tool_policy!.allow || []), ...p.tool_policy.allow];
            if (p.tool_policy?.deny) result.tool_policy!.deny = [...(result.tool_policy!.deny || []), ...p.tool_policy.deny];
            if (p.tool_policy?.priority) result.tool_policy!.priority = [...(result.tool_policy!.priority || []), ...p.tool_policy.priority];

            if (p.reasoning?.style) result.reasoning!.style = p.reasoning.style;
            if (p.reasoning?.depth) result.reasoning!.depth = p.reasoning.depth;

            if (p.response?.verbosity) result.response!.verbosity = p.response.verbosity;
            if (p.response?.tone) result.response!.tone = p.response.tone;

            if (p.limits?.max_steps) result.limits!.max_steps = p.limits.max_steps;
            if (p.limits?.max_tool_calls) result.limits!.max_tool_calls = p.limits.max_tool_calls;
        }

        // Deduplicate arrays
        result.tool_policy!.allow = [...new Set(result.tool_policy!.allow)];
        result.tool_policy!.deny = [...new Set(result.tool_policy!.deny)];
        result.tool_policy!.priority = [...new Set(result.tool_policy!.priority)];

        // Filter out denials from allow list
        result.tool_policy!.allow = result.tool_policy!.allow.filter(t => !result.tool_policy!.deny!.includes(t));

        return result;
    }
}
