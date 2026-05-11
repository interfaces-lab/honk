import { memo } from "react";
import { type PendingApproval } from "../../../session-logic";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
}: ComposerPendingApprovalPanelProps) {
  const approvalSummary = approvalSummaryForKind(approval.requestKind);

  return (
    <div className="px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="uppercase text-sm tracking-[0.2em]">PENDING APPROVAL</span>
        <span className="text-sm font-medium">{approvalSummary}</span>
        {pendingCount > 1 ? (
          <span className="text-xs text-muted-foreground">1/{pendingCount}</span>
        ) : null}
      </div>
    </div>
  );
});

function approvalSummaryForKind(requestKind: PendingApproval["requestKind"]): string {
  switch (requestKind) {
    case "command":
      return "Command approval requested";
    case "file-read":
      return "File-read approval requested";
    case "file-change":
      return "File-change approval requested";
    case "permissions":
      return "Permissions approval requested";
    case "mcp-elicitation":
      return "MCP input requested";
    case "dynamic-tool":
      return "Tool approval requested";
    case "auth-refresh":
      return "Auth refresh requested";
    default:
      return "Approval requested";
  }
}
