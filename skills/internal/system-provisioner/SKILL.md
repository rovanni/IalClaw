---
name: system-provisioner
description: >
  Internal IalClaw skill to autonomously detect and resolve system dependency gaps. 
  Use this skill when a task requires a missing tool (Capability Gap), or when 
  the user needs specific system resources. 
  MANDATORY: Requires user confirmation before any installation.
compatibility:
  tools: [run_command, read_local_file]
  context: IalClaw Cognitive System v3.0
metadata:
  kind: internal
  trusted: true
  risk: HIGH
  requiresConfirmation: true
  category: system-dependency-resolver
  integrated_layer: CapabilityResolver
---

# System Provisioner (Dependency Resolver)

This skill empowers the agent to identify and resolve "Capability Gaps" by installing necessary system dependencies. It follows a strict safety-first approach.

## 🚨 Safety Rules (MANDATORY)

- **NEVER** install software without explicit user confirmation.
- **ALWAYS** explain **WHY** the installation is needed (the Capability Gap).
- **ALWAYS** provide the exact command to be executed before asking for permission.
- **ALWAYS** offer an alternative (e.g., manual instructions or a different approach).
- **HIGH RISK**: This tool can modify the system state. Exercise extreme caution.

## When to Use (Capability Gap Detection)

Trigger this skill when you detect a gap between the user's intent and the system's capabilities:
- **Task**: "Convert this video to MP4" -> **Gap**: `ffmpeg` is missing.
- **Task**: "Run this Python project" -> **Gap**: `pip` packages or `venv` missing.
- **Task**: "Show file structure" -> **Gap**: `tree` command missing.

## Core Workflow

### 1. Identify the Capability Gap
Analyze the user's request and check if the required tools are available. If a tool is missing, define it as a "Capability Gap".

### 2. Environment Detection
Check the current environment to determine the best resolution path:
```bash
python scripts/check_system.py
```

### 3. Generate Resolution Plan
Generate the appropriate installation command for the detected OS and package managers:
```bash
python scripts/install_helper.py <resource> <os> <pm1,pm2,...>
```

### 4. Human-in-the-Loop Confirmation (UX)
Present the gap and the solution to the user clearly.

**Correct UX Example:**
> 🔍 **Capability Gap Detected**: To convert videos, I need `ffmpeg`, but it is not currently installed on your system.
> 
> I can resolve this for you using:
> 👉 `choco install ffmpeg`
> 
> **Do you want me to proceed with this installation?**

### 5. Authorized Execution
Only after the user provides explicit consent, use `run_command` to execute the installation.

### 6. Verification & Handover
Verify the installation (`tool --version`) and proceed with the original user task.

---

## Best Practices

- **Self-Healing**: Aim to guide the system towards a state where it can fulfill the user's original request.
- **Transparency**: Maintain a clear log of system modifications.
- **Fallback**: If the user denies installation, suggest manual steps or try to find a way to complete the task without that specific tool.

---

## 👤 Autoria
Criada por **Luciano Rovanni do Nascimento**

## 📫 Conecte-se Comigo  
[![GitHub](https://img.shields.io/badge/GitHub-rovanni-%23181717?style=flat&logo=github)](https://github.com/rovanni)  
[![LinkedIn](https://img.shields.io/badge/LinkedIn-%230077B5?style=flat&logo=linkedin)](https://www.linkedin.com/in/luciano-rovanni-97856846/)
