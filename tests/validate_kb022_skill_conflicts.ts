import { CognitiveOrchestrator } from '../src/core/orchestrator/CognitiveOrchestrator';
import { ExecutionRoute } from '../src/engine/AgentLoop';

async function validateConflicts() {
    console.log('🧪 Iniciando Validação Dirigida - KB-022 (Skill Flow Conflicts)\n');

    // Mocks mínimos
    const mockMemory = {} as any;
    const mockFlowManager = { isInFlow: () => false } as any;
    
    const orchestrator = new CognitiveOrchestrator(mockMemory, mockFlowManager);
    const sessionId = 'test-session-skill';

    // Cenário 1: route vs failSafe (Fluxo de Skill)
    console.log('Cenário 1: route vs failSafe');
    orchestrator.ingestSignalsFromLoop({
        route: {
            recommendedStrategy: 'EXECUTE',
            route: ExecutionRoute.TOOL_LOOP,
            reason: 'Necessário para skill',
            confidence: 0.9,
            requiresUserConfirmation: false
        },
        failSafe: {
            activated: true,
            trigger: 'excessive_tool_calls'
        }
    } as any, sessionId);

    let decisions = orchestrator.applyActiveDecisions(sessionId);
    
    if (decisions.applied.failSafe?.activated && decisions.applied.route?.recommendedStrategy === 'EXECUTE') {
        console.log('✅ OK: Ambos os sinais foram capturados.');
        console.log('📝 Auditoria: Verificando se o conflito foi logado (checar logs no terminal)...');
        orchestrator.auditSignalConsistency(sessionId);
    } else {
        console.error('❌ FAIL: Falha ao capturar sinais no applyActiveDecisions.');
    }

    // Cenário 2: validation vs stopContinue
    console.log('\nCenário 2: validation vs stopContinue');
    orchestrator.ingestSignalsFromLoop({
        validation: {
            validationPassed: false,
            failureReason: 'Saída inesperada',
            confidence: 1.0,
            reason: 'Critério de skill não atingido'
        },
        stop: {
            shouldStop: false,
            reason: 'Ainda restam etapas na skill',
            globalConfidence: 0.8
        }
    } as any, sessionId);

    decisions = orchestrator.applyActiveDecisions(sessionId);
    
    if (decisions.applied.validation?.validationPassed === false && decisions.applied.stop?.shouldStop === false) {
        console.log('✅ OK: Validação negativa e continuidade coexistindo (correto no safeMode).');
        console.log('📊 safeModeFallbackApplied.validation:', decisions.safeModeFallbackApplied.validation);
    } else {
        console.error('❌ FAIL: Inconsistência na aplicação de validation/stop.');
    }

    // Cenário 3: fallback vs route
    console.log('\nCenário 3: fallback vs route');
    orchestrator.ingestSignalsFromLoop({
        fallback: {
            trigger: 'tool_not_found',
            fallbackRecommended: true,
            originalTool: 'missing_tool',
            suggestedTool: 'bash',
            reason: 'Skill fallback'
        },
        route: {
            recommendedStrategy: 'EXECUTE',
            route: ExecutionRoute.DIRECT_LLM,
            reason: 'Resposta direta'
        }
    } as any, sessionId);

    decisions = orchestrator.applyActiveDecisions(sessionId);
    
    if (decisions.applied.fallback?.fallbackRecommended && decisions.applied.route?.route === ExecutionRoute.DIRECT_LLM) {
        console.log('✅ OK: Fallback recomendado e rota direta aplicados.');
        orchestrator.auditSignalConsistency(sessionId);
    }

    console.log('\n🏁 Validação concluída.');
}

validateConflicts().catch(err => {
    console.error('❌ Erro durante a validação:', err);
    process.exit(1);
});
