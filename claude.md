# Picking models for workflows and subagents

Rankings, higher = better. Cost reflects what I actually pay (OpenAI limits are generous), not list
price. Intelligence is how hard a problem the model can take unsupervised. Taste covers UI/UX, code
quality, API design, and copy.

| model    | cost | intelligence | taste |
| -------- | ---- | ------------ | ----- |
| gpt-5.5  | 8    | 8            | 5     |
| opus-4.8 | 3    | 6            | 9     |
| fable-5  | 2    | 9            | 9     |

## Rules

- **Never use Haiku.**
  solely as the thin low-effort wrapper that reaches codex from inside a workflow (see Mechanics) — it never does the thinking.
- These are defaults, not limits: standing permission to override. If a cheaper model's output misses the bar, rerun with a smarter model without asking. Judge the output, not the price tag — escalating costs less than shipping mediocre work.
- Cost is a tie-breaker only. For anything that ships: intelligence > taste > cost.
- Bulk/mechanical work (clear-spec implementation, data analysis, migrations): gpt-5.5 — effectively free.
- Anything user-facing (UI, copy, API design) needs taste ≥ 7: fable-5 or opus-4.8.
- Reviews of plans and implementations: fable-5 or opus-4.8, optionally gpt-5.5 as an extra independent perspective.
- Code changes in a dynamic workflow: delegate to codex via the codex skills. Codex is known for bad taste in code — review everything it writes; no normalizer layers, no one-off `is*` functions. When taste fails, write the code yourself instead of iterating on it.

## Mechanics

- gpt-5.5 is only reachable through the Codex CLI — `codex exec` / `codex review`. Use the codex skills for implementation and review; for work they don't cover (investigation, data analysis), run `codex exec -s read-only` directly with a self-contained prompt.

write comments like the reader is new to the codebase but familiar with the goal of the project