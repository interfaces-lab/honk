# @honk/contracts

Shared wire contracts for Honk.

- Keep this package schema-only: protocol schemas, settings schemas, event types, model/session types, and API contracts.
- Do not add runtime behavior, filesystem access, process management, or UI helpers here.
- Prefer Effect Schema classes and branded schemas for wire-level validation.
