type VerticalSidebarViewModule = typeof import("./view");

let sharedViewModule: Promise<VerticalSidebarViewModule> | null = null;

function loadVerticalSidebarView(): Promise<VerticalSidebarViewModule> {
  if (sharedViewModule !== null) return sharedViewModule;
  sharedViewModule = import("./view").catch((error: unknown) => {
    sharedViewModule = null;
    throw error;
  });
  return sharedViewModule;
}

export { loadVerticalSidebarView };
