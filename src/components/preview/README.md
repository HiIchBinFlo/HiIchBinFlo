# `preview/` — reserved for Phase 3 (Character Preview)

Intentionally empty in Phase 1. A 3D character preview (React Three Fiber)
needs to render an actual decoded `.ydd` mesh + `.ytd` texture — see
`docs/FILE_FORMATS.md` for why that decoder isn't implemented yet. Wiring up a
preview panel against fake/placeholder geometry would violate this project's
"no placeholders for core functionality" rule, so this directory stays empty
until Phase 2's binary parser lands.
