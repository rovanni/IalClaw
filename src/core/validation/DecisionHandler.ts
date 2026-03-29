// ── DecisionHandler: Recuperação de Erro Interativa ───────────────────────────────
// "Nunca falhe em silêncio."
// Transforma falhas parciais em decisões do usuário.

import { createLogger } from '../../shared/AppLogger';
import { t } from '../../i18n';
import { StepResult, PlanValidationResult } from '../validation/PlanExecutionValidator';

export interface DecisionOption {
    id: 'retry' | 'ignore' | 'adjust' | 'cancel';
    label: string;
    description: string;
}

export interface DecisionRequest {
    type: 'decision';
    message: string;
    failedSteps: StepResult[];
    completedSteps: number;
    totalSteps: number;
    options: DecisionOption[];
    context?: string;
}

export interface DecisionResult {
    action: 'retry' | 'ignore' | 'adjust' | 'cancel';
    retrySteps?: string[];
    ignoreErrors?: boolean;
}

export class DecisionHandler {
    private logger = createLogger('DecisionHandler');

    /**
     * Analisa resultado do plano e decide se precisa de intervenção do usuário.
     */
    analyzePlanResult(planResult: PlanValidationResult): DecisionRequest | null {
        // Sucesso total → sem necessidade de decisão
        if (planResult.success) {
            this.logger.info('plan_success', '[DECISION] Plano executado com sucesso');
            return null;
        }

        // Falha total → sem steps completos
        if (planResult.completedSteps === 0) {
            this.logger.warn('plan_total_failure', '[DECISION] Plano falhou completamente');
            return this.createTotalFailureDecision(planResult);
        }

        // Falha parcial → alguns steps falharam
        this.logger.warn('plan_partial_failure', '[DECISION] Plano falhou parcialmente', {
            completed: planResult.completedSteps,
            total: planResult.totalSteps,
            failed: planResult.failedSteps.length
        });

        return this.createPartialFailureDecision(planResult);
    }

    /**
     * Cria decisão para falha total (nenhum step completou).
     */
    private createTotalFailureDecision(planResult: PlanValidationResult): DecisionRequest {
        const failedSteps = planResult.failedSteps;
        const errorMessages = failedSteps
            .map(f => `• ${f.name}: ${f.error || 'erro desconhecido'}`)
            .join('\n');

        return {
            type: 'decision',
            message: t('decision.total_failure', {
                steps: errorMessages,
                count: failedSteps.length
            }),
            failedSteps,
            completedSteps: 0,
            totalSteps: planResult.totalSteps,
            options: this.getOptionsForTotalFailure(),
            context: 'total_failure'
        };
    }

    /**
     * Cria decisão para falha parcial (alguns steps completaram).
     */
    private createPartialFailureDecision(planResult: PlanValidationResult): DecisionRequest {
        const failedSteps = planResult.failedSteps;
        const completedSteps = planResult.completedSteps;
        const totalSteps = planResult.totalSteps;

        // Detalhes dos steps que falharam
        const failedDetails = failedSteps
            .map(f => `• ${f.name}: ${f.error || 'falhou'}`)
            .join('\n');

        return {
            type: 'decision',
            message: t('decision.partial_failure', {
                completed: completedSteps,
                total: totalSteps,
                steps: failedDetails
            }),
            failedSteps,
            completedSteps,
            totalSteps,
            options: this.getOptionsForPartialFailure(),
            context: 'partial_failure'
        };
    }

    /**
     * Opções para falha total.
     */
    private getOptionsForTotalFailure(): DecisionOption[] {
        return [
            {
                id: 'retry',
                label: t('decision.option.retry'),
                description: t('decision.option.retry_desc')
            },
            {
                id: 'adjust',
                label: t('decision.option.adjust'),
                description: t('decision.option.adjust_desc')
            },
            {
                id: 'cancel',
                label: t('decision.option.cancel'),
                description: t('decision.option.cancel_desc')
            }
        ];
    }

