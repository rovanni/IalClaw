import path from 'path';
import { SkillLoader } from '../src/skills/SkillLoader';
import { canonicalizeCapability } from '../src/capabilities/canonicalizeCapability';
import { validateAliasMap } from '../src/capabilities/capabilityAliasMap';

type UnknownCapabilityEntry = {
    skillId: string;
    raw: string;
    normalized: string;
    canonical: string;
};

function parseAllowList(): Set<string> {
    const raw = String(process.env.CAPABILITY_UNKNOWN_ALLOWLIST || '');
    const items = raw
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
    return new Set(items);
}

function isCiMode(): boolean {
    return String(process.env.CI || '').toLowerCase() === 'true';
}

function main(): void {
    validateAliasMap();

    const root = path.join(__dirname, '..');
    const skillsRoot = path.join(root, 'skills');
    const loader = new SkillLoader(skillsRoot);
    const skills = loader.load();
    const unknowns: UnknownCapabilityEntry[] = [];

    for (const skill of skills) {
        for (const capability of skill.capabilities || []) {
            const canonicalized = canonicalizeCapability(capability);
            if (!canonicalized.isUnknown) {
                continue;
            }

            unknowns.push({
                skillId: skill.id,
                raw: capability,
                normalized: canonicalized.normalized,
                canonical: canonicalized.canonical
            });
        }
    }

    if (unknowns.length === 0) {
        console.log('[KB-050] validateCapabilities: OK (nenhuma capability unknown detectada)');
        return;
    }

    const allowList = parseAllowList();
    const nonApproved = unknowns.filter(entry => !allowList.has(entry.canonical));

    console.warn(`[KB-050] validateCapabilities: ${unknowns.length} unknown capability(s) detectada(s)`);
    for (const entry of unknowns) {
        console.warn(` - skill=${entry.skillId} raw="${entry.raw}" normalized="${entry.normalized}" canonical="${entry.canonical}"`);
    }

    if (isCiMode() && nonApproved.length > 0) {
        throw new Error(`[KB-050] CI bloqueado: ${nonApproved.length} unknown capability(s) sem aprovacao em CAPABILITY_UNKNOWN_ALLOWLIST`);
    }
}

try {
    main();
} catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[KB-050] validateCapabilities: FAIL - ${message}`);
    process.exit(1);
}
