# Architecture

## Client: one scheduler, many modules

`client/main.lua` owns the only persistent polling thread in the resource.
Every interval-based protection (`client/movement.lua`,
`client/vehicles.lua`, `client/entities.lua`, part of `client/weapons.lua`,
`client/combat.lua`, `client/integrity.lua`) registers a tick function via
`AC.RegisterCheck(name, opts)` instead of running its own
`Citizen.CreateThread`. Event-driven work (damage events, explosion events,
weapon-give responses) attaches directly via `AddEventHandler`/
`RegisterNetEvent` and costs nothing between events.

Each pass through the scheduler:

1. Reads `GetFrameTime()` once (not per-frame) as a coarse load signal.
2. Runs any module whose `nextRun` has passed, timing it with
   `GetGameTimer()` before/after.
3. Feeds that measurement into `AC.Perf` (a per-module ring buffer of the
   last 30 samples — average, peak, last) and into that module's own
   adaptive interval (`Utils.AdaptiveInterval`), which grows toward
   `maxInterval` under load and settles toward `minInterval` when idle.
4. Stops running further modules once `Performance.maxBudgetMsPerTick` is
   spent for that pass — a soft frame-time budget across everything anti-
   cheat does, not per-module.
5. Sleeps for exactly as long as until the soonest `nextRun`, clamped to
   `[25ms, 1000ms]`. There is no `Wait(0)` anywhere in the resource.

`Config.Performance.lowEndMode` (settable manually or triggered
automatically once the load signal stays high) doubles every module's
effective max interval — the same checks still run, just less often.

## The five layers

```
1. Client Detection     — client/*.lua produce a typed report + evidence
2. Server Validation     — server/validation.lua re-derives what it can
                            from server-only state (position/health history,
                            whitelist, weapon whitelist, event rules)
3. Behaviour/History      — server/player_state.lua's ring buffers give
                            validation something independent to compare
                            the client's claim against
4. Confidence/Score       — server/detection.lua turns (type, confidence,
                            sensitivity) into a score delta, decays old
                            score over time, and only proceeds once the
                            configured punishment threshold is crossed
5. Action                — server/punishment.lua executes log/warn/freeze/
                            kick/(temp)ban, with escalation for repeat
                            offenders and an optional proof-screenshot step
```

Whitelisted players (`AC.IsWhitelisted`, ACE `anticheat.bypass` or a
permission group in `Config.Advanced.permissionGroups.bypass`, or an
explicit `AC.SetPlayerWhitelisted` override) still generate log entries —
they just never reach step 5.

## Why entity/explosion/weapon enforcement lives server-side

FXServer's `entityCreating` and `explosionEvent` are server events that see
*every* networked entity/explosion regardless of which client or resource
created it, and both can be cancelled outright
(`server/main.lua`). That's strictly stronger than anything a client can
self-report, so it's the actual enforcement point; `client/entities.lua`
only contributes a cheap, distance-limited "how crowded is it around me"
signal as supporting context.

The inverse is true for noclip: the server has no collision/raycast
natives at all in FXServer, so `client/movement.lua`'s ray-test-based
noclip signal is the only place that check can meaningfully happen —
`server/validation.lua` cross-checks it against the server's own
independently-sampled position history instead of trying to re-derive
collision it can't see.

## Score engine

`DetectionTypes` (`shared/detection_types.lua`) gives every detection type
a base score and a category; `DetectionTypes.ProtectionKey` maps it to the
`Config.Protections` entry that governs whether it's enabled, its action,
cooldown and sensitivity. `server/detection.lua`:

```
addition = baseScore * validationConfidence * protectionSensitivity * globalSensitivity
score = min(score + addition, 999)
```

except for `AIMBOT_SUSPICION`, which instead carries the client's own 0–100
aim score and is folded in through `Config.Scoring.aimScoreBands`'s
per-band multiplier (0 below 30, rising to 1.2 above 95) — so a single
"suspicious" reading barely moves the needle, but sustained
highly-suspicious behaviour compounds quickly.

Score decays continuously (`Config.Advanced.scoreDecay`) except for a short
grace window right after a fresh detection, so isolated incidents fade
while sustained or repeated behaviour keeps climbing.
