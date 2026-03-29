import { exec } from 'child_process';
import { promisify } from 'util';
import { Capability, CapabilityRegistry } from './CapabilityRegistry';
import { emitDebug } from '../shared/DebugBus';

const execAsync = promisify(exec);

export type SkillPolicy =
    | 'auto-install'
    | 'ask-user'
    | 'strict-no-install';

export type Skill = {
    id: string;
    provides: Capability[];
    check: () => Promise<boolean>;
    install?: () => Promise<void>;
};

export class SkillManager {
    private skills: Skill[] = [];
    private ongoingChecks = new Map<Capability, Promise<boolean>>();

    constructor(
        private registry: CapabilityRegistry,
        private policy: SkillPolicy = 'ask-user'
    ) { }

    register(skill: Skill) {
        this.skills.push(skill);
    }

    setPolicy(policy: SkillPolicy) {
        this.policy = policy;
    }

    getPolicy(): SkillPolicy {
        return this.policy;
    }

    async ensure(capability: Capability, overridePolicy?: SkillPolicy): Promise<boolean> {
        const activePolicy = overridePolicy || this.policy;
        const existing = this.registry.get(capability);

        emitDebug('capability_required', {
            capability,
            policy: activePolicy
        });

        if (existing?.available) {
            emitDebug('capability_available', {
                capability,
                source: existing.source
            });
            return true;
        }

        if (this.ongoingChecks.has(capability)) {
            return this.ongoingChecks.get(capability)!;
        }

        const skill = this.skills.find(candidate => candidate.provides.includes(capability));
        if (!skill) {
            emitDebug('skill_not_found', { capability });
            return false;
        }

        const checkPromise = (async () => {
            try {
                return await skill.check();
            } finally {
                this.ongoingChecks.delete(capability);
            }
        })();

        this.ongoingChecks.set(capability, checkPromise);
        const ok = await checkPromise;
        if (ok) {
            this.registry.set(capability, {
                available: true,
                source: `skill:${skill.id}`,
                checkedAt: Date.now()
            });

            emitDebug('capability_available', {
                capability,
                source: `skill:${skill.id}`
            });
            return true;
        }

        emitDebug('skill_missing', {
            capability,
            skill: skill.id,
            policy: activePolicy
        });

        if (activePolicy === 'strict-no-install') {
            return false;
        }

        if (activePolicy === 'ask-user') {
            emitDebug('skill_install_required', {
                capability,
                skill: skill.id
            });
            return false;
        }

        if (activePolicy === 'auto-install' && skill.install) {
            emitDebug('skill_auto_install_start', {
                capability,
                skill: skill.id
            });

            try {
                await skill.install();
                const okAfter = await skill.check();

                this.registry.set(capability, {
                    available: okAfter,
                    source: `skill:${skill.id}`,
                    checkedAt: Date.now()
                });

                emitDebug('skill_auto_install_result', {
                    capability,
                    skill: skill.id,
                    success: okAfter
                });

                return okAfter;
            } catch (error: any) {
                emitDebug('skill_auto_install_failed', {
                    capability,
                    skill: skill.id,
                    error: error.message
                });
                return false;
            }
        }

        return false;
    }
}

export function createBuiltinFsSkill(): Skill {
    return {
        id: 'builtin_fs',
        provides: ['fs_access'],
        check: async () => true
    };
}

export function createNodeExecutionSkill(): Skill {
    return {
        id: 'node_runtime',
        provides: ['node_execution'],
        check: async () => {
            try {
                await execAsync('node -v', { cwd: process.cwd() });
                return true;
            } catch {
                return false;
            }
        }
    };
}

export function createBrowserSkill(): Skill {
    return {
        id: 'browser',
        provides: ['browser_execution'],
        check: async () => {
            let puppeteer;
            try {
                puppeteer = require('puppeteer');
            } catch {
                emitDebug('puppeteer_not_installed', { capability: 'browser_execution' });
                return false;
            }

            try {
                const browser = await Promise.race([
                    puppeteer.launch({
                        headless: true,
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    }),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('puppeteer_timeout')), 10000)
                    )
                ]);
                await browser.close();
                return true;
            } catch (err: any) {
                emitDebug('capability_check_failed', {
                    capability: 'browser_execution',
                    stage: err.message === 'puppeteer_timeout' ? 'timeout' : 'check',
                    error: err.message
                });
                return false;
            }
        },
        install: async () => {
            const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

            await Promise.race([
                execAsync(`${npmCommand} install puppeteer`, {
                    cwd: process.cwd()
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('install_timeout')), 30000)
                )
            ]);
        }
    };
}
