// ── PlanExecutionValidator: Validação de Execução de Plano ─────────────────────
// Valida o PROCESSO de execução, não apenas o output final.
// "Confie no processo, não só no resultado."

import { createLogger } from '../../shared/AppLogger';
import { t } from '../../i18n';

export interface StepResult {
    name: string;
    success: boolean;
    output?: any;
    error?: string;
    duration?: number;
}

export interface PlanValidationResult {
    success: boolean;
    completedSteps: number;
    totalSteps: number;
    score: number;           // 0.0 a 1.0
    results: StepResult[];
    failedSteps: StepResult[];
    interrupted?: boolean;
    interruptReason?: 'context_changed' | 'timeout' | 'error' | 'user_stop';
    message?: string;
}

export interface ProgressReport {
    stepName: string;
    stepIndex: number;
    totalSteps: number;
    status: 'started' | 'completed' | 'failed';
    output?: any;
    error?: string;
}

export class PlanExecutionValidator {
    private logger = createLogger('PlanExecutionValidator');
    private results: StepResult[] = [];
    private startTime: number = 0;
    private interrupted: boolean = false;
    private interruptReason?: 'context_changed' | 'timeout' | 'error' | 'user_stop';

    /**
     * Inicia validação de um novo plano.
     */
    startPlan(): void {
        this.results = [];
        this.startTime = Date.now();
        this.interrupted = false;
        this.interruptReason = undefined;
        
        this.logger.info('plan_validation_started', '[PLAN_VALIDATOR] Iniciando validação de plano');
    }

    /**
     * Registra resultado de um step.
     */
    recordStep(stepName: string, success: boolean, output?: any, error?: string, duration?: number): StepResult {
        const result: StepResult = {
            name: stepName,
            success,
            output,
            error,
            duration
        };
        
        this.results.push(result);
        
        this.logger.debug('step_recorded', `[PLAN_VALIDATOR] Step registrado`, {
            step: stepName,
            success,
            hasOutput: !!output,
            error: error?.substring(0, 100)
        });
        
        return result;
    }

    /**
     * Verifica se um step é válido (não apenas success=true).
     * Valida que o output é real e substancial.
     */
    isStepValid(result: StepResult): boolean {
        // Se falhou explicitamente, não é válido
        if (!result.success) {
            return false;
        }

        // Se não tem output, não é válido
        if (!result.output) {
            return false;
        }

        // Se output é string muito curta, pode ser erro silencioso
        if (typeof result.output === 'string' && result.output.trim().length < 20) {
            return false;
        }

        // Se output é objeto vazio
        if (typeof result.output === 'object' && Object.keys(result.output).length === 0) {
            return false;
        }

        return true;
    }

    /**
     * Interrompe a execução (contexto mudou, timeout, etc).
     */
    interrupt(reason: 'context_changed' | 'timeout' | 'error' | 'user_stop'): void {
        this.interrupted = true;
        this.interruptReason = reason;
        
        this.logger.warn('plan_interrupted', `[PLAN_VALIDATOR] Plano interrompido`, {
            reason,
            completedSteps: this.results.length
        });
    }

    /**
     * Verifica se houve interrupção.
     */
    wasInterrupted(): boolean {
        return this.interrupted;
    }

    /**
     * Valida resultado final do plano.
     */
    validatePlan(): PlanValidationResult {
        const completedSteps = this.results.filter(r => this.isStepValid(r)).length;
        const totalSteps = this.results.length;
        const failedSteps = this.results.filter(r => !this.isStepValid(r));
        
        // Score: porcentagem de steps válidos
        const score = totalSteps > 0 ? completedSteps / totalSteps : 0;

        // Determinar sucesso
        const success = score === 1 && !this.interrupted;

        // Mensagem apropriada
        let message: string;
        if (this.interrupted) {
            message = this.getInterruptMessage();
        } else if (score === 1) {
            message = t('plan.success');
        } else if (score >= 0.7) {
            message = t('plan.partial_success', { completed: completedSteps, total: totalSteps });
        } else {
            message = t('plan.failed', { completed: completedSteps, total: totalSteps });
        }

        const result: PlanValidationResult = {
            success,
            completedSteps,
            totalSteps,
            score,
            results: this.results,
            failedSteps,
            interrupted: this.interrupted,
            interruptReason: this.interruptReason,
            message
        };

        this.logger.info('plan_validation_completed', `[PLAN_VALIDATOR] Validação concluída`, {
            success,
            score: score.toFixed(2),
            completedSteps,
            totalSteps,
            interrupted: this.interrupted
        });

        return result;
    }

