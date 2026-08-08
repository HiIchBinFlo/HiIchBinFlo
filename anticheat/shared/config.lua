--[[
    shared/config.lua
    Single source of truth for the anti-cheat. Everything here can be
    changed at runtime by an admin through the settings panel (server
    validates the change and persists it); this file only provides the
    defaults a fresh install starts from.
]]

Config = {}

-- ---------------------------------------------------------------------------
-- Performance
-- ---------------------------------------------------------------------------
Config.Performance = {
    mode = 'adaptive',        -- 'adaptive' | 'performance' | 'quality'
    lowEndMode = false,        -- forces longer intervals + skips optional signals
    profiling = true,          -- measure per-protection execution time
    autoLowEndThresholdMs = 8.0, -- if avg frametime exceeds this, auto-enable low-end behaviour
    maxBudgetMsPerTick = 0.6,   -- soft budget for all client detections combined, per tick
    networkUsageSampling = true,
}

-- ---------------------------------------------------------------------------
-- Advanced settings (Step 2 of the settings panel)
-- ---------------------------------------------------------------------------
Config.Advanced = {
    detectionSensitivity = 1.0,   -- global multiplier applied to per-protection sensitivity
    confidenceThreshold = 60,     -- combat/behaviour signals below this are logged only
    punishmentThreshold = 100,    -- suspicion score required before punishment.lua acts
    scanIntervalMs = 500,          -- baseline for adaptive movement/entity scans
    serverValidation = true,       -- server re-checks every client detection before scoring
    logging = {
        enabled = true,
        console = true,
        file = true,
        webhook = '',                -- Discord/HTTP webhook URL, empty = disabled
        webhookMinConfidence = 60,     -- don't spam the webhook with low-confidence noise
    },
    debug = false,
    performanceMode = 'adaptive',
    lowEndMode = false,
    adminBypass = true,             -- permission-group members skip punishment (still logged)
    permissionGroups = {
        bypass = { 'admin', 'developer' },
        moderator = { 'moderator' },
    },
    detectionCooldownMs = 3000,      -- minimum time between repeat reports of the same detection/player
    scoreDecay = {
        perSecond = 1.5,             -- suspicion points removed per second of clean behaviour
        graceMs = 15000,              -- no decay for this long after a fresh detection
    },

    -- Client-side vicinity spam thresholds (see client/entities.lua)
    entitySpamThresholds = { objects = 80, vehicles = 40, peds = 60 },

    -- Server-authoritative per-player entity creation limits
    -- (see server/main.lua's entityCreating hook). capacity = burst size,
    -- perSec = steady-state tokens regained per second.
    entityRateLimits = {
        object  = { capacity = 20, perSec = 4 },
        vehicle = { capacity = 8,  perSec = 1 },
        ped     = { capacity = 10, perSec = 1 },
        pickup  = { capacity = 10, perSec = 2 },
    },
    globalEntityRateLimit = { capacity = 300, perSec = 40 },

    -- Server-authoritative per-player explosion limits
    -- (see server/main.lua's explosionEvent hook).
    explosionRateLimit = { capacity = 4, perSec = 0.5 },
}

-- ---------------------------------------------------------------------------
-- Master per-protection toggles (quick on/off, mirrors Config.Protections keys)
-- ---------------------------------------------------------------------------
Config.Detection = {
    noclip = true,
    fly = true,
    freecam = true,
    teleport = true,
    speedhack = true,
    superJump = true,
    infiniteStamina = true,
    gravity = true,
    godmode = true,
    aimbot = true,
    weapon = true,
    vehicleGodmode = true,
    vehicleSpeed = true,
    vehicleThrow = true,
    vehicleSpawn = true,
    entitySpam = true,
    explosionSpam = true,
    eventValidation = true,
    integrity = true,
}

-- ---------------------------------------------------------------------------
-- Per-protection settings. Every entry follows the same shape so the UI can
-- render them generically:
--   enabled, level (1-3), action, cooldown (ms), sensitivity (0-2), whitelist
-- `action` is one of: 'log' | 'warn' | 'freeze' | 'kick' | 'ban' | 'tempban'
-- It is applied only once the confidence/score engine clears the punishment
-- threshold - a single flagged tick never triggers `action` directly.
-- ---------------------------------------------------------------------------
Config.Protections = {
    -- Movement
    noclip           = { enabled = true, level = 2, action = 'kick', cooldown = 5000, sensitivity = 1.0 },
    fly              = { enabled = true, level = 2, action = 'kick', cooldown = 5000, sensitivity = 1.0 },
    freecam          = { enabled = true, level = 1, action = 'log',  cooldown = 5000, sensitivity = 1.0 },
    teleport         = { enabled = true, level = 2, action = 'kick', cooldown = 3000, sensitivity = 1.0 },
    speedhack        = { enabled = true, level = 2, action = 'kick', cooldown = 3000, sensitivity = 1.0 },
    superJump        = { enabled = true, level = 1, action = 'log',  cooldown = 5000, sensitivity = 1.0 },
    infiniteStamina  = { enabled = true, level = 1, action = 'log',  cooldown = 10000, sensitivity = 1.0 },
    gravity          = { enabled = true, level = 2, action = 'kick', cooldown = 5000, sensitivity = 1.0 },

    -- Player / health
    godmode          = { enabled = true, level = 2, action = 'kick', cooldown = 5000, sensitivity = 1.0 },

    -- Combat
    aimbot           = { enabled = true, level = 2, action = 'ban',  cooldown = 10000, sensitivity = 1.0 },

    -- Weapons
    weapon           = { enabled = true, level = 3, action = 'ban',  cooldown = 3000, sensitivity = 1.0 },

    -- Vehicles
    vehicleGodmode   = { enabled = true, level = 2, action = 'kick', cooldown = 5000, sensitivity = 1.0 },
    vehicleSpeed     = { enabled = true, level = 2, action = 'kick', cooldown = 5000, sensitivity = 1.0 },
    vehicleThrow     = { enabled = true, level = 2, action = 'kick', cooldown = 4000, sensitivity = 1.0 },
    vehicleSpawn     = { enabled = true, level = 2, action = 'kick', cooldown = 5000, sensitivity = 1.0 },

    -- Entities
    entitySpam       = { enabled = true, level = 2, action = 'kick', cooldown = 3000, sensitivity = 1.0 },

    -- Explosions
    explosionSpam    = { enabled = true, level = 2, action = 'kick', cooldown = 3000, sensitivity = 1.0 },

    -- Events
    eventValidation  = { enabled = true, level = 3, action = 'ban',  cooldown = 1000, sensitivity = 1.0 },

    -- Integrity
    integrity        = { enabled = true, level = 2, action = 'kick', cooldown = 10000, sensitivity = 1.0 },
}

-- ---------------------------------------------------------------------------
-- Score weights per action for the combined confidence/suspicion model.
-- See shared/detection_types.lua for per-detection base scores.
-- ---------------------------------------------------------------------------
Config.Scoring = {
    -- combat/aim signals accumulate into this separate 0-100 score before
    -- being folded into the general suspicion score at a reduced rate.
    aimScoreBands = {
        { max = 30, label = 'normal',            multiplier = 0 },
        { max = 60, label = 'watch',              multiplier = 0.1 },
        { max = 80, label = 'suspicious',          multiplier = 0.4 },
        { max = 95, label = 'highly_suspicious',    multiplier = 0.8 },
        { max = 100, label = 'high_certainty',       multiplier = 1.2 },
    },
}

-- ---------------------------------------------------------------------------
-- Whitelists / permission-aware exceptions
-- ---------------------------------------------------------------------------
Config.Whitelist = {
    -- ACE permission required to be exempt from punishment entirely (still logged).
    bypassAce = 'anticheat.bypass',

    -- ACE permission required to open the settings panel / run admin commands.
    panelAce = 'anticheat.admin',

    -- Weapon hashes/names always allowed regardless of the job/weapon whitelist below.
    weapons = {
        'WEAPON_UNARMED',
        'WEAPON_PISTOL',
        'WEAPON_COMBATPISTOL',
        'WEAPON_KNIFE',
        'WEAPON_NIGHTSTICK',
        'WEAPON_STUNGUN',
        'WEAPON_FLASHLIGHT',
    },

    -- Vehicle models job/whitelisted scripts are allowed to spawn without
    -- triggering `vehicleSpawn` / `unauthorizedVehicle` signals.
    vehicles = {},

    -- Explosion types (see shared/detection_types + GTA explosion enum) that
    -- legitimate gameplay/scripts are allowed to trigger.
    explosionTypes = {
        [21] = true, -- EXP_TAG_BULLET (execution scripts, etc.)
    },

    -- Resource names allowed to call AC exports (AllowTeleport, etc.)
    -- without additional verification. Populate with your framework's
    -- core resources (jobs, garages, taxi, etc.)
    trustedResources = {
        'spawnmanager',
    },
}

-- ---------------------------------------------------------------------------
-- Event validation ruleset (see server/validation.lua)
-- Each rule: cooldownMs, rateLimit {capacity, perSec}, and a validator name
-- implemented in server/validation.lua's EventValidators table.
-- Unknown events are NOT blocked by default - only registered events are
-- enforced, per spec ("kein blindes Blocken unbekannter Events").
-- ---------------------------------------------------------------------------
Config.EventRules = {
    -- ['my_resource:giveMoney'] = { cooldownMs = 500, rateLimit = { capacity = 5, perSec = 1 }, validator = 'money' },
    -- ['my_resource:giveItem']  = { cooldownMs = 250, rateLimit = { capacity = 10, perSec = 2 }, validator = 'item' },
}

-- ---------------------------------------------------------------------------
-- Punishment escalation: repeated bans within a window escalate severity.
-- ---------------------------------------------------------------------------
Config.Punishment = {
    freezeDurationMs = 10000,
    tempBanDurationHours = 24,
    escalation = {
        enabled = true,
        windowHours = 24,
        -- Nth offense within the window -> forced minimum action
        thresholds = {
            [1] = 'kick',
            [2] = 'tempban',
            [3] = 'ban',
        },
    },
    requireProof = false, -- if true, screenshot/proof export is requested before ban is finalized
}

return Config
