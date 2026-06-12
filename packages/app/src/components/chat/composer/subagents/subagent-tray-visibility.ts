export function shouldShowSubagentTrayForComposer(input: {
  readonly isInlineEditComposer: boolean;
}): boolean {
  return !input.isInlineEditComposer;
}
