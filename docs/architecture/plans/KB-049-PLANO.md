# KB-049 - Small Talk Governance

This plan addresses the issue where trivial conversations (greetings, casual talk) trigger the full cognitive pipeline, leading to unnecessary overhead and potential errors (e.g., the "REAL_TOOLS_ONLY" blockage for simple greetings).

## User Review Required

> [!IMPORTANT]
> The implementation will introduce a new `SMALL_TALK` intent type which will bypass planning and tool loops entirely. This ensures instant and natural responses for social interactions.

> [!WARNING]
> The `REAL_TOOLS_ONLY` enforcement in `AgentLoop` will be specifically restricted to `TASK_EXECUTION` related intents to prevent blocking direct LLM responses for casual talk.

## Proposed Changes

### 🟢 Core Agent

#### [MODIFY] [IntentionResolver.ts](file:///d:/IA/IalClaw/src/core/agent/IntentionResolver.ts)
- Add `SMALL_TALK` to `IntentType`.
- Implement `SMALL_TALK_REGEX` (production-ready PT-BR) and `TASK_HINTS_REGEX`.
- Implement `isSmallTalk(input)` with length constraints and task indicator checks.
- Update `resolve()` to prioritize `SMALL_TALK` detection.

### 🔵 Orchestrator

#### [MODIFY] [CognitiveOrchestrator.ts](file:///d:/IA/IalClaw/src/core/orchestrator/CognitiveOrchestrator.ts)
- Update `CognitiveDecision` interface to include `skipPlanning` and `skipToolLoop` flags.
- Implement early bypass in `decide()` for `SMALL_TALK` intent:
    - `strategy: CognitiveStrategy.LLM`
    - `confidence: 1`
    - `reason: 'small_talk_fast_path'`
    - `skipPlanning: true`
    - `skipToolLoop: true`

### 🔴 Engine

#### [MODIFY] [AgentLoop.ts](file:///d:/IA/IalClaw/src/engine/AgentLoop.ts)
- Update `runInternal` to handle `skipPlanning` and `skipToolLoop` from orchestrator policy.
- Refine `REAL_TOOLS_ONLY` logic: bypass this mode if the intent is `SMALL_TALK`, ensuring direct LLM responses are never blocked for social interactions.

## Open Questions

- Should we include a specific list of PT-BR regexes for `SMALL_TALK` now, or just the structural changes? (The user offered them in the prompt).

## Verification Plan

### Automated Tests
- Create a new test suite `tests/KB049_small_talk.test.ts`.
- Verify that "Oi", "Tudo bem?", "Bom dia" result in a direct LLM response without planning signals.
- Verify that `REAL_TOOLS_ONLY` doesn't block these inputs.
- Verify that actual tasks still trigger the full pipeline.

### Manual Verification
- Test interactive chat with "Olá", "Como vai?", "E aí?".
- Confirm no "DIRECT_LLM bloqueado" message appears for these inputs.
