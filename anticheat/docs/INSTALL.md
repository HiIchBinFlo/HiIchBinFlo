# Installation

1. Copy the `anticheat/` folder into your server's `resources/` directory
   (rename the folder if you like — `fxmanifest.lua`'s `name` field is
   informational only, FiveM uses the folder name as the resource name).

2. Add it to your `server.cfg`:

   ```cfg
   ensure anticheat
   ```

   Load it after your framework (ESX/QBCore/standalone) but it has no hard
   dependency on any of them — everything framework-specific is opt-in via
   exports (see [INTEGRATIONS.md](INTEGRATIONS.md)).

3. Grant the panel/admin ACE permission to your staff, e.g. in `server.cfg`:

   ```cfg
   add_ace group.admin anticheat.admin allow
   add_ace group.admin anticheat.bypass allow
   add_principal identifier.license:YOUR_LICENSE group.admin
   ```

   - `anticheat.admin` — can open the settings panel (`F9` or `/anticheat`)
     and run `/ac_score`, `/ac_whitelist`, `/ac_reload`, `/anticheat:unban`.
   - `anticheat.bypass` — exempt from punishment (still logged). Grant this
     narrowly; it is meant for staff, not for testing your own detections.

4. (Optional) Set a Discord webhook for high-confidence detections: open the
   panel → **Advanced** → **Logging** → paste the webhook URL, or set
   `Config.Advanced.logging.webhook` directly in `shared/config.lua`.

5. (Optional) If you use `screenshot-basic`, proof requests before a ban
   will automatically attach a screenshot URL to the log/webhook entry once
   you set `Config.Punishment.requireProof = true`. No extra wiring needed —
   it's detected via `GetResourceState('screenshot-basic')`.

6. Restart the resource (`restart anticheat` / `ensure anticheat`) whenever
   you edit `shared/config.lua` directly. Changes made through the in-game
   panel apply immediately to all connected players and persist to
   `config_overrides.json` inside the resource, so they survive restarts
   without touching the source file.

## Verifying it's running

- `/ac_score <playerId>` (console or an `anticheat.admin` player) prints
  that player's current suspicion score.
- Open the panel (`F9`) → **Step 1 → Performance** tab shows live measured
  per-protection CPU time; if all rows read `0.000ms` nothing has ticked
  yet (normal right after a fresh join — give it a few seconds).
- `anticheat.log` appears inside the resource's data folder once the first
  detection fires (10s write-behind buffer, not written on every event).

## Uninstalling

`stop anticheat` / remove from `server.cfg`. `bans.json` and
`config_overrides.json` stay in the resource folder if you want to keep
them for a future reinstall; delete them for a clean slate.
