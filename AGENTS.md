# Install (for agents)

1. Install dependencies (from this repo):

   ```bash
   bun install
   ```

2. Register the plugin in `~/.config/opencode/opencode.json` — add the
   absolute path of this repo to the `plugin` array (or use the npm
   package name `opencode-compact-recall` once published):

   ```json
   { "plugin": ["/ABSOLUTE/PATH/TO/THIS/REPO"] }
   ```

3. Restart the opencode server so the plugin loads:

   ```bash
   opencode service restart
   ```

4. Verify: in any opencode session, ask it to recall a past conversation
   after a `/compact` has occurred. The agent should call
   `compact_recall_search` and return a summary.

Notes:

- Embeddings run locally (CPU, first run downloads the model once).
- Do not edit the database by hand; it lives at
  `~/.local/share/opencode/compact-recall.db`.
- Config is via `COMPACT_RECALL_*` env vars (see README.md); they must
  be set before `opencode service restart` to reach the plugin.
