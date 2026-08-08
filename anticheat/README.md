# anticheat

A performance-first, multi-layer FiveM anti-cheat framework with a 2-step
NUI settings panel and a live, measured performance dashboard.

Client performance is the top priority: a single scheduler thread drives
every interval-based check with adaptive intervals (never `Wait(0)`), heavy
work is gated behind cheap early-outs (context checks, aim-only sampling,
distance-limited scans), and every protection's real client execution time
is measured and shown in the panel — not estimated.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit
together, [docs/INSTALL.md](docs/INSTALL.md) to get it running, and
[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for wiring up legitimate
admin/job/script exceptions (spawn protection, teleports, vehicle
whitelists, event protection, etc.).

## Why nothing here is "detection = ban"

Every signal client-side code produces is exactly that: a signal. It goes
through this pipeline before anything happens to the player:

```
Client Detection → Server Validation → Behaviour/History Check →
Confidence Score → Suspicion Score (with decay) → Threshold → Action
```

A single flagged tick never bans anyone. The client can't see the server's
world, and the server can't see the client's world (no collision/raycast
natives exist server-side in FXServer) — so each side validates what it
can actually see, and only the combination is trusted.

## Layout

```
anticheat/
├── client/       main (scheduler+profiler+NUI), movement, combat, weapons,
│                 vehicles, entities, integrity
├── server/       player-state, validation, logging, punishment, detection
│                 (score engine), main (bootstrap + hard rate limits)
├── shared/       config, detection-type/score table, small utilities
├── ui/settings-panel/   2-step NUI (Protection / Advanced) + perf dashboard
└── docs/         install, architecture, configuration, integrations
```

## Quick facts

- Everything is toggleable per-protection (`Config.Protections.<name>.enabled`).
- Every protection has its own action, cooldown, detection level, sensitivity
  and whitelist, editable live from the in-game panel (`/anticheat`, or `F9`).
- Movement/entity detections use one adaptive-interval scheduler thread
  total on the client, not one thread per check.
- Entity spam, explosion spam and weapon whitelisting are enforced
  **server-side** (`entityCreating` / `explosionEvent` hooks that can
  actually cancel the action) — client-side reports on these are supporting
  context only, because a modified client cannot be trusted to self-limit.
- Bans are stored in a flat JSON file (`bans.json`, generated at runtime) —
  no external DB dependency. Swap `server/punishment.lua`'s load/save
  functions for your own storage if you have one.

## License

Same license as the parent repository (see root `LICENSE`).
