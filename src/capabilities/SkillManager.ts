import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { Capability, CapabilityRegistry, listCanonicalCapabilities } from './CapabilityRegistry';
import { canonicalizeCapability } from './canonicalizeCapability';
import { emitDebug } from '../shared/DebugBus';
import { findBinary, resolveBinary, detectWhisper } from '../shared/BinaryUtils';
import { createLogger } from '../shared/AppLogger';

const execAsync = promisify(exec);
const logger = createLogger('SkillManager');

export type SkillPolicy =
    | 'auto-install'
    | 'ask-user'
    | 'strict-no-install';

export type Skill = {
    id: string;
    provides: Capability[];
    capabilities?: string[];
    check: () => Promise<boolean>;
    install?: () => Promise<void>;
};

export type CapabilityAuditEntry = {
    skillId: string;
    raw: string;
    normalized: string;
    canonical: string;
    isKnown: boolean;
    isUnknown: boolean;
    source: 'skill_frontmatter';
    timestamp: string;
};

export class SkillManager {
    private skills: Skill[] = [];
    private ongoingChecks = new Map<Capability, Promise<boolean>>();
    private dynamicSkillIds = new Set<string>();
    private capabilityAuditLog: CapabilityAuditEntry[] = [];

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

    listSkillIds(): string[] {
        return Array.from(new Set(this.skills.map(skill => skill.id)));
    }

    hasSkill(skillId: string): boolean {
        const normalizedSkillId = this.normalizeSkillId(skillId);
        return this.skills.some(skill => this.normalizeSkillId(skill.id) === normalizedSkillId);
    }

    syncLoadedSkills(skills: Array<{ id: string; capabilities?: string[] }>): void {
        this.skills = this.skills.filter(skill => !this.dynamicSkillIds.has(skill.id));
        this.dynamicSkillIds.clear();
        this.capabilityAuditLog = [];

        for (const skill of skills) {
            if (!skill?.id) {
                continue;
            }

            const capabilities = Array.isArray(skill.capabilities)
                ? skill.capabilities.filter((capability): capability is string => typeof capability === 'string' && capability.trim().length > 0)
                : [];

            const canonicalCapabilities: string[] = [];

            for (const rawCapability of capabilities) {
                const canonicalized = this.auditDeclaredCapability(skill.id, rawCapability);
                if (!canonicalized) {
                    continue;
                }

                if (!canonicalCapabilities.includes(canonicalized)) {
                    canonicalCapabilities.push(canonicalized);
                }
            }

            this.skills.push({
                id: skill.id,
                provides: [],
                capabilities: canonicalCapabilities,
                check: async () => true
            });

            this.dynamicSkillIds.add(skill.id);
        }
    }

    getCapabilityIndex(): Record<string, string[]> {
        const capabilityIndex: Record<string, string[]> = {};

        for (const skill of this.skills) {
            const declaredCapabilities = Array.isArray(skill.capabilities) && skill.capabilities.length > 0
                ? skill.capabilities
                : skill.provides;

            for (const declaredCapability of declaredCapabilities) {
                const canonicalCapability = this.normalizeDeclaredCapability(String(declaredCapability || ''));
                if (!canonicalCapability) {
                    continue;
                }

                capabilityIndex[canonicalCapability] ||= [];
                if (!capabilityIndex[canonicalCapability].includes(skill.id)) {
                    capabilityIndex[canonicalCapability].push(skill.id);
                }
            }
        }

        return capabilityIndex;
    }

    getCapabilityAuditLog(): CapabilityAuditEntry[] {
        return [...this.capabilityAuditLog];
    }

    getUnknownCapabilities(): string[] {
        return Array.from(new Set(
            this.capabilityAuditLog
                .filter(entry => entry.isUnknown)
                .map(entry => entry.canonical)
        ));
    }

    getUnusedCapabilities(): string[] {
        const index = this.getCapabilityIndex();
        return listCanonicalCapabilities().filter(capability => !(capability in index));
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

    private normalizeDeclaredCapability(capability: string): string | undefined {
        const canonicalized = canonicalizeCapability(capability);
        return canonicalized.isKnown ? canonicalized.canonical : undefined;
    }

    private auditDeclaredCapability(skillId: string, rawCapability: string): string | undefined {
        const canonicalized = canonicalizeCapability(rawCapability);
        const entry: CapabilityAuditEntry = {
            skillId,
            raw: rawCapability,
            normalized: canonicalized.normalized,
            canonical: canonicalized.canonical,
            isKnown: canonicalized.isKnown,
            isUnknown: canonicalized.isUnknown,
            source: 'skill_frontmatter',
            timestamp: new Date().toISOString()
        };

        this.capabilityAuditLog.push(entry);

        if (canonicalized.isUnknown) {
            // TODO(KB-050): migrar politica de tratamento de unknown para governanca explicita no Orchestrator.
            logger.warn('unknown_capability_detected', '[KB-050] Unknown capability detectada no frontmatter; mantendo apenas auditoria', {
                skillId,
                raw: rawCapability,
                normalized: canonicalized.normalized,
                canonical: canonicalized.canonical
            });
            emitDebug('unknown_capability_detected', {
                skillId,
                raw: rawCapability,
                normalized: canonicalized.normalized,
                canonical: canonicalized.canonical,
                source: 'skill_frontmatter'
            });
            return undefined;
        }

        return canonicalized.canonical;
    }

    private normalizeSkillId(skillId: string): string {
        return String(skillId || '').trim().toLowerCase().replace(/\s+/g, '-');
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

export function createWhisperSkill(): Skill {
    return {
        id: 'whisper',
        provides: ['whisper_transcription'],
        check: async () => {
            try {
                // Generalized whisper detection
                if (!detectWhisper().available) return false;

                // Check for ffmpeg
                return findBinary('ffmpeg') !== null;
            } catch {
                return false;
            }
        },
        install: async () => {
            const python = resolveBinary('python3') || resolveBinary('python');

            // Se FFmpeg não estiver presente, tentar instalar primeiro
            if (findBinary('ffmpeg') === null) {
                const isWindows = process.platform === 'win32';
                const ffmpegCmd = isWindows ? 'winget install ffmpeg' : 'sudo apt update && sudo apt install ffmpeg -y';
                try {
                    await execAsync(ffmpegCmd);
                } catch (e) {
                    console.error('Failed to install ffmpeg automatically:', e);
                }
            }

            await execAsync(`${python} -m pip install openai-whisper`);
        }
    };
}

export function createTtsSkill(): Skill {
    return {
        id: 'tts',
        provides: ['tts_generation'],
        check: async () => {
            try {
                // Generalized script path resolution
                const ttsScript = process.env.TTS_SCRIPT_PATH ||
                    path.join(process.cwd(), "workspace", "scripts", "tts.sh") ||
                    path.join(process.cwd(), "scripts", "tts.sh");

                if (!fs.existsSync(ttsScript)) return false;

                // Check for ffmpeg
                return findBinary('ffmpeg') !== null;
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

export function createFfmpegSkill(): Skill {
    return {
        id: 'ffmpeg',
        provides: ['ffmpeg'],
        check: async () => findBinary('ffmpeg') !== null,
        install: async () => {
            const isWindows = process.platform === 'win32';
            const cmd = isWindows ? 'winget install ffmpeg' : 'sudo apt update && sudo apt install ffmpeg -y';
            await execAsync(cmd);
        }
    };
}
