import { LLMProvider, MessagePayload } from './ProviderFactory';
import { SkillRegistry } from './SkillRegistry';

export class AgentLoop {
    private llm: LLMProvider;
    private registry: SkillRegistry;
    private maxIterations = 5;

    constructor(llm: LLMProvider, registry: SkillRegistry) {
        this.llm = llm;
        this.registry = registry;
    }

    public getProvider(): LLMProvider {
        return this.llm;
    }

    public async run(initialMessages: MessagePayload[], policy?: any): Promise<{ answer: string, newMessages: MessagePayload[] }> {
        const maxIter = policy?.limits?.max_steps || this.maxIterations;
        const maxTools = policy?.limits?.max_tool_calls || 5;
        let toolCallsCount = 0;

        let toolsDefinition = this.registry.getDefinitions();

        // Apply policy to tools
        if (policy?.tool_policy) {
            toolsDefinition = toolsDefinition.filter(t => {
                if (policy.tool_policy.deny?.includes(t.name)) return false;
                if (policy.tool_policy.allow && policy.tool_policy.allow.length > 0) {
                    return policy.tool_policy.allow.includes(t.name);
                }
                return true;
            });

            const priority = policy.tool_policy.priority || [];
            if (priority.length > 0) {
                toolsDefinition.sort((a, b) => {
                    const idxA = priority.indexOf(a.name);
                    const idxB = priority.indexOf(b.name);
                    if (idxA === -1 && idxB === -1) return 0;
                    if (idxA === -1) return 1;
                    if (idxB === -1) return -1;
                    return idxA - idxB;
                });
            }
        }

        const messages = [...initialMessages];
        const newMessages: MessagePayload[] = [];

        for (let i = 0; i < maxIter; i++) {
            const response = await this.llm.generate(messages, toolsDefinition);

            if (response.tool_call) {
                if (toolCallsCount >= maxTools) {
                    const blockMsg: MessagePayload = { role: 'tool', content: `[POLICY ENGINE] Tool call limite reached. Max: ${maxTools}` };
                    const assistBlock: MessagePayload = { role: 'assistant', content: `[Tentei executar ${response.tool_call.name} mas fui bloqueado pela Policy de limites]` };
                    messages.push(assistBlock, blockMsg);
                    newMessages.push(assistBlock, blockMsg);
                    continue; // Pushes model to finalize answer
                }

                toolCallsCount++;
                try {
                    const result = await this.registry.executeTool(response.tool_call.name, response.tool_call.args);

                    const assistantMsg: MessagePayload = {
                        role: 'assistant',
                        content: `[Usando skill: ${response.tool_call.name}]`,
                        tool_name: response.tool_call.name,
                        tool_args: response.tool_call.args
                    };
                    const toolMsg: MessagePayload = { role: 'tool', content: result };

                    messages.push(assistantMsg, toolMsg);
                    newMessages.push(assistantMsg, toolMsg);

                    continue;
                } catch (error: any) {
                    const errMsg: MessagePayload = { role: 'tool', content: `Erro ao executar tool: ${error.message}` };
                    messages.push(errMsg);
                    newMessages.push(errMsg);
                    continue;
                }
            }

            if (response.final_answer) {
                const finalMsg: MessagePayload = { role: 'assistant', content: response.final_answer };
                messages.push(finalMsg);
                newMessages.push(finalMsg);
                return { answer: response.final_answer, newMessages };
            }
        }

        throw new Error("Max iterations reached in AgentLoop.");
    }
}
