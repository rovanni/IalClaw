import fs from 'fs';
import path from 'path';
import { LoadedSkill } from './types';
import { AuditLog } from './AuditLog';
import { createLogger } from '../shared/AppLogger';
import { t } from '../i18n';

const logger = createLogger('SkillLoader');

/**
 * Lê e parseia os SKILL.md disponíveis respeitando a separação interna/pública.
 *
 * Convenção de pastas:
 *   skills/internal/<nome>/SKILL.md  → confiáveis, carregadas sem auditoria
 *   skills/public/<nome>/SKILL.md    → terceiros, exigem aprovação no audit log
 *   skills/quarantine/               → sempre ignorada
 *
 * Fallback de compatibilidade:
 *   skills/<nome>/SKILL.md na raiz com skill.json kind:"internal" → tratada como interna
 *   skills/<nome>/SKILL.md na raiz sem skill.json                 → tratada como pública (auditoria exigida)
 */
export class SkillLoader {
    private loaded: LoadedSkill[] = [];

    constructor(
        private skillsRoot: string,
        private auditLog?: AuditLog
    ) {}

    /**
     * Varre as pastas e carrega skills disponíveis.
     * Pode ser chamado novamente para hot-reload sem reiniciar o agente.
     */
    load(): LoadedSkill[] {
        this.loaded = [];

        // 1. skills/internal/<nome>/  — sempre carregadas
        this.scanInternalDir(path.join(this.skillsRoot, 'internal'));

        // 2. skills/public/<nome>/    — carregadas somente se auditadas e aprovadas
        this.scanPublicDir(path.join(this.skillsRoot, 'public'));

        // 3. skills/<nome>/ na raiz   — fallback de compatibilidade
        this.scanRootFallback();

        logger.info('skills_loaded', t('log.skills.loaded', { count: this.loaded.length }));
        return this.loaded;
    }

    getAll(): LoadedSkill[] {
        return this.loaded;
    }

    // ── Loaders por origem ────────────────────────────────────────────────────

    private scanInternalDir(dir: string): void {
        for (const entry of this.safeReaddir(dir)) {
            const entryPath = path.join(dir, entry);
            if (!this.isDirectory(entryPath)) continue;

            const skillMdPath = path.join(entryPath, 'SKILL.md');
            if (!fs.existsSync(skillMdPath)) continue;

            const skill = this.parseSkillFile(skillMdPath, 'internal');
            if (skill) {
                this.loaded.push(skill);
                logger.debug('skill_loaded', t('log.skills.internal_loaded', { name: skill.name }));
            }
        }
    }

    private scanPublicDir(dir: string): void {
        if (!fs.existsSync(dir)) return;

        for (const entry of this.safeReaddir(dir)) {
            const entryPath = path.join(dir, entry);
            if (!this.isDirectory(entryPath)) continue;

            const skillMdPath = path.join(entryPath, 'SKILL.md');
            if (!fs.existsSync(skillMdPath)) continue;

            const skill = this.parseSkillFile(skillMdPath, 'public');
            if (!skill) continue;

            if (!this.auditLog) {
                // Sem audit log configurado: carregar com aviso
                logger.warn('audit_missing', t('log.skills.audit_missing', { name: skill.name }));
                this.loaded.push(skill);
                continue;
            }

            const status = this.auditLog.getStatus(skill.name);

            if (this.auditLog.isActivatable(skill.name)) {
                this.loaded.push(skill);
                logger.debug('skill_loaded', t('log.skills.public_loaded', { status, name: skill.name }));
            } else if (status === null) {
                logger.warn('skill_blocked', t('log.skills.public_blocked_not_audited', { name: skill.name }));
            } else {
                logger.warn('skill_blocked', t('log.skills.public_blocked_status', { status, name: skill.name }));
            }
        }
    }

    private scanRootFallback(): void {
        const skip = new Set(['internal', 'public', 'quarantine']);

        for (const entry of this.safeReaddir(this.skillsRoot)) {
            if (skip.has(entry)) continue;

            const entryPath = path.join(this.skillsRoot, entry);
            if (!this.isDirectory(entryPath)) continue;

            const skillMdPath = path.join(entryPath, 'SKILL.md');
            if (!fs.existsSync(skillMdPath)) continue;

            const isInternal = this.hasInternalMarker(entryPath);
            const origin: 'internal' | 'public' = isInternal ? 'internal' : 'public';
            const skill = this.parseSkillFile(skillMdPath, origin);
            if (!skill) continue;

            if (isInternal) {
                this.loaded.push(skill);
                logger.debug('skill_loaded', t('log.skills.internal_legacy_loaded', { name: skill.name }));
            } else {
                // Pública na raiz — aplica mesma regra de auditoria
                if (this.auditLog?.isActivatable(skill.name)) {
                    this.loaded.push(skill);
                    logger.debug('skill_loaded', t('log.skills.public_legacy_loaded', { name: skill.name }));
                } else {
                    const status = this.auditLog?.getStatus(skill.name) ?? null;
                    const reason = status === null
                        ? t('skill.status.not_audited')
                        : t('skill.status.with_value', { status });
                    logger.warn('skill_blocked', t('log.skills.public_legacy_blocked', { reason, name: skill.name }));
                }
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private hasInternalMarker(skillDir: string): boolean {
        const jsonPath = path.join(skillDir, 'skill.json');
        if (!fs.existsSync(jsonPath)) return false;
        try {
            const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            return meta.kind === 'internal';
        } catch {
            return false;
        }
    }

    private parseSkillFile(filePath: string, origin: 'internal' | 'public'): LoadedSkill | null {
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
            if (!match) return null;

            const yaml = match[1];
            const body = match[2].trim();

            const name = this.yamlField(yaml, 'name');
            if (!name) return null;

            const description =
                this.yamlMultilineField(yaml, 'description') ||
                this.yamlField(yaml, 'description');
            const argumentHint = this.yamlField(yaml, 'argument-hint');

            // Lê freeText triggers do skill.json irmão, se existir
            const triggers = this.loadTriggersFromSkillJson(filePath);

            return { name, description, argumentHint, body, sourcePath: filePath, origin, triggers };
        } catch {
            return null;
        }
    }

    private loadTriggersFromSkillJson(skillMdPath: string): string[] {
        try {
            const jsonPath = path.join(path.dirname(skillMdPath), 'skill.json');
            if (!fs.existsSync(jsonPath)) return [];
            const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            const freeText = meta?.invocation?.freeText;
            if (Array.isArray(freeText)) {
                return freeText.filter((t: unknown) => typeof t === 'string');
            }
        } catch {
            // ignora erros silenciosamente
        }
        return [];
    }

    /** Extrai campo simples: `key: value` ou `key: 'value'` */
    private yamlField(yaml: string, key: string): string {
        const m = yaml.match(new RegExp(`^${key}:\\s*['"]?([^'"\\n\\r]+?)['"]?\\s*$`, 'm'));
        return m ? m[1].trim() : '';
    }

    /** Extrai campo com bloco `>` (multiline folded scalar). */
    private yamlMultilineField(yaml: string, key: string): string {
        const m = yaml.match(new RegExp(`^${key}:\\s*>\\r?\\n([\\s\\S]*?)(?=^[\\w-]|$)`, 'm'));
        if (!m) return '';
        return m[1].replace(/^[ \t]+/gm, '').replace(/\r?\n/g, ' ').trim();
    }

    private safeReaddir(dir: string): string[] {
        try {
            return fs.readdirSync(dir);
        } catch {
            return [];
        }
    }

    private isDirectory(p: string): boolean {
        try {
            return fs.statSync(p).isDirectory();
        } catch {
            return false;
        }
    }
}
