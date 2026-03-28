export interface StepValidation {
  plausible: boolean;
  risk: "low" | "medium" | "high";
  reason?: string;
}

export interface ValidationContext {
  safeMode?: boolean;
  currentPlan?: {
    goal: string;
    steps: Array<{ id: number; description: string; tool?: string }>;
  };
}

export class StepValidator {
  static validate(step: any, context: ValidationContext = {}): StepValidation {
    if (!step) {
      return { plausible: false, risk: "high", reason: "Step is undefined or null" };
    }

    if (!step.tool && !step.description) {
      return { plausible: false, risk: "high", reason: "Missing tool and description" };
    }

    if (!step.tool) {
      return { plausible: true, risk: "low", reason: "Tool not specified - will be inferred" };
    }

    if (step.tool.includes("system") && context.safeMode) {
      return { plausible: true, risk: "medium", reason: "System tool in safe mode" };
    }

    const dangerousTools = ["system.exec", "run_command", "delete_file"];
    if (dangerousTools.includes(step.tool) && context.safeMode) {
      return { plausible: true, risk: "medium", reason: `Potentially dangerous tool: ${step.tool}` };
    }

    const veryDangerousTools = ["sudo", "rm -rf", "format"];
    if (veryDangerousTools.some(dt => step.tool?.includes(dt))) {
      return { plausible: false, risk: "high", reason: `Very dangerous tool detected: ${step.tool}` };
    }

    return { plausible: true, risk: "low" };
  }
}
