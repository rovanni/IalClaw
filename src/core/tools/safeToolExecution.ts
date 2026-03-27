import { resolvePath } from "../utils/pathResolver";

export async function safeToolExecution(tool, input) {
  try {
    const resolvedInput = { ...input };
    if (input.path) {
      resolvedInput.path = resolvePath(input.path);
    }
    if (input.filePath) {
      resolvedInput.filePath = resolvePath(input.filePath);
    }
    if (input.filename) {
      resolvedInput.filename = resolvePath(input.filename);
    }
    return await tool(resolvedInput);
  } catch (err) {
    console.error("[TOOL ERROR]", err);
    return fallbackExecution(tool, input, err);
  }
}

export async function fallbackExecution(tool, input, err) {
  // Exemplo de fallback: converter md para pptx usando pandoc
  if (input.task === "convert_md_to_pptx" && input.path) {
    const { execSync } = await import("child_process");
    try {
      const output = resolvePath("/workspace/exports/output.pptx");
      execSync(`pandoc "${resolvePath(input.path)}" -o "${output}"`);
      return { success: true, data: { output } };
    } catch (pandocErr) {
      console.error("[FALLBACK ERROR]", pandocErr);
      return { success: false, error: pandocErr.message };
    }
  }
  return { success: false, error: err.message };
}
