import { getActionRouter, IntentSubtype } from './src/core/autonomy/ActionRouter';
import { decideAutonomy, AutonomyLevel, AutonomyDecision } from './src/core/autonomy/DecisionEngine';
import { TaskType } from './src/core/agent/TaskClassifier';

async function testCognitiveRefinements() {
    const router = getActionRouter();

    const cases = [
        {
            label: "COMMAND CLEAR",
            input: "mova os arquivos html para workspace",
            expectedSubtype: IntentSubtype.COMMAND,
            expectedDecision: AutonomyDecision.EXECUTE,
            autonomyLevel: AutonomyLevel.BALANCED
        },
        {
            label: "SUGGESTION",
            input: "acho que deveria mover os html",
            expectedSubtype: IntentSubtype.SUGGESTION,
            expectedDecision: AutonomyDecision.ASK, // Sugestões devem ser confirmadas
            autonomyLevel: AutonomyLevel.BALANCED
        },
        {
            label: "DOUBT",
            input: "por que os arquivos estão na raiz?",
            expectedSubtype: IntentSubtype.DOUBT,
            expectedDecision: AutonomyDecision.ASK, // Dúvida deve ser respondida, não agir
            autonomyLevel: AutonomyLevel.BALANCED
        },
        {
            label: "SAFE MODE COMMAND",
            input: "mova os arquivos",
            expectedSubtype: IntentSubtype.COMMAND,
            expectedDecision: AutonomyDecision.CONFIRM, // SAFE sempre confirma
            autonomyLevel: AutonomyLevel.SAFE
        },
        {
            label: "AGGRESSIVE SUGGESTION",
            input: "acho que deveria mover",
            expectedSubtype: IntentSubtype.SUGGESTION,
            expectedDecision: AutonomyDecision.ASK, // Sugestão ainda é duvidosa, mas no agressivo se risco baixo poderia ser diferente. Aqui o router baixa confiança substancialmente.
            autonomyLevel: AutonomyLevel.AGGRESSIVE
        }
    ];

    console.log("══ Cognitive Refinement Verification ══");
    let passed = 0;
    for (const c of cases) {
        const routeDecision = router.decideRoute(c.input, 'system_operation' as TaskType);

        const autonomyCtx = {
            intent: 'system_operation',
            isContinuation: false,
            hasAllParams: true,
            riskLevel: 'medium' as const,
            isDestructive: false,
            isReversible: true,
            confidence: routeDecision.confidence,
            autonomyLevel: c.autonomyLevel,
            intentSubtype: routeDecision.subtype
        };

        const decision = decideAutonomy(autonomyCtx);

        const subtypeSuccess = routeDecision.subtype === c.expectedSubtype;
        const decisionSuccess = decision === c.expectedDecision;

        const success = subtypeSuccess && decisionSuccess;

        console.log(`${success ? '✅' : '❌'} [${c.label}]`);
        console.log(`   Input: "${c.input}"`);
        console.log(`   Subtype: ${routeDecision.subtype} (Exp: ${c.expectedSubtype}) | ${subtypeSuccess ? 'OK' : 'FAIL'}`);
        console.log(`   Decision: ${decision} (Exp: ${c.expectedDecision}) | ${decisionSuccess ? 'OK' : 'FAIL'}`);
        console.log(`   Confidence: ${routeDecision.confidence.toFixed(2)}`);

        if (success) passed++;
    }

    console.log(`\nResult: ${passed}/${cases.length} passed.`);
    process.exit(passed === cases.length ? 0 : 1);
}

testCognitiveRefinements().catch(err => {
    console.error(err);
    process.exit(1);
});
