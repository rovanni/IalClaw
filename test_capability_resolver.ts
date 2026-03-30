import { CapabilityResolver, CapabilityStatus, ProvisionerAdapter, ResolutionProposal } from './src/core/autonomy/CapabilityResolver';
import { TaskType } from './src/core/agent/TaskClassifier';
import { TaskNature } from './src/core/autonomy/ActionRouter';

// Mock Adapter para testes consistentes
class MockProvisionerAdapter implements ProvisionerAdapter {
    constructor(private missingTools: string[]) { }

    isInstalled(tool: string): boolean {
        return !this.missingTools.includes(tool.toLowerCase());
    }

    resolveSolution(tool: string): ResolutionProposal['solution'] {
        return {
            type: 'install',
            tool: tool,
            command: `mock-install ${tool}`,
            requiresConfirmation: true
        };
    }
}

async function testCapabilityResolver() {
    // Mock que ffmpeg está faltando, mas git está presente
    const mockAdapter = new MockProvisionerAdapter(['ffmpeg']);
    const resolver = new CapabilityResolver();

    // @ts-ignore - Injetando mock para teste
    resolver['adapter'] = mockAdapter;

    const cases = [
        {
            label: "Blocking Gap (Video)",
            input: "Converta este vídeo para MP4",
            taskType: 'file_conversion' as TaskType,
            nature: TaskNature.EXECUTABLE,
            expectedStatus: CapabilityStatus.MISSING,
            expectedGap: 'ffmpeg'
        },
        {
            label: "Informative Anti-Regression",
            input: "Como funciona a conversão de vídeo?",
            taskType: 'file_conversion' as TaskType,
            nature: TaskNature.INFORMATIVE,
            expectedStatus: CapabilityStatus.AVAILABLE,
            expectedGap: null
        },
        {
            label: "Available Tool (VCS)",
            input: "Faça commit das alterações",
            taskType: 'system_operation' as TaskType,
            nature: TaskNature.EXECUTABLE,
            expectedStatus: CapabilityStatus.AVAILABLE,
            expectedGap: null
        }
    ];

    console.log("══ Mature CapabilityResolver Verification (Mocked) ══");
    let passed = 0;

    for (const c of cases) {
        const resolution = resolver.resolve(c.input, c.taskType, c.nature);

        const statusSuccess = resolution.status === c.expectedStatus;
        const gapSuccess = c.expectedGap
            ? (resolution.hasGap && resolution.gap?.resource === c.expectedGap)
            : !resolution.hasGap;

        const success = statusSuccess && gapSuccess;

        console.log(`${success ? '✅' : '❌'} [${c.label}]`);
        console.log(`   Input: "${c.input}"`);
        console.log(`   Status: ${resolution.status} (Exp: ${c.expectedStatus})`);

        if (resolution.hasGap) {
            console.log(`   Gap: ${resolution.gap?.resource} | Severity: ${resolution.gap?.severity}`);
            console.log(`   Solution: ${resolution.solution?.command}`);
        }

        if (success) passed++;
    }

    console.log(`\nResult: ${passed}/${cases.length} passed.`);
    process.exit(passed === cases.length ? 0 : 1);
}

testCapabilityResolver().catch(err => {
    console.error(err);
    process.exit(1);
});
