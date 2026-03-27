import { NodeResult } from './CognitiveMemory';

export class ContextBuilder {
    public build(context: { identity: NodeResult[], memory: NodeResult[], codeNodes?: NodeResult[], policy?: any }): string {
        const identityBlock = this.buildIdentity(this.filterIdentity(context.identity));
        const memoryBlock = this.buildMemory(context.memory);
        const policyBlock = this.injectPolicyHints(context.policy);
        const codeBlock = this.buildCodeContext(context.codeNodes || []);

        return `
[IDENTIDADE DO AGENTE]
Use essas informacoes para manter consistencia de comportamento.
${identityBlock}
${policyBlock}

[MEMORIA ATIVA DO AGENTE]

As informacoes abaixo foram recuperadas dinamicamente da sua memoria interna.
Voce DEVE considerar isso como conhecimento proprio.

Voce pode:
- usar essas informacoes para responder
- assumir que ja "lembra" disso
- continuar tarefas com base nisso

Se a informacao estiver aqui, voce SABE disso.
Nao diga que nao tem memoria.

REGRAS:
- Se a informacao estiver na memoria, use diretamente
- Nao diga que "nao tem acesso a memoria"
- Nao diga que precisa de tool para acessar memoria
- A memoria ja foi fornecida para voce
- Voce possui memoria persistente — informacoes do usuario sao salvas automaticamente
- Quando o usuario compartilhar fatos sobre si (nome, profissao, preferencias), confirme naturalmente que vai lembrar
- NUNCA diga que nao pode salvar, que nao tem essa capacidade, ou que nao possui memoria persistente
- Se o usuario perguntar se voce consegue lembrar, responda que SIM
- Se houver referencia a arquivos, diretorios ou projetos → use tools
- Se houver continuidade de acao → continue executando
- Se nao houver contexto util → responda normalmente

MEMORIA:
${memoryBlock}
${codeBlock}`;
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

    private buildCodeContext(nodes: NodeResult[]): string {
        if (nodes.length === 0) return '';

        const lines = nodes.map(n => {
            let meta = '';
            try {
                const tags = JSON.parse((n as any).tags || '{}');
                if (tags.fileType && tags.fileType !== 'other') meta = ` [${tags.fileType}]`;
            } catch { /* ignore */ }
            const desc = n.content || n.content_preview || '';
            const summary = desc.replace(/^Arquivo [^:]+:\s*/, '').slice(0, 120);
            return `- ${n.name}${meta} → ${summary}`;
        });

        return `
[ARQUIVOS RELEVANTES DO PROJETO]
Use essas informacoes para entender o projeto sem abrir arquivos.
Abra um arquivo com workspace_read_artifact APENAS se precisar do conteudo completo.

${lines.join('\n')}
`;
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
