# Honk never asks for permission

Agents act without approval dialogs — a product decision made long before this rewrite, reaffirmed here.
There is no permission-request wire type in core/v1, no PermissionPort, no rules engine, no approval
aggregate. The Claude Code Harness's canUseTool always allows; Cursor ACP permission requests are
auto-approved. Safety comes from where it already lives: interaction modes constraining toolsets (plan/ask
modes), workspace isolation, and review UX — not from interrupting the agent to ask.

Two things this does NOT remove, because they are not permission: agents may still ask the user questions
(the ask-question flow), and plan proposals still await the user's go-ahead as a product flow. Both are
Parts; neither gates a tool call.

This is a deliberate deviation from every peer product (Claude Code, amp, opencode all prompt) and from
the earlier W3/PermissionPort workstream, whose orphaned approval contract (approval.requested activities,
projection_pending_approvals, approval panels) is deleted by the restart rather than rebuilt. Because the
API is public, omitting the concept is a real commitment: reintroducing permissions later means a new wire
surface, not flipping a flag.
