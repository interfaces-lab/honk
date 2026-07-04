# Core lifetime is explicitly owned; serve mode is the long-lived escape hatch

The Core runs as a child of whichever Core App started it (desktop or CLI) and dies with that owner,
after draining running work (bounded). Before starting one, a Core App always discovers first — machine
state file, liveness probe, core/vN handshake — and attaches to a live Core instead of spawning a second;
this discovery-before-spawn arbitration is the single-instance enforcement that our reference (opencode)
lacks. Users who need a Core that outlives any app — web clients, remote control — explicitly run serve
mode (`honk serve`), t3code-style: stable environment identity, multiple access endpoints, bearer-session
auth, pairing URLs for web. Web clients never start a Core.

Rejected alternatives: a detached auto-daemon with work-aware idle shutdown (implicit background process,
lifetime nobody asked for and nobody can reason about); opencode's launch copied verbatim (no
single-instance arbitration — N embedded servers against one database).
