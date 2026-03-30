import { ConfidenceScorer, UncertaintyType } from '../core/autonomy/ConfidenceScorer';
import { decideAutonomy, AutonomyDecision, AutonomyLevel } from '../core/autonomy/DecisionEngine';
import { TaskNature, ExecutionRoute } from '../core/autonomy/ActionRouter';

async function runTests() {
    const scorer = new ConfidenceScorer();

    console.log("=== Test 1: Informative Task (Intent-heavy) ===");
    const score1 = scorer.calculate({
        classifierConfidence: 0.95,
        routerConfidence: 0.50,
        nature: TaskNature.INFORMATIVE
    });
    console.log(`Score: ${score1.score.toFixed(2)}, Uncertainty: ${score1.uncertaintyType}, Level: ${score1.level}`);
    const decision1 = decideAutonomy({
        intent: 'info',
        isContinuation: false,
        hasAllParams: true,
        riskLevel: 'low',
        isDestructive: false,
        isReversible: true,
        aggregatedConfidence: score1,
        nature: TaskNature.INFORMATIVE
    });
    console.log(`Decision: ${decision1} (Expected: execute because info + low risk)\n`);

    console.log("=== Test 2: Executable Task (Action-heavy, Low Router) ===");
    const score2 = scorer.calculate({
        classifierConfidence: 0.90,
        routerConfidence: 0.55,
        nature: TaskNature.EXECUTABLE
    });
    console.log(`Score: ${score2.score.toFixed(2)}, Uncertainty: ${score2.uncertaintyType}`);
    const decision2 = decideAutonomy({
        intent: 'file_op',
        isContinuation: false,
        hasAllParams: true,
        riskLevel: 'medium',
        isDestructive: false,
        isReversible: true,
        aggregatedConfidence: score2,
        nature: TaskNature.EXECUTABLE
    });
    console.log(`Decision: ${decision2} (Expected: ask_tool_selection)\n`);

    console.log("=== Test 3: Conflict Detection (High Intent, Low Router) ===");
    const score3 = scorer.calculate({
        classifierConfidence: 0.98,
        routerConfidence: 0.40,
        nature: TaskNature.EXECUTABLE
    });
    console.log(`Score: ${score3.score.toFixed(2)}, Conflict: ${score3.isConflict}, Uncertainty: ${score3.uncertaintyType}`);
    const decision3 = decideAutonomy({
        intent: 'complex_op',
        isContinuation: false,
        hasAllParams: true,
        riskLevel: 'medium',
        isDestructive: false,
        isReversible: true,
        aggregatedConfidence: score3,
        nature: TaskNature.EXECUTABLE
    });
    console.log(`Decision: ${decision3} (Expected: ask_strategy)\n`);

    console.log("=== Test 4: Low Intent Confidence ===");
    const score4 = scorer.calculate({
        classifierConfidence: 0.40,
        routerConfidence: 0.90,
        nature: TaskNature.INFORMATIVE
    });
    console.log(`Score: ${score4.score.toFixed(2)}, Uncertainty: ${score4.uncertaintyType}`);
    const decision4 = decideAutonomy({
        intent: 'unknown',
        isContinuation: false,
        hasAllParams: true,
        riskLevel: 'low',
        isDestructive: false,
        isReversible: true,
        aggregatedConfidence: score4,
        nature: TaskNature.INFORMATIVE
    });
    console.log(`Decision: ${decision4} (Expected: ask_clarification)\n`);

    console.log("=== Test 5: Capability Gap + Low Router Confidence ===");
    const score5 = scorer.calculate({
        classifierConfidence: 0.95,
        routerConfidence: 0.65,
        nature: TaskNature.EXECUTABLE
    });
    const decision5 = decideAutonomy({
        intent: 'video_conversion',
        isContinuation: false,
        hasAllParams: true,
        riskLevel: 'medium',
        isDestructive: false,
        isReversible: true,
        aggregatedConfidence: score5,
        nature: TaskNature.EXECUTABLE,
        capabilityGap: {
            hasGap: true,
            status: 'missing' as any,
            gap: { resource: 'ffmpeg', severity: 'blocking', reason: 'video', task: 'conv' }
        }
    });
    console.log(`Decision: ${decision5} (Expected: ask_tool_selection because router < 0.70)\n`);
}

runTests().catch(console.error);
