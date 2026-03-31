import { Flow, FlowState, FlowResponse } from './types';
import { IntentionResolver } from '../agent/IntentionResolver';
import { createLogger } from '../../shared/AppLogger';

export class FlowManager {
    private currentFlow: Flow | null = null;
    private state: FlowState | null = null;
    private logger = createLogger('FlowManager');

    private readonly MAX_RETRIES = 2;
    private readonly CONFIDENCE_THRESHOLD = 0.4;

    constructor() { }

    /**
     * Starts a new flow.
     */
    public startFlow(flow: Flow, initialContext: Record<string, any> = {}, topic?: string): string {
        this.currentFlow = flow;
        this.state = {
            flowId: flow.id,
            stepIndex: 0,
            retryCount: 0,
            confidence: 1.0,
            topic: topic || flow.id,
            context: { ...initialContext }
        };

        const currentStep = flow.steps[0];
        this.logger.info('flow_started', `Flow ${flow.id} started.`, { step: currentStep.id });

        return this.formatPrompt(currentStep.prompt(this.state.context));
    }

    /**
     * Handles user input within a flow.
     */
    public async handleInput(input: string): Promise<FlowResponse> {
        if (!this.currentFlow || !this.state) {
            return { answer: '', completed: false, exited: true };
        }

        const match = IntentionResolver.resolve(input);
        const intent = match.type;

        // ═══════════════════════════════════════════════════════════════════
        // ESCAPE HATCH (Requirements 3) - Refined: Check topic relation
        // ═══════════════════════════════════════════════════════════════════
        const topic = this.state.topic || (this.state.context.topic as string) || '';
        const isRelated = topic && input.toLowerCase().includes(topic.toLowerCase());

        this.logger.info('intent_debug', `Intent: ${intent}, topic: ${topic}, isRelated: ${isRelated}`);

        // STOP ou QUESTION/META não relacionadas causam saída do flow
        if ((intent === 'STOP' || intent === 'QUESTION' || intent === 'META') && !isRelated) {
            this.logger.info('flow_escaped', `User interrupted flow ${this.currentFlow.id} with intent: ${intent}`);
            this.cancelFlow();
            return { answer: '', completed: false, exited: true };
        }

        const currentStep = this.currentFlow.steps[this.state.stepIndex];

        // ═══════════════════════════════════════════════════════════════════
        // VALIDATION & PROCESSING
        // ═══════════════════════════════════════════════════════════════════
        if (currentStep.validate(input, this.state.context)) {
            currentStep.process(input, this.state.context);
            this.state.stepIndex++;
            this.state.retryCount = 0;
            this.state.confidence = Math.min(1.0, this.state.confidence + 0.1);

            // Check if flow is complete
            if (this.state.stepIndex >= this.currentFlow.steps.length) {
                const result = await this.currentFlow.onComplete(this.state.context);
                this.logger.info('flow_completed', `Flow ${this.currentFlow.id} completed.`);
                this.clear();
                return { answer: '', completed: true, exited: false, result };
            }

            // Next step prompt
            const nextStep = this.currentFlow.steps[this.state.stepIndex];
            return {
                answer: this.formatPrompt(nextStep.prompt(this.state.context)),
                completed: false,
                exited: false
            };
        } else {
            // ═══════════════════════════════════════════════════════════════════
            // SMART RETRY / ANTI-LOOP (Requirement 4 & 5)
            // ═══════════════════════════════════════════════════════════════════
            this.state.retryCount++;
            this.state.confidence -= 0.2;

            if (this.state.retryCount > this.MAX_RETRIES || this.state.confidence < this.CONFIDENCE_THRESHOLD) {
                this.logger.warn('flow_auto_exit', `Exiting flow ${this.currentFlow.id} due to low confidence or retries.`);
                this.cancelFlow();
                return { answer: '', completed: false, exited: true };
            }

            // Retry prompt
            return {
                answer: `Desculpe, não entendi. ${this.formatPrompt(currentStep.prompt(this.state.context))}`,
                completed: false,
                exited: false
            };
        }
    }

    private formatPrompt(prompt: string): string {
        // UX Layer (Requirement 6)
        return `${prompt}\n\nPara prosseguir, preciso dessa informação.\nVocê pode:\n• Fornecer os dados solicitados\n• Ou apenas continuar digitando normalmente se preferir uma resposta direta (isso encerrará este assistente de passo-a-passo).`;
    }

    public cancelFlow(): void {
        if (this.currentFlow?.onCancel && this.state) {
            this.currentFlow.onCancel(this.state.context);
        }
        this.clear();
    }

    public clear(): void {
        this.currentFlow = null;
        this.state = null;
    }

    public isInFlow(): boolean {
        return this.currentFlow !== null;
    }

    public getState(): FlowState | null {
        return this.state;
    }

    public resume(state: FlowState, flow: Flow): void {
        this.currentFlow = flow;
        this.state = state;
    }
}