    /**
     * Gera mensagem de interrupção.
     */
    private getInterruptMessage(): string {
        switch (this.interruptReason) {
            case 'context_changed':
                return t('plan.interrupted.context_changed');
            case 'timeout':
                return t('plan.interrupted.timeout');
            case 'user_stop':
                return t('plan.interrupted.user_stop');
            case 'error':
                return t('plan.interrupted.error');
            default:
                return t('plan.interrupted.unknown');
        }
    }

    /**
     * Gera relatório de progresso para um step.
     */
    getProgressReport(stepName: string, stepIndex: number, totalSteps: number, status: 'started' | 'completed' | 'failed', output?: any, error?: string): ProgressReport {
        return {
            stepName,
            stepIndex,
            totalSteps,
            status,
            output,
            error
        };
    }

    /**
     * Verifica se houve progresso real.
     * Útil para detectar loops ou estagnação.
     */
    hasProgress(): boolean {
        // Se completou pelo menos um step com output válido
        return this.results.some(r => this.isStepValid(r));
    }

    /**
     * Retorna estatísticas da execução.
     */
    getStats(): {
        totalSteps: number;
        successSteps: number;
        failedSteps: number;
        validSteps: number;
        avgDuration: number;
        totalDuration: number;
    } {
        const totalSteps = this.results.length;
        const successSteps = this.results.filter(r => r.success).length;
        const failedSteps = totalSteps - successSteps;
        const validSteps = this.results.filter(r => this.isStepValid(r)).length;
        
        const durations = this.results
            .filter(r => r.duration !== undefined)
            .map(r => r.duration as number);
        
        const totalDuration = Date.now() - this.startTime;
        const avgDuration = durations.length > 0 
            ? durations.reduce((a, b) => a + b, 0) / durations.length 
            : 0;

        return {
            totalSteps,
            successSteps,
            failedSteps,
            validSteps,
            avgDuration,
            totalDuration
        };
    }

    /**
     * Detecta se houve mudança de contexto durante execução.
     * Compara input original com novo input.
     */
    detectContextChange(originalInput: string, newInput: string): boolean {
        // Palavras indicando continuação
        const continuationIndicators = [
            /^e\s+/i, /^e\s+para/i, /^usar/i, /^utilizar/i,
            /^com\s+esse/i, /^agora\s+com/i
        ];

        const normalized = newInput.toLowerCase().trim();
        const isContinuation = continuationIndicators.some(p => p.test(normalized));

        // Se é continuação, não é mudança de contexto
        if (isContinuation) {
            return false;
        }

        // Se input é muito diferente do original, é mudança de contexto
        const originalWords = new Set(originalInput.toLowerCase().split(/\s+/));
        const newWords = new Set(newInput.toLowerCase().split(/\s+/));
        const intersection = [...originalWords].filter(w => newWords.has(w)).length;
        const union = new Set([...originalWords, ...newWords]).size;
        const similarity = union > 0 ? intersection / union : 0;

        // Baixa similaridade = mudança de contexto
        return similarity < 0.3;
    }

    /**
     * Limpa estado para nova execução.
     */
    reset(): void {
        this.results = [];
        this.startTime = 0;
        this.interrupted = false;
        this.interruptReason = undefined;
    }
}

// Singleton para uso global
let planValidatorInstance: PlanExecutionValidator | null = null;

export function getPlanExecutionValidator(): PlanExecutionValidator {
    if (!planValidatorInstance) {
        planValidatorInstance = new PlanExecutionValidator();
    }
    return planValidatorInstance;
}