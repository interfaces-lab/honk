# Resilience

Design every reachable state, but do not invent unreachable ones. Preserve user input through
validation and recoverable failures. Keep loading labels stable and use the control's busy affordance.
Make permissions, retry behavior, reversibility, stale data, optimistic updates, and destructive
consequences explicit when product logic permits them.

Closing a view never stops underlying work. Running agents remain in the deck after their tab closes;
stopping requires a distinct explicit action. Durable notices belong in the stream as parts. Toasts are
for brief local feedback such as copied state or an action failure with no durable home.
