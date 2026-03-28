export interface EvaluationResult {
  success: boolean;
  quality: number;
  reason?: string;
}

export class ResultEvaluator {
  static evaluate(output: any): EvaluationResult {
    if (output === null || output === undefined) {
      return { success: false, quality: 0, reason: "Output is null or undefined" };
    }

    const outputStr = String(output);

    if (outputStr.toLowerCase().includes("error:") || 
        outputStr.toLowerCase().includes("failed") ||
        outputStr.toLowerCase().includes("exception")) {
      return { success: false, quality: 0.2, reason: "Output contains error indicators" };
    }

    if (outputStr.length === 0) {
      return { success: false, quality: 0, reason: "Output is empty" };
    }

    if (outputStr.length < 10) {
      return { success: true, quality: 0.3, reason: "Output is very short" };
    }

    if (outputStr.length > 100000) {
      return { success: true, quality: 0.7, reason: "Large output - may need truncation" };
    }

    const errorPatterns = [
      /cannot find/i,
      /not found/i,
      /permission denied/i,
      /timeout/i,
      /unauthorized/i,
      /invalid/i,
      /erro:/i,
      /erro\b/i,
      /error\b/i,
      /falha/i,
      /failed/i,
      /não permitido/i,
      /nao permitido/i,
      /arquivo não permitido/i,
      /arquivo nao permitido/i,
      /proibido/i,
      /access denied/i,
      /forbidden/i,
      /não foi possível/i,
      /nao foi possivel/i,
      /impossível/i,
      /impossivel/i,
      /não encontrado/i,
      /nao encontrado/i
    ];

    if (errorPatterns.some(pattern => pattern.test(outputStr))) {
      return { success: false, quality: 0.1, reason: "Output contains error patterns" };
    }

    const successPatterns = [
      /success/i,
      /completed/i,
      /created/i,
      /saved/i,
      /done/i,
      /ok/i,
      /✓/,
      /✅/
    ];

    if (successPatterns.some(pattern => pattern.test(outputStr))) {
      return { success: true, quality: 0.9, reason: "Output indicates success" };
    }

    return { success: true, quality: 0.8, reason: "Output looks valid" };
  }

  static shouldRefine(quality: number, threshold: number = 0.5): boolean {
    return quality < threshold;
  }
}
