# Install (for agents)

1. Register the plugin in `~/.config/opencode/opencode.json`:

   ```json
   { "plugin": ["opencode-compact-recall"] }
   ```

   (For development from a local clone instead, add the repo's absolute
   path to the array and run `bun install` inside it.)

2. Restart the opencode server so the plugin loads:

   ```bash
   opencode service restart
   ```

3. Verify: in any opencode session, ask it to recall a past conversation
   after a `/compact` has occurred. The agent should call
   `compact_recall_search` and return a summary. You can also ask it to
   run `compact_recall_inventory` to see what is stored.

Notes:

- Embeddings run locally (CPU, first run downloads the model once).
- Do not edit the database by hand; it lives at
  `~/.local/share/opencode/compact-recall.db`.
- Config is via `COMPACT_RECALL_*` env vars (see README.md); they must
  be set before `opencode service restart` to reach the plugin.
