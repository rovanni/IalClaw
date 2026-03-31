import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { CapabilityRegistry } from './CapabilityRegistry';
import { Skill, SkillManager, createBrowserSkill, createBuiltinFsSkill, createNodeExecutionSkill, createWhisperSkill, createTtsSkill, createFfmpegSkill } from './SkillManager';

const execAsync = promisify(exec);

export const capabilityRegistry = new CapabilityRegistry();
export const skillManager = new SkillManager(
    capabilityRegistry,
    (process.env.SKILL_POLICY as 'auto-install' | 'ask-user' | 'strict-no-install') || 'ask-user'
);

skillManager.register(createBuiltinFsSkill());
skillManager.register(createNodeExecutionSkill());
skillManager.register(createBrowserSkill());
skillManager.register(createWhisperSkill());
skillManager.register(createTtsSkill());
skillManager.register(createFfmpegSkill());
skillManager.register(createSudoPermissionsSkill());

export function createSudoPermissionsSkill(): Skill {
    return {
        id: 'sudo_permissions',
        provides: ['sudo_permissions'],
        check: async () => {
            if (process.platform === 'win32') return true; // Ignoramos em Windows
            if (process.env.IALCLAW_USER === 'root') return true;

            const user = process.env.IALCLAW_USER || (await execAsync('whoami')).stdout.trim();
            const sudoersFile = `/etc/sudoers.d/ialclaw-${user}`;
            return fs.existsSync(sudoersFile);
        },
        install: async () => {
            const scriptPath = path.join(process.cwd(), 'skills', 'internal', 'setup-system-permissions', 'scripts', 'setup-permissions.sh');
            await execAsync(`bash "${scriptPath}"`);
        }
    };
}
