# Honk

Desktop AI coding chat app. The composer lets the user choose how model
execution is set up before submitting a prompt.

## Language

### Model selection

**Fusion**:
The default execution setup: a main model paired with a sidekick, chosen
together at an effort stop. The user picks the stop, not the models.
_Avoid_: preset (as user-facing label), adaptive, auto, blend, sidekick mode

**Single model**:
The non-Fusion setup: one model chosen directly, with no sidekick pairing.
_Avoid_: singular, solo, direct model, catalog model (as user-facing label)

**Main**:
The model that owns judgment and review within a Fusion pairing.

**Sidekick**:
The preset agent paired with the main model inside Fusion; the main is
prompted to orchestrate it. Internal term; not a user-facing selector concept.

**Preset agent**:
A named helper agent with a pinned model, available for the running thread to
invoke via delegation in both Fusion and single-model threads. Never
user-selectable in the model selector.
_Avoid_: subagent roster, system agent

**Stop**:
An effort tier of Fusion: low, medium, high, ultra. What the Fusion dial
selects.
_Avoid_: level, tier, effort preset

**Fusion dial**:
The four-detent control that selects the Fusion stop. Interacting with it
activates Fusion; Fusion and single model are one exclusive choice.
_Avoid_: slider, effort bar

**Variant**:
An effort level within a model (medium, high, xhigh, max). Max is available
only on explicit single-model picks, never inside a Fusion pairing.
_Avoid_: effort (as a standalone noun), reasoning level

**Mode**:
How the agent behaves (Build, Ask, Plan, Debug). Orthogonal to model
selection.

### Preset agents

**Oracle**:
The preset agent consulted for complex reasoning and planning on code.

**Review**:
The preset agent for bug identification and code-review assistance.

**Search**:
The preset agent for fast, accurate codebase retrieval.

**Librarian**:
The preset agent for large-scale retrieval and research on external code.

**Read Thread**:
The preset agent that reads and summarizes other threads.

**System model**:
A model the app itself uses for background chores (e.g. thread titling).
Never user-selectable and never invoked by a thread.
_Avoid_: preset agent (for app-invoked chores), utility model
