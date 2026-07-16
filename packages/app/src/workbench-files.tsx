import { Text } from "@honk/ui";

function WorkbenchFiles({ directory }: { readonly directory: string }): React.ReactElement {
  return (
    <div className="flex min-h-0 grow flex-col items-center justify-center gap-control-gap p-panel-pad text-center">
      <Text as="p" size="sm" tone="muted" weight="medium">
        Files unavailable
      </Text>
      <Text as="p" size="xs" tone="faint">
        This OpenCode host doesn&apos;t expose file browsing or file reads.
      </Text>
      <Text as="p" size="xs" tone="faint" family="mono">
        {directory}
      </Text>
    </div>
  );
}

export { WorkbenchFiles };
