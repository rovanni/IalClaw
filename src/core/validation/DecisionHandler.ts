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

export interface ReactiveState {
    type: 'failure_recovery';
    classification: 'context' | 'execution' | 'logic' | 'system';
    failedSteps: StepResult[];
    options: DecisionOption[];
    message?: string;
}

export interface DecisionResult {
    action: 'retry' | 'ignore' | 'adjust' | 'cancel';
    retrySteps?: string[];
    ignoreErrors?: boolean;
}

export interface FailureClassification {
    type: 'context' | 'execution' | 'logic' | 'system';
    description: string;
    suggestedAction: 'adjust' | 'retry' | 'cancel';
}

export class DecisionHandler {
    private logger = createLogger('DecisionHandler');

    // Limite de decisões por tarefa (anti-loop)
    private readonly MAX_DECISIONS = 3;
    private decisionCount: number = 0;
    private lastDecisionType?: 'retry' | 'ignore' | 'adjust' | 'cancel';

    /**
     * Analisa resultado do plano e retorna o estado reativo (ReactiveState).
     */
    getReactiveState(planResult: PlanValidationResult): ReactiveState | null {
        if (planResult.success || this.decisionCount >= this.MAX_DECISIONS) {
            return null;
        }

        const classification = this.classifyFailure(planResult);
        const options = this.getOptionsForFailureType(classification);

        return {
            type: 'failure_recovery',
            classification: classification.type,
            failedSteps: planResult.failedSteps,
            options: options,
            message: classification.description
        };
    }

    /**
     * Analisa resultado do plano e decide se precisa de intervenção do usuário.
     * @deprecated Use getReactiveState para unificação cognitiva
     */
    analyzePlanResult(planResult: PlanValidationResult): DecisionRequest | null {
        // ═══════════════════════════════════════════════════════════════════
        // ANTI-LOOP: Limite de decisões por tarefa
        // ═══════════════════════════════════════════════════════════════════
        if (this.decisionCount >= this.MAX_DECISIONS) {
            this.logger.error('max_decisions_reached', `[DECISION] Limite de decisões atingido (count=${this.decisionCount}, max=${this.MAX_DECISIONS})`);
            return {
                type: 'decision',
                message: t('decision.max_retries_reached', {
                    count: this.decisionCount
                }),
                failedSteps: planResult.failedSteps,
                completedSteps: planResult.completedSteps,
                totalSteps: planResult.totalSteps,
                options: [
                    { id: 'cancel', label: t('decision.option.cancel'), description: t('decision.option.cancel_desc') }
                ],
                context: 'max_decisions_reached'
            };
        }

        // ═══════════════════════════════════════════════════════════════════
        // Sucesso total → sem necessidade de decisão
        // ═══════════════════════════════════════════════════════════════════
        if (planResult.success) {
            this.logger.info('plan_success', '[DECISION] Plano executado com sucesso');
            return null;
        }

        // ═══════════════════════════════════════════════════════════════════
        // Classificar tipo de falha para sugerir ação adequada
        // ═══════════════════════════════════════════════════════════════════
        const failureClassification = this.classifyFailure(planResult);
        this.logger.info('failure_classified', '[DECISION] Falha classificada', {
            type: failureClassification.type,
            suggested: failureClassification.suggestedAction
        });

        // ═══════════════════════════════════════════════════════════════════
        // Falha total → sem steps completos
        // ═══════════════════════════════════════════════════════════════════
        if (planResult.completedSteps === 0) {
            this.logger.warn('plan_total_failure', '[DECISION] Plano falhou completamente');
            return this.createTotalFailureDecision(planResult, failureClassification);
        }

        // ═══════════════════════════════════════════════════════════════════
        // Falha parcial → alguns steps falharam
        // ═══════════════════════════════════════════════════════════════════
        this.logger.warn('plan_partial_failure', '[DECISION] Plano falhou parcialmente', {
            completed: planResult.completedSteps,
            total: planResult.totalSteps,
            failed: planResult.failedSteps.length
        });

        return this.createPartialFailureDecision(planResult, failureClassification);
    }

