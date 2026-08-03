// Latest TodoWrite payload as a workbench checklist. Durable todo state stays out of the transcript.

import { Text, Tray } from "@honk/ui";
import type { ReactElement } from "react";

import { TaskList } from "./task-list";
import type { ToolTodo } from "./tool-part-projection";

function WorkbenchTasks({ tasks }: { readonly tasks: readonly ToolTodo[] }): ReactElement {
  const completed = tasks.filter((task) => task.status === "completed").length;
  const active = tasks.filter((task) => task.status === "in_progress").length;

  return (
    <section aria-label="Tasks" className="flex min-h-0 grow flex-col">
      <div className="flex items-center justify-between gap-control-gap px-panel-pad pt-panel-pad">
        <Text as="p" size="sm" tone="muted" tabularNums>
          {completed} of {tasks.length} complete
        </Text>
        {active > 0 ? (
          <Text size="xs" tone="accent" tabularNums>
            {active} active
          </Text>
        ) : null}
      </div>
      <Tray.ScrollArea aria-label="Task list" data-honk-scrollport="">
        <TaskList tasks={tasks} />
      </Tray.ScrollArea>
    </section>
  );
}

export { WorkbenchTasks };
