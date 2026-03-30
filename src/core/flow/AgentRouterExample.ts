import { FlowManager } from './FlowManager';
import { HtmlSlidesFlow } from './flows/HtmlSlidesFlow';
import { createLogger } from '../../shared/AppLogger';

/**
 * Example of how to integrate FlowManager into the existing Agent logic.
 */
export class AgentRouter {
    private flowManager: FlowManager;
    private logger = createLogger('AgentRouter');

    constructor(flowManager: FlowManager) {
        this.flowManager = flowManager;
    }

    public async handleMessage(input: string): Promise<string> {
        // ═══════════════════════════════════════════════════════════════════
        // 1. IF IN A FLOW, LET FLOWMANAGER HANDLE IT
        // ═══════════════════════════════════════════════════════════════════
        if (this.flowManager.isInFlow()) {
            const flowResponse = await this.flowManager.handleInput(input);

            if (!flowResponse.exited) {
                if (flowResponse.completed) {
                    // Flow finished! Execute the resulting action.
                    return await this.executeFlowResult(flowResponse.result);
                }
                // Flow interrupted or needs more steps, FlowManager already returned the prompt.
                return flowResponse.answer;
            }

            // If exited, we fallback to normal agent logic (intent detection handled the exit)
            this.logger.info('router', 'Flow exited, falling back to normal agent loop.');
        }

        // ═══════════════════════════════════════════════════════════════════
        // 2. NORMAL AGENT LOGIC (INTEGRATION POINT)
        // ═══════════════════════════════════════════════════════════════════

        // Simulating Task Classification
        const isRequestingSlides = input.toLowerCase().includes('slides') && input.toLowerCase().includes('criar');

        if (isRequestingSlides) {
            // Requirement 7: Start flow if it requires one
            const flow = new HtmlSlidesFlow();
            return this.flowManager.startFlow(flow);
        }

        // Default: Route to normal ReAct agent planner
        return "Encaminhando sua solicitação para o planejador cognitivo...";
    }

    private async executeFlowResult(result: any): Promise<string> {
        if (result.action === 'call_tool' && result.tool === 'html_slides') {
            return `Gerando slides HTML com o conteúdo: ${result.args.content.substring(0, 50)}...`;
        }
        return "Ação concluída com sucesso.";
    }
}
