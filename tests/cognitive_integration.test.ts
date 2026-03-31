import { decideAutonomy, AutonomyDecision, AutonomyLevel } from '../src/core/autonomy/DecisionEngine';
import { UncertaintyType } from '../src/core/autonomy/ConfidenceScorer';

async function runTests() {
    console.log('🧪 Starting Cognitive Integration Tests...\n');

    // Test 1: Conflict Detection Priority
    console.log('Test 1: Conflict Detection Priority');
    const conflictCtx = {
        intent: 'test',
        isContinuation: false,
        hasAllParams: true,
        riskLevel: 'low' as any,
        isDestructive: false,
        isReversible: true,
        aggregatedConfidence: {
            score: 0.5,
            isConflict: true,
            uncertaintyType: UncertaintyType.CONFLICT,
            factors: { classifier: 0.9, router: 0.3 }
        } as any,
        suggestedIntent: { type: 'execute' },
        cognitiveState: { hasPendingAction: true } // Simulation of state that would normally trigger EXECUTE_PENDING
    };

    const decision1 = decideAutonomy(conflictCtx);
    if (decision1 === AutonomyDecision.ASK_EXECUTION_STRATEGY) {
        console.log('✅ OK: Conflict took precedence over pending action.');
    } else {
        console.error(`❌ FAIL: Expected ASK_EXECUTION_STRATEGY, got ${decision1}`);
    }

    // Test 2: Conflict + Reactive simultaneous (Critical Case)
    console.log('\nTest 2: Conflict + Reactive simultaneous');
    const conflictReactiveCtx = {
        intent: 'test',
        isContinuation: true,
        hasAllParams: true,
        riskLevel: 'low' as any,
        isDestructive: false,
        isReversible: true,
        aggregatedConfidence: {
            score: 0.5,
            isConflict: true,
            uncertaintyType: UncertaintyType.CONFLICT,
            factors: { classifier: 0.9, router: 0.3 }
        } as any,
        suggestedIntent: { type: 'retry' },
        cognitiveState: { hasReactiveFailure: true } // Simulation of failure that would normally trigger RETRY
    };

    const decision2 = decideAutonomy(conflictReactiveCtx);
    if (decision2 === AutonomyDecision.ASK_EXECUTION_STRATEGY) {
        console.log('✅ OK: Conflict took precedence over reactive recovery.');
    } else {
        console.error(`❌ FAIL: Expected ASK_EXECUTION_STRATEGY, got ${decision2}`);
    }

    // Test 3: Reactive Recovery (Normal)
    console.log('\nTest 3: Reactive Recovery (Normal)');
    const normalReactiveCtx = {
        intent: 'test',
        isContinuation: true,
        hasAllParams: true,
        riskLevel: 'low' as any,
        isDestructive: false,
        isReversible: true,
        aggregatedConfidence: {
            score: 0.95,
            isConflict: false,
            uncertaintyType: UncertaintyType.NONE,
            factors: { classifier: 0.95, router: 0.95 }
        } as any,
        suggestedIntent: { type: 'retry' },
        cognitiveState: { hasReactiveFailure: true }
    };

    const decision3 = decideAutonomy(normalReactiveCtx);
    if (decision3 === AutonomyDecision.RETRY) {
        console.log('✅ OK: System correctly decided to RETRY.');
    } else {
        console.error(`❌ FAIL: Expected RETRY, got ${decision3}`);
    }

    // Test 4: Uncertainty (Intent)
    console.log('\nTest 4: Uncertainty (Intent)');
    const intentUncertaintyCtx = {
        intent: 'test',
        isContinuation: false,
        hasAllParams: true,
        riskLevel: 'low' as any,
        isDestructive: false,
        isReversible: true,
        aggregatedConfidence: {
            score: 0.5,
            isConflict: false,
            uncertaintyType: UncertaintyType.INTENT,
            factors: { classifier: 0.4, router: 0.9 }
        } as any
    };

    const decision4 = decideAutonomy(intentUncertaintyCtx);
    if (decision4 === AutonomyDecision.ASK_CLARIFICATION) {
        console.log('✅ OK: System asked for clarification on uncertain intent.');
    } else {
        console.error(`❌ FAIL: Expected ASK_CLARIFICATION, got ${decision4}`);
    }

    console.log('\n🏁 Tests Finished.');
}

runTests().catch(console.error);
