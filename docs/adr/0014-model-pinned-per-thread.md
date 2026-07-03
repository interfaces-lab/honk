# The model is pinned per Thread; tool metadata is typed per Harness

A Thread's model is chosen at creation and never changes. There is no model-update verb on the thread and
no per-send model override; ThreadSummary.model is always present. Switching models means starting a new
Thread.

This single rule buys the type system its power: because one Thread means one model means one Harness for
its whole life, a Thread's tool calls are homogeneous in origin, so the open sites on the tool part
(ToolState.input, completed.output) can later be NARROWED by origin-conditional schemas — each Harness's
own raw shapes, typed — instead of widened transformation unions that must absorb every harness at once.
It also gives prompt-cache affinity for free and deletes the whole model-change-entry / context-rebuild
machinery pi carries.

Tool display coexistence is resolved the same round: one ToolDisplay per call (the card is always
unambiguous) plus an optional diagnostics side-channel ({severity, message}[]) for annotations attached
to the same call — the "diff plus per-file failure note" case. Every call renders a known component
unless malformed, which fail-closed decoding surfaces immediately.

Extended in the models/auth round: the thinking level pins with the model. ThreadSummary carries
thinkingLevel, both are set at creation, and neither has an update verb — once a message is submitted the
pair is immutable, so Rush→Deep is a new Thread even though both ride gpt-5.5. "Mode"
(Rush/Smart/Deep/Composer) is UI vocabulary over these pinned pairs (CONTEXT.md), never a wire concept:
the catalog offers exactly the pairs we present (each model's thinkingLevels is the Mode table, not the
model's capability ceiling), and the Core defines that table. This is deliberately harsher than peers'
mid-thread thinking toggles: config immutability keeps a Thread's transcript one homogeneous execution
story and spares the wire a second mutable knob.

Rejected: mid-thread model switching (today's cycleModel UX — the flexibility costs schema widening,
cache-affinity loss, and cross-model transcript translation); mid-thread thinking-level switching (same
knob, smaller blast radius, rejected for the same one-story reason); displays as an array (reintroduces
which-one-is-primary ordering heuristics); Mode as a wire concept (a product-UI name would freeze into a
public compatibility promise — the wire carries model + thinkingLevel, and Modes stay renameable).
