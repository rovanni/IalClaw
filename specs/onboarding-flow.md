# Onboarding Flow Specification

This document describes the interactive personalization process (Onboarding) for new users of the IalClaw Cognitive System.

## Architecture

The onboarding logic resides in `OnboardingService.ts`. It uses a **sequential adaptive approach**, meaning it follows a primary sequence but can also classify natural language answers to skip or populate fields out of order.

## The 9-Step Personalization Journey

IalClaw uses a structured 9-point setup to align its cognitive behavior with the user's needs:

1. **Basic Identification**: "How would you like to be called?"
2. **AI/CLI Familiarity**: Categorization into *Beginner*, *Intermediate*, or *Advanced* to adjust explanation density.
3. **Professional Context**: Optional free-text field for expertise (e.g., "Software Engineer", "Biology Student").
4. **Primary Goals**: Multi-choice selection to prioritize task planning (Coding, Research, Writing, etc.).
5. **Response Style**: Selection between *Concise*, *Detailed*, or *Adaptive*.
6. **Autonomy Level**: Permission level for tool execution (*Conservative*, *Balanced*, *Confident*).
7. **Workspace Path**: Definition of the local directory for project management.
8. **Integrations**: Optional setup for GitHub, IDEs, or Cloud storage.
9. **Language Preference**: Response language preference (system default, technical english, or dynamic).

## Key Behaviors

### Always-Enabled Learning
As of v3.1, the **Learning Memory is always enabled** by default. New users are no longer asked if they want to enable memory, as it is a core feature of the IalClaw's cognitive architecture. The `learning_mode` is forced to `'enabled'` upon completion of the flow.

### Transition to Welcome
Upon completing the 9 steps (or choosing to finish early), the user receives a personalized summary of their configuration and a context-aware suggestion based on their stated goals.

### Persistence
Data is stored in the `user_profile` table of the SQLite database. 
Fields: `name`, `expertise`, `goals`, `familiarity`, `response_style`, `learning_mode`, `autonomy_level`, `workspace_path`, `integrations`, `language_preference`.
