import { ConfidenceScorer } from './src/core/autonomy/ConfidenceScorer';

async function testConfidenceScorer() {
    const scorer = new ConfidenceScorer();

    const cases = [
        {
            label: "High Confidence (Clear Action + Memory)",
            input: {
                classifierConfidence: 0.95,
                routerConfidence: 0.99,
                memoryHits: [{ score: 0.9, content: 'previous action hit' }]
            },
            expectedLevel: 'high',
            minScore: 0.95
        },
        {
            label: "Medium Confidence (Uncertain Router)",
            input: {
                classifierConfidence: 0.90,
                routerConfidence: 0.70,
                memoryHits: []
            },
            expectedLevel: 'medium',
            minScore: 0.75
        },
        {
            label: "Low Confidence (Weak Classifier + Weak Router)",
            input: {
                classifierConfidence: 0.50,
                routerConfidence: 0.50,
                memoryHits: []
            },
            expectedLevel: 'low',
            minScore: 0.50
        }
    ];

    console.log("══ ConfidenceScorer Verification ══");
    let passed = 0;

    for (const c of cases) {
        const result = scorer.calculate(c.input);

        const success = result.level === c.expectedLevel && result.score >= c.minScore;

        console.log(`${success ? '✅' : '❌'} [${c.label}]`);
        console.log(`   Score: ${result.score.toFixed(2)} (Exp: >=${c.minScore.toFixed(2)})`);
        console.log(`   Level: ${result.level} (Exp: ${c.expectedLevel})`);
        console.log(`   Factors: Classifier: ${result.factors.classifier}, Router: ${result.factors.router}, Memory: ${result.factors.memoryBonus}`);

        if (success) passed++;
    }

    console.log(`\nResult: ${passed}/${cases.length} passed.`);
    process.exit(passed === cases.length ? 0 : 1);
}

testConfidenceScorer().catch(err => {
    console.error(err);
    process.exit(1);
});
