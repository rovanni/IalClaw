import { NodeResult } from './CognitiveMemory';
import { SessionManager } from '../shared/SessionManager';

export class ContextBuilder {
    public build(context: { identity: NodeResult[], memory: NodeResult[], policy?: any, chatId?: string }): string {
        const identityBlock = this.buildIdentity(this.filterIdentity(context.identity));
        const memoryBlock = this.buildMemory(context.memory);
        const policyBlock = this.injectPolicyHints(context.policy);
        const filesBlock = context.chatId ? this.buildFilesBlock(context.chatId) : '';

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
- Se houver arquivos de audio anexados e nenhuma transcricao for fornecida → use a skill 'telegram-voice'
- Se nao houver contexto util → responda normalmente

${filesBlock}

MEMORIA:
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
            let content = n.content || n.content_preview || n.name || 'Memória sem conteúdo';
            if (content.length > 300) {
                content = content.slice(0, 300) + '... (truncated)';
            }
            return `- ${n.name}: ${content}`;
        });
        return lines.join('\n');
    }

    /**
     * Build a list of the 5 most recent attached files.
     */
    private buildFilesBlock(chatId: string): string {
        const session = SessionManager.getSession(chatId);
        const ctx = session?.task_context;
        if (!ctx || !ctx.files || ctx.files.length === 0) {
            return '';
        }

        // Ultimos 5 arquivos, ordenados por sequencia (mais recente por ultimo na exibicao)
        const recentFiles = ctx.files
            .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
            .slice(-5);

        let block = '\n[ARQUIVOS ANEXADOS (CONTEXTO RECENTE)]\n';
        for (const file of recentFiles) {
            block += `${file.sequence}. ${file.filename} (${file.type})\n`;
        }
        block += '\nNota: Se for solicitado o processamento de um audio, utilize a skill "telegram-voice" referenciando o arquivo mais recente.\n';

        return block;
    }
}
