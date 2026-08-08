# Integrations

Everything here is an export call from **your own resource**, not a config
edit — that's deliberate: legitimate exceptions should be granted by the
script that knows it's about to do something unusual, for exactly as long
as it needs, not by disabling a protection globally.

## Client-side exports (`exports['anticheat']`)

| Export | When to call it |
| --- | --- |
| `AllowTeleport(durationMs)` | Immediately before moving the local player via `SetEntityCoords`/similar, from a resource running on the client (e.g. a garage teleport menu). |
| `AllowStateChange(durationMs)` | Before triggering ragdoll/animation states that could otherwise look like a movement exploit (e.g. custom knockout scripts). |
| `AllowInvincibility(durationMs)` | Before/while granting real client-visible invincibility (cosmetic god-mode indicators, cutscene protection). |
| `IsProtectionEnabled(name)` | Check before doing your own redundant check for the same thing. |

## Server-side exports (`exports['anticheat']`)

| Export | When to call it |
| --- | --- |
| `AllowTeleport(src, durationMs)` | Before any server-triggered teleport: spawn selection, `/tp`, garages, job vehicle spawns, house/apartment doors. **This is the one that actually matters** — the client-side version only suppresses that client's own reporting; this one is what `server/validation.lua` checks. |
| `AllowInvincibility(src, durationMs)` | Before granting server-tracked invincibility: spawn protection, mission scripts, admin god mode, vehicle invincibility events. |
| `AllowWeapon(src, weaponHash, durationMs)` | Before giving a player a non-whitelisted weapon for a limited-time reason (event weapon, quest item) without permanently whitelisting it server-wide. |
| `SetPlayerWhitelisted(src, true/false)` | Wire this to your own admin/staff table if you don't want to rely on ACE permissions for `anticheat.bypass`. |
| `AddSuspicion(src, amount, reason)` | Feed a suspicion signal from a server-authoritative check you wrote yourself (e.g. your inventory system spotting an impossible item count) directly into the same score/decay/threshold pipeline. |
| `GetPlayerScore(src)` | Read a player's current suspicion score for your own admin tooling. |

## Example: spawn manager

```lua
-- server-side, e.g. your custom spawnmanager or ESX/QBCore spawn selection
RegisterNetEvent('myserver:spawnPlayer', function(coords)
    local src = source
    exports['anticheat']:AllowTeleport(src, 3000)
    exports['anticheat']:AllowInvincibility(src, 5000) -- spawn protection window
    TriggerClientEvent('myserver:doSpawn', src, coords)
end)
```

```lua
-- client-side counterpart, if you also move the ped locally
RegisterNetEvent('myserver:doSpawn', function(coords)
    exports['anticheat']:AllowTeleport(2000)
    SetEntityCoords(PlayerPedId(), coords.x, coords.y, coords.z, false, false, false, true)
end)
```

## Example: job vehicle spawn whitelist

Add the model names to the vehicle whitelist once (via the settings panel's
**Advanced** step, or directly):

```lua
-- shared/config.lua
Config.Whitelist.vehicles = { 'ambulance', 'firetruk', 'police', 'polmav' }
```

and grant the teleport allowance around the actual `CreateVehicle`:

```lua
RegisterCommand('spawnambulance', function(src)
    exports['anticheat']:AllowTeleport(src, 2000)
    -- ... CreateVehicle / entity handover to the player ...
end)
```

## Example: protecting a sensitive net event

```lua
-- shared/config.lua
Config.EventRules['myserver:giveMoney'] = {
    cooldownMs = 500,
    rateLimit = { capacity = 5, perSec = 1 },
    validator = 'money',
}
```

```lua
-- your resource, server-side
RegisterNetEvent('myserver:giveMoney')
AddEventHandler('myserver:giveMoney', function(amount)
    local src = source
    if not exports['anticheat']:ValidateEvent(src, 'myserver:giveMoney', amount) then
        return -- cooldown/rate-limit/validator rejected it; already logged
    end
    -- ... your actual money-giving logic ...
end)
```

(`AC.ProtectEvent` from `server/validation.lua` does the same wrapping if
you're calling it from within the anticheat resource's own Lua state
rather than through `exports`.)

`AC.EventValidators.money`/`.item` ship as reasonable defaults (positive
number within a sane cap); register your own with:

```lua
exports['anticheat']:RegisterEventValidator('vehiclePlate', function(src, plate)
    return type(plate) == 'string' and #plate <= 8
end)
```

Events with no entry in `Config.EventRules` are never blocked — the
framework does not guess at your event schema.

## Example: admin god mode toggle

```lua
RegisterCommand('godmode', function(src)
    exports['anticheat']:AllowInvincibility(src, 24 * 60 * 60 * 1000) -- effectively "until toggled off"
    -- ... your own SetEntityInvincible/health-lock logic ...
end, true) -- restricted command
```

For a real toggle, re-call `AllowInvincibility` on a short interval
(e.g. every 10s from a thread) while god mode is active instead of one
huge duration, so it turns itself off cleanly if your admin resource
crashes or restarts.
