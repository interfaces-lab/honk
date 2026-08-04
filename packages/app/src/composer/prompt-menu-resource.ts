type PromptMenuModule = typeof import("./prompt-menu");

let sharedPromptMenuModule: Promise<PromptMenuModule> | null = null;

function loadPromptMenu(): Promise<PromptMenuModule> {
  if (sharedPromptMenuModule !== null) return sharedPromptMenuModule;
  sharedPromptMenuModule = import("./prompt-menu").catch((error: unknown) => {
    sharedPromptMenuModule = null;
    throw error;
  });
  return sharedPromptMenuModule;
}

export { loadPromptMenu };
