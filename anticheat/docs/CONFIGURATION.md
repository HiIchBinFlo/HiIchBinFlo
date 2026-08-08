# Configuration

The full, authoritative default configuration lives in
`shared/config.lua` — this page is a guided tour, not a duplicate copy (so
it can't drift out of sync with the real values).

Everything under `Config.Protections.*` and `Config.Advanced.*` can also be
edited live from the in-game panel (`F9` → **Advanced Settings** for
global values, or each protection's own card in **Step 1** for per-check
settings); changes there are persisted to `config_overrides.json` and
applied to every connected player immediately.

## Minimal example

```lua
Config = {}

Config.Performance = {
    mode = 'adaptive',    -- 'adaptive' | 'performance' | 'quality'
    lowEndMode = false,
    profiling = true,
}

Config.Detection = {
    noclip = true,
    godmode = true,
    aimbot = true,
    vehicleThrow = true,
    speedhack = true,
    teleport = true,
    weapon = true,
    entitySpam = true,
    explosionSpam = true,
}
```

`Config.Detection` is the quick master switch; the real per-protection
behaviour (level/action/cooldown/sensitivity/whitelist) lives in
`Config.Protections`, e.g.:

```lua
Config.Protections.noclip = {
    enabled = true,
    level = 2,        -- 1 = light, 2 = standard, 3 = strict
    action = 'kick',    -- 'log' | 'warn' | 'freeze' | 'kick' | 'tempban' | 'ban'
    cooldown = 5000,     -- ms between repeat reports counting toward the score
    sensitivity = 1.0,   -- multiplier on this detection's contribution to the score
}
```

`action` here is what happens **once the player's overall suspicion score
crosses `Config.Advanced.punishmentThreshold`**, not on the first report —
see [ARCHITECTURE.md](ARCHITECTURE.md) for the full pipeline.

## Key global knobs (`Config.Advanced`)

| Key | Effect |
| --- | --- |
| `detectionSensitivity` | Global multiplier on every protection's score contribution. |
| `confidenceThreshold` | Below this (0–100), combat/behaviour signals are logged only. |
| `punishmentThreshold` | Suspicion score required before `server/punishment.lua` acts. |
| `scanIntervalMs` | Baseline interval new checks start at before adapting. |
| `serverValidation` | Master switch for `server/validation.lua`'s re-checks. |
| `adminBypass` + `permissionGroups.bypass` | Who's exempt from punishment (still logged). |
| `scoreDecay.perSecond` / `.graceMs` | How fast suspicion fades, and how long after a fresh detection it's paused. |

## Whitelists

- `Config.Whitelist.weapons` — always-allowed weapon names, checked
  server-side before `UNAUTHORIZED_WEAPON` can fire.
- `Config.Whitelist.vehicles` — model names your own scripts may spawn
  without tripping vehicle-spawn signals.
- `Config.Whitelist.explosionTypes` — explosion type IDs (see GTA's
  `EXP_TAG_*` enum) treated as legitimate by default.
- `Config.EventRules` — opt-in net-event protection; see
  [INTEGRATIONS.md](INTEGRATIONS.md).

Whitelists are additive with the temporary, export-driven allowances
(`AllowTeleport`, `AllowInvincibility`, `AllowWeapon`) described in
[INTEGRATIONS.md](INTEGRATIONS.md) — use the config whitelist for things
that are always fine, and the exports for one-off exceptions.
