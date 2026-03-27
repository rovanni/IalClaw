import { resolvePath } from "../../utils/pathResolver";

type ToolExecutionResult = { success: boolean; data?: unknown; error?: string };
type ToolExecutor = (input: Record<string, unknown>) => Promise<ToolExecutionResult>;

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function safeToolExecution(
  tool: ToolExecutor,
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  try {
    const resolvedInput = { ...input };
    if (typeof input.path === "string") {
      resolvedInput.path = resolvePath(input.path);
    }
    if (typeof input.filePath === "string") {
      resolvedInput.filePath = resolvePath(input.filePath);
    }
    if (typeof input.filename === "string") {
      resolvedInput.filename = resolvePath(input.filename);
    }
    return await tool(resolvedInput);
  } catch (err) {
    console.error("[TOOL ERROR]", err);
    return fallbackExecution(tool, input, err);
  }
}

export async function fallbackExecution(
  tool: ToolExecutor,
  input: Record<string, unknown>,
  err: unknown
): Promise<ToolExecutionResult> {
  // Exemplo de fallback: converter md para pptx usando pandoc
  if (input.task === "convert_md_to_pptx" && typeof input.path === "string") {
    const { execSync } = await import("child_process");
    try {
      const output = resolvePath("/workspace/exports/output.pptx");
      execSync(`pandoc "${resolvePath(input.path)}" -o "${output}"`);
      return { success: true, data: { output } };
    } catch (pandocErr) {
      console.error("[FALLBACK ERROR]", pandocErr);
      return { success: false, error: getErrorMessage(pandocErr) };
    }
  }
  return { success: false, error: getErrorMessage(err) };
}
