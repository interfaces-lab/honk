# Runtime Permissions

Multi maps every provider's native permission surface into one `RuntimeMode`
policy before emitting approval requests.

| Action class                                  | `full-access` | `auto-accept-edits` | `approval-required` |
| --------------------------------------------- | ------------- | ------------------- | ------------------- |
| Project reads, search, listing, and LSP reads | allow         | allow               | allow               |
| Edits, writes, patches, deletes, and moves    | allow         | ask                 | ask                 |
| Shell commands                                | allow         | ask                 | ask                 |
| External-directory access                     | allow         | ask                 | ask                 |
| `.env` file reads                             | allow         | ask                 | ask                 |
| Unknown or dynamic tools                      | allow         | ask                 | ask                 |
| User questions                                | allow         | allow               | allow               |

Adapters should avoid emitting `request.opened` for actions the policy allows.
Provider-native prompts may still occur when the provider owns the sandbox or
approval policy, but Multi should not add an extra approval prompt for allowed
read-only activity.
