# Product-design eval scaffold

This directory is a human-reviewed dataset, not an eval runner. `fixtures.json` describes tasks,
representative production target paths, references that should be retrieved, and expected outcomes;
`rules-checklist.json` maps outcomes to stable product-design and deterministic rule IDs. Fixture files
are non-executable snippets representing content at `targetPath`, so production imports are allowed.

Evaluate **retrieval** separately (did the agent load the product-design skill and applicable rule?)
from **application** (did its edit satisfy the checklist?). Compare runs with and without the skill when
an actual harness is supplied. Expected outcomes and any future holdouts require human review; similarity
to `after/` is not itself correctness.
