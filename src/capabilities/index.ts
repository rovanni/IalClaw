import { CapabilityRegistry } from './CapabilityRegistry';
import { SkillManager, createBrowserSkill, createBuiltinFsSkill, createNodeExecutionSkill } from './SkillManager';

export const capabilityRegistry = new CapabilityRegistry();
export const skillManager = new SkillManager(
    capabilityRegistry,
    (process.env.SKILL_POLICY as 'auto-install' | 'ask-user' | 'strict-no-install') || 'ask-user'
);

skillManager.register(createBuiltinFsSkill());
skillManager.register(createNodeExecutionSkill());
skillManager.register(createBrowserSkill());
