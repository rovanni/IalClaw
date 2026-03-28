export interface ToolStats {
  success: number;
  failure: number;
}

export class ToolReliability {
  private static stats: Record<string, ToolStats> = {};
  private static contextStats: Record<string, Record<string, ToolStats>> = {};

  static record(tool: string, success: boolean, contextKey?: string): void {
    if (!tool) return;
    
    if (!this.stats[tool]) {
      this.stats[tool] = { success: 0, failure: 0 };
    }

    if (success) {
      this.stats[tool].success++;
    } else {
      this.stats[tool].failure++;
    }

    if (contextKey) {
      if (!this.contextStats[contextKey]) {
        this.contextStats[contextKey] = {};
      }
      if (!this.contextStats[contextKey][tool]) {
        this.contextStats[contextKey][tool] = { success: 0, failure: 0 };
      }
      if (success) {
        this.contextStats[contextKey][tool].success++;
      } else {
        this.contextStats[contextKey][tool].failure++;
      }
    }
  }

  static score(tool: string, contextKey?: string): number {
    if (!tool) return 1;

    if (contextKey && this.contextStats[contextKey]?.[tool]) {
      const stat = this.contextStats[contextKey][tool];
      const total = stat.success + stat.failure;
      if (total >= 2) {
        return stat.success / total;
      }
    }

    if (!this.stats[tool]) {
      return 1;
    }

    const stat = this.stats[tool];
    const total = stat.success + stat.failure;
    
    if (total === 0) {
      return 1;
    }

    return stat.success / total;
  }

  static shouldAvoid(tool: string, contextKey?: string): boolean {
    if (!tool) return false;

    if (contextKey && this.contextStats[contextKey]?.[tool]) {
      const stat = this.contextStats[contextKey][tool];
      const total = stat.success + stat.failure;
      if (total >= 3) {
        return (stat.success / total) < 0.3;
      }
    }
    
    const stat = this.stats[tool];
    if (!stat) return false;

    const total = stat.success + stat.failure;
    if (total < 3) return false;

    return this.score(tool) < 0.3;
  }

  static getStats(tool: string): ToolStats | null {
    return this.stats[tool] || null;
  }

  static reset(): void {
    this.stats = {};
  }

  static getAllStats(): Record<string, ToolStats> {
    return { ...this.stats };
  }
}