    /**
     * Classifica o tipo de falha para sugerir ação adequada.
     */
    private classifyFailure(planResult: PlanValidationResult): FailureClassification {
        const failedSteps = planResult.failedSteps;

        // Verificar se falhas são de contexto (falta de input)
        const contextFailures = failedSteps.filter(f =>
            f.error?.includes('context') ||
            f.error?.includes('input') ||
            f.error?.includes('source') ||
            f.error?.includes('arquivo') ||
            f.error?.includes('file')
        );

        if (contextFailures.length > 0) {
            return {
                type: 'context',
                description: 'Falta de contexto ou input',
                suggestedAction: 'adjust'
            };
        }

        // Verificar se falhas são de execução (comando, tool)
        const executionFailures = failedSteps.filter(f =>
            f.error?.includes('command') ||
            f.error?.includes('tool') ||
            f.error?.includes('exec') ||
            f.error?.includes('timeout')
        );

        if (executionFailures.length > 0) {
            return {
                type: 'execution',
                description: 'Erro de execução',
                suggestedAction: 'retry'
            };
        }

        // Verificar se falhas são de sistema
        const systemFailures = failedSteps.filter(f =>
            f.error?.includes('network') ||
            f.error?.includes('connection') ||
            f.error?.includes('permission') ||
            f.error?.includes('memory')
        );

        if (systemFailures.length > 0) {
            return {
                type: 'system',
                description: 'Erro de sistema',
                suggestedAction: 'cancel'
            };
        }

        // Default: falha de lógica
        return {
            type: 'logic',
            description: 'Falha de lógica do plano',
            suggestedAction: 'adjust'
        };
    }

    /**
     * Cria decisão para falha total (nenhum step completou).
     */
    private createTotalFailureDecision(planResult: PlanValidationResult, classification: FailureClassification): DecisionRequest {
        const failedSteps = planResult.failedSteps;
        const errorMessages = failedSteps
            .map(f => `• ${f.name}: ${f.error || 'erro desconhecido'}`)
            .join('\n');

        // Opções baseadas na classificação da falha
        const options = this.getOptionsForFailureType(classification);

        return {
            type: 'decision',
            message: t('decision.total_failure', {
                steps: errorMessages,
                count: failedSteps.length
            }),
            failedSteps,
            completedSteps: 0,
            totalSteps: planResult.totalSteps,
            options,
            context: classification.type
        };
    }

    /**
     * Cria decisão para falha parcial (alguns steps completaram).
     */
    private createPartialFailureDecision(planResult: PlanValidationResult, classification: FailureClassification): DecisionRequest {
        const failedSteps = planResult.failedSteps;
        const completedSteps = planResult.completedSteps;
        const totalSteps = planResult.totalSteps;

        // Detalhes dos steps que falharam
        const failedDetails = failedSteps
            .map(f => `• ${f.name}: ${f.error || 'falhou'}`)
            .join('\n');

        // Opções baseadas na classificação da falha
        const options = this.getOptionsForFailureType(classification);

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
            options,
            context: classification.type
        };
    }

    /**
     * Retorna opções baseadas no tipo de falha.
     */
    private getOptionsForFailureType(classification: FailureClassification): DecisionOption[] {
        switch (classification.type) {
            case 'context':
                // Falta de contexto → ajustar ou cancelar
                return [
                    { id: 'adjust', label: t('decision.option.adjust'), description: t('decision.option.adjust_desc') },
                    { id: 'cancel', label: t('decision.option.cancel'), description: t('decision.option.cancel_desc') }
                ];

            case 'execution':
                // Erro de execução → tentar novamente ou cancelar
                return [
                    { id: 'retry', label: t('decision.option.retry'), description: t('decision.option.retry_desc') },
                    { id: 'cancel', label: t('decision.option.cancel'), description: t('decision.option.cancel_desc') }
                ];

            case 'system':
                // Erro de sistema → cancelar
                return [
                    { id: 'cancel', label: t('decision.option.cancel'), description: t('decision.option.cancel_desc') }
                ];

            case 'logic':
            default:
                // Falha de lógica → todas as opções
                return this.getOptionsForPartialFailure();
        }
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
     * IMPORTANTE: Incrementa contador de decisões (anti-loop).
     */
    processUserDecision(decision: 'retry' | 'ignore' | 'adjust' | 'cancel', planResult: PlanValidationResult): DecisionResult {
        // Incrementar contador (anti-loop)
        this.decisionCount++;
        this.lastDecisionType = decision;

        this.logger.info('decision_processed', '[DECISION] Usuário decidiu', {
            decision,
            failedSteps: planResult.failedSteps.length,
            decisionCount: this.decisionCount
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
     * Reseta contador de decisões (para nova tarefa).
     */
    reset(): void {
        this.decisionCount = 0;
        this.lastDecisionType = undefined;
        this.logger.debug('decision_reset', '[DECISION] Contador resetado');
    }

    /**
     * Retorna contador atual (para debug).
     */
    getDecisionCount(): number {
        return this.decisionCount;
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

// Map por sessão para isolar estado entre conversas diferentes
const decisionHandlers = new Map<string, DecisionHandler>();

export function getDecisionHandler(sessionId: string): DecisionHandler {
    if (!decisionHandlers.has(sessionId)) {
        decisionHandlers.set(sessionId, new DecisionHandler());
    }
    return decisionHandlers.get(sessionId)!;
}

export function clearDecisionHandler(sessionId: string): void {
    decisionHandlers.delete(sessionId);
}