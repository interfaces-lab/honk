# The wire carries raw text only; rich composer affordances are Prompt Tokens

Messages cross the wire as raw text — there is no rich-document field (no richText blob, no span format).
Harnesses and models only ever consume text, so the wire tells no prettier story than the truth: what the
backend receives is exactly what the model sees. The composer's chips (skill references like
`[$skill](skill-path)`, file mentions) are a client-side rendering of the Prompt Token grammar embedded
in that raw text; the SDK ships the token parser so every client renders chips identically, the same way
it ships the Part reducer.

Rejected: an opaque richText JSON blob (today's shape — an unspecifiable field on a public wire, editor
lock-in by inertia, and a rendering attack surface once third parties can send it); a typed span format
(a second representation of the same truth that must be compiled to text anyway and can drift from it).
Consequence: the composer's send path is redesigned around text + tokens, and rich rendering degrades
gracefully to plain text for any client that skips the parser.
