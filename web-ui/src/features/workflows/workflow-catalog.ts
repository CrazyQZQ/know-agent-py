export type WorkflowDefinition = { id: string; name: string; description: string; status?: "available" | "running" };
export const WORKFLOWS: WorkflowDefinition[] = [{ id: "ppt", name: "PPT 工作流", description: "从需求生成演示文稿" }];
