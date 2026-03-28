export interface ToolStats {
  success: number;
  failure: number;
}

export class ToolReliability {
  private static stats: Record<string, ToolStats> = {};

  static record(tool: string, success: boolean): void {
    if (!tool) return;
    
    if (!this.stats[tool]) {
      this.stats[tool] = { success: 0, failure: 0 };
    }

    if (success) {
      this.stats[tool].success++;
    } else {
      this.stats[tool].failure++;
    }
  }

  static score(tool: string): number {
    if (!tool || !this.stats[tool]) {
      return 1;
    }

    const stat = this.stats[tool];
    const total = stat.success + stat.failure;
    
    if (total === 0) {
      return 1;
    }

    return stat.success / total;
  }

  static shouldAvoid(tool: string): boolean {
    if (!tool) return false;
    
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
