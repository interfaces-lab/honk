import { VscodeEntryIcon } from "~/components/chat/shared/vscode-entry-icon";
import { useTheme } from "~/hooks/use-theme";

export function VsFileIcon(props: { path: string; className?: string; errored?: boolean }) {
  const { resolvedTheme } = useTheme();
  const classNameProp = props.className ? { className: props.className } : {};

  return (
    <VscodeEntryIcon pathValue={props.path} kind="file" theme={resolvedTheme} {...classNameProp} />
  );
}
