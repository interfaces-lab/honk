# Core is rewritten from scratch; feat/unified-core is reference-only

The unmerged `feat/unified-core` branch (19 commits, W1–W5) implemented the strict-schema half of the core
rewrite — the `core/v1` Part union, harness adapters, PartReconciler, PermissionPort — but kept the old
topology: agent runtime inside Electron main, module-global registries, plain classes. We decided on a
true restart: the new Core is written fresh as an Effect v4, schema-first, local HTTP server, and we own
every line of it. The branch is never merged; it serves only as a reference (its schema shapes, adapter
tables, and test fixtures may inform the new code, but code is not ported wholesale). The one thing that
survives by name is the versioned schema-namespace convention, `core/v1`.

Rejected alternative: merge-then-build (land the branch, rewrite only the process topology). Rejected
because owning the code end-to-end matters more here than salvaging verified diffs, and the branch's
in-Electron assumptions would have shaped the daemon by inertia.
