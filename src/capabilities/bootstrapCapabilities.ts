import { Capability, CapabilityRegistry } from './CapabilityRegistry';
import { SkillManager } from './SkillManager';

export async function bootstrapCapabilities(
    registry: CapabilityRegistry,
    skillManager: SkillManager
) {
    const allCapabilities: Capability[] = [
        'browser_execution',
        'fs_access',
        'node_execution',
        'whisper_transcription',
        'tts_generation',
        'ffmpeg',
        'sudo_permissions'
    ];

    const results = await Promise.allSettled(
        allCapabilities.map(capability =>
            skillManager.ensure(capability, 'strict-no-install')
        )
    );

    for (let i = 0; i < allCapabilities.length; i++) {
        const capability = allCapabilities[i];
        const result = results[i];
        const success = result.status === 'fulfilled' && result.value === true;

        registry.set(capability, {
            available: success,
            source: 'bootstrap',
            checkedAt: Date.now()
        });
    }
}