    /**
     * Opções para falha parcial.
     */
    private getOptionsForPartialFailure(): DecisionOption[] {
        return [
            {
                id: 'retry',
                label: t('decision.option.retry'),
                description: t('decision.option.retry_desc')
            },
            {
                id: 'ignore',
                label: t('decision.option.ignore'),
                description: t('decision.option.ignore_desc')
            },
            {
                id: 'adjust',
                label: t('decision.option.adjust'),
                description: t('decision.option.adjust_desc')
            },
            {
                id: 'cancel',
                label: t('decision.option.cancel'),
                description: t('decision.option.cancel_desc')
            }
        ];
    }

    /**
     * Processa a decisão do usuário.
     */
    processUserDecision(decision: 'retry' | 'ignore' | 'adjust' | 'cancel', planResult: PlanValidationResult): DecisionResult {
        this.logger.info('decision_processed', '[DECISION] Usuário decidiu', {
            decision,
            failedSteps: planResult.failedSteps.length
        });

        switch (decision) {
            case 'retry':
                return {
                    action: 'retry',
                    retrySteps: planResult.failedSteps.map(s => s.name)
                };

            case 'ignore':
                return {
                    action: 'ignore',
                    ignoreErrors: true
                };

            case 'adjust':
                return {
                    action: 'adjust'
                };

            case 'cancel':
                return {
                    action: 'cancel'
                };

            default:
                this.logger.warn('decision_unknown', '[DECISION] Decisão desconhecida', { decision });
                return {
                    action: 'cancel'
                };
        }
    }

    /**
     * Verifica se precisa de intervenção do usuário.
     */
    needsUserIntervention(planResult: PlanValidationResult): boolean {
        // Sucesso total → não precisa
        if (planResult.success) {
            return false;
        }

        // Interrupção por contexto → precisa
        if (planResult.interrupted && planResult.interruptReason === 'context_changed') {
            return true;
        }

        // Falha parcial ou total → precisa
        return planResult.completedSteps < planResult.totalSteps;
    }

    /**
     * Gera relatório para o usuário.
     */
    generateUserReport(planResult: PlanValidationResult): string {
        if (planResult.success) {
            return t('report.success', {
                steps: planResult.totalSteps
            });
        }

        if (planResult.interrupted) {
            return t('report.interrupted', {
                reason: planResult.interruptReason,
                completed: planResult.completedSteps,
                total: planResult.totalSteps
            });
        }

        const failedDetails = planResult.failedSteps
            .map(f => `${f.name}: ${f.error || 'falhou'}`)
            .join(', ');

        return t('report.failed', {
            completed: planResult.completedSteps,
            total: planResult.totalSteps,
            failed: failedDetails
        });
    }

    /**
     * Formata resultado para exibição.
     */
    formatResult(planResult: PlanValidationResult): {
        summary: string;
        details: string[];
        score: number;
    } {
        const score = planResult.score;
        const summary = this.generateUserReport(planResult);

        const details: string[] = [];

        // Steps bem-sucedidos
        const successful = planResult.results.filter(r => r.success);
        if (successful.length > 0) {
            details.push(t('report.successful_steps') + ':');
            successful.forEach(s => {
                details.push(`  ✅ ${s.name}`);
            });
        }

        // Steps falhados
        if (planResult.failedSteps.length > 0) {
            details.push(t('report.failed_steps') + ':');
            planResult.failedSteps.forEach(f => {
                details.push(`  ❌ ${f.name}: ${f.error || 'erro'}`);
            });
        }

        return {
            summary,
            details,
            score
        };
    }
}

// Singleton
let decisionHandlerInstance: DecisionHandler | null = null;

export function getDecisionHandler(): DecisionHandler {
    if (!decisionHandlerInstance) {
        decisionHandlerInstance = new DecisionHandler();
    }
    return decisionHandlerInstance;
}