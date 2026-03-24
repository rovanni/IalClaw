import { Capability, CapabilityRegistry } from './CapabilityRegistry';
import { SkillManager } from './SkillManager';

export async function bootstrapCapabilities(
    registry: CapabilityRegistry,
    skillManager: SkillManager
) {
    const allCapabilities: Capability[] = [
        'browser_execution',
        'fs_access',
        'node_execution'
    ];

    for (const capability of allCapabilities) {
        await skillManager.ensure(capability, 'strict-no-install');
        if (!registry.get(capability)) {
            registry.set(capability, {
                available: false,
                source: 'bootstrap',
                checkedAt: Date.now()
            });
        }
    }
}
