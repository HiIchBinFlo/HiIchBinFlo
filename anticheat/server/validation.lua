--[[
    server/validation.lua
    Second layer of the pipeline: every client-reported detection is
    re-checked here against server-tracked state before it can contribute
    to a suspicion score. The server also owns its own teleport/state
    "allow" windows (separate from the client-side ones in client/main.lua)
    because a modified client cannot be trusted to honor its own
    suppression flags - only server-triggered exemptions count for real.

    Also hosts the net-event validation ruleset (Config.EventRules).
]]

AC = AC or {}
AC.Validation = {}

-- ---------------------------------------------------------------------------
-- Server-owned exemption windows. Call these from trusted server-side code
-- (spawn managers, job scripts, admin teleports, garages, etc.) right
-- before you move a player or change their invincibility/weapons.
-- ---------------------------------------------------------------------------
function AC.AllowTeleport(src, durationMs)
    AC.GetState(src).teleportAllowedUntil = GetGameTimer() + (durationMs or 3000)
end
exports('AllowTeleport', AC.AllowTeleport)

function AC.AllowInvincibility(src, durationMs)
    AC.GetState(src).invincibilityAllowedUntil = GetGameTimer() + (durationMs or 3000)
end
exports('AllowInvincibility', AC.AllowInvincibility)

function AC.AllowWeapon(src, weaponHash, durationMs)
    local state = AC.GetState(src)
    state.weaponAllowances = state.weaponAllowances or {}
    state.weaponAllowances[weaponHash] = GetGameTimer() + (durationMs or 5000)
end
exports('AllowWeapon', AC.AllowWeapon)

local function isTeleportAllowed(state)
    return state.teleportAllowedUntil and GetGameTimer() < state.teleportAllowedUntil
end

local function isInvincibilityAllowed(state)
    return state.invincibilityAllowedUntil and GetGameTimer() < state.invincibilityAllowedUntil
end

local function isWeaponAllowed(state, weaponHash)
    if Utils.Contains(Config.Whitelist.weapons, weaponHash) then return true end
    for _, name in ipairs(Config.Whitelist.weapons) do
        if GetHashKey(name) == weaponHash then return true end
    end
    if state.weaponAllowances and state.weaponAllowances[weaponHash] then
        return GetGameTimer() < state.weaponAllowances[weaponHash]
    end
    return false
end

-- ---------------------------------------------------------------------------
-- Per-category validators. Each returns (accepted: bool, confidence: 0-1,
-- reason: string). `evidence` is whatever the client attached to the report
-- (untrusted - only used as a hint for what to re-derive server-side).
-- ---------------------------------------------------------------------------
local Validators = {}

local function movementValidator(src, state, detectionType, evidence)
    if isTeleportAllowed(state) then
        return false, 0, 'teleport_allowed'
    end

    -- Cross-check against the server's own independently-sampled position
    -- history (server/player_state.lua's background thread), not the
    -- client-supplied evidence.
    local p1 = state.positionHistory:get(2)
    local p2 = state.positionHistory:get(1)
    if p1 and p2 then
        local dt = (p2.t - p1.t) / 1000.0
        if dt > 0 then
            local dist = Utils.Distance(p1.coords, p2.coords)
            local impliedSpeed = dist / dt
            if detectionType == 'TELEPORT' and impliedSpeed < 20 then
                -- Server's own low-frequency samples never saw a jump -
                -- likely a legitimate short-range client-side hitch, not a
                -- real teleport. Lower confidence rather than discard.
                return true, 0.4, 'unconfirmed_by_server_history'
            end
        end
    end

    return true, 0.85, 'ok'
end

local function playerValidator(src, state, detectionType, evidence)
    if isInvincibilityAllowed(state) then
        return false, 0, 'invincibility_allowed'
    end

    local h1 = state.healthHistory:get(2)
    local h2 = state.healthHistory:get(1)
    if h1 and h2 and h2.health >= h1.health and h1.health > 0 then
        return true, 0.9, 'confirmed_by_server_history'
    end

    return true, 0.6, 'client_only'
end

local function combatValidator(src, state, detectionType, evidence)
    -- Aim signals are inherently probabilistic; server can't re-derive
    -- camera rotation, so it passes the client's own aggregate score
    -- through at reduced confidence and lets the score engine's banding
    -- (Config.Scoring.aimScoreBands) do the real work.
    return true, 0.5, 'behavioural_signal'
end

local function weaponValidator(src, state, detectionType, evidence)
    if detectionType == 'AMMO_MANIPULATION' or detectionType == 'RAPID_FIRE'
        or detectionType == 'FIRE_RATE_MANIPULATION' or detectionType == 'INFINITE_AMMO' then
        return true, 0.7, 'client_reported'
    end

    if detectionType == 'UNAUTHORIZED_WEAPON' or detectionType == 'UNAUTHORIZED_WEAPON_GIVE' then
        local weaponHash = evidence.weapon or evidence.weaponHash
        if weaponHash and isWeaponAllowed(state, weaponHash) then
            return false, 0, 'weapon_whitelisted'
        end
        return true, 0.95, 'not_whitelisted'
    end

    return true, 0.6, 'default'
end

local function vehicleValidator(src, state, detectionType, evidence)
    if isTeleportAllowed(state) and (detectionType == 'VEHICLE_TELEPORT') then
        return false, 0, 'teleport_allowed'
    end
    return true, 0.7, 'client_reported'
end

local function entityValidator(src, state, detectionType, evidence)
    -- Authoritative entity/explosion counting happens server-side in
    -- server/main.lua's entityCreating/explosionEvent hooks; anything that
    -- reaches here via client report is supporting context only.
    return true, 0.4, 'supporting_signal'
end

local function integrityValidator(src, state, detectionType, evidence)
    return true, 0.8, 'client_reported'
end

Validators.movement = movementValidator
Validators.player = playerValidator
Validators.combat = combatValidator
Validators.weapons = weaponValidator
Validators.vehicles = vehicleValidator
Validators.entities = entityValidator
Validators.explosions = entityValidator
Validators.integrity = integrityValidator
Validators.events = function() return true, 0.9, 'event_rule' end

function AC.Validation.Validate(src, detectionType, evidence)
    local def = DetectionTypes[detectionType]
    if not def then return false, 0, 'unknown_detection_type' end

    if not Config.Advanced.serverValidation then
        return true, 0.5, 'server_validation_disabled'
    end

    local state = AC.GetState(src)
    local validator = Validators[def.category]
    if not validator then return true, 0.5, 'no_validator' end

    return validator(src, state, detectionType, evidence)
end

-- ---------------------------------------------------------------------------
-- Net-event validation ruleset (Config.EventRules). Wrap sensitive events
-- with AC.ProtectEvent(eventName) once at startup - see server/main.lua and
-- docs/INTEGRATIONS.md for real examples (money/item/vehicle/admin events).
-- ---------------------------------------------------------------------------
local eventLimiters = {}   -- "src:eventName" -> RateLimiter
local eventCooldowns = Utils.NewCooldownTracker()

AC.EventValidators = {
    money = function(src, amount) return type(amount) == 'number' and amount > 0 and amount <= 1000000 end,
    item = function(src, item, count) return type(item) == 'string' and type(count) == 'number' and count > 0 and count <= 500 end,
}

function AC.RegisterEventValidator(name, fn)
    AC.EventValidators[name] = fn
end
exports('RegisterEventValidator', AC.RegisterEventValidator)

-- Returns true if the event call is allowed to proceed.
function AC.ValidateEvent(src, eventName, ...)
    local rule = Config.EventRules[eventName]
    if not rule then return true end -- unknown events are not blocked, per design

    if rule.cooldownMs and not eventCooldowns:ready(src .. ':' .. eventName, rule.cooldownMs) then
        AC.Report(src, 'EVENT_RATE_LIMIT', { event = eventName, reason = 'cooldown' })
        return false
    end

    if rule.rateLimit then
        local key = src .. ':' .. eventName
        local limiter = eventLimiters[key]
        if not limiter then
            limiter = Utils.NewRateLimiter(rule.rateLimit.capacity, rule.rateLimit.perSec)
            eventLimiters[key] = limiter
        end
        if not limiter:consume(1) then
            AC.Report(src, 'EVENT_RATE_LIMIT', { event = eventName, reason = 'burst' })
            return false
        end
    end

    if rule.validator then
        local validatorFn = AC.EventValidators[rule.validator]
        if validatorFn and not validatorFn(src, ...) then
            AC.Report(src, 'EVENT_INVALID_PAYLOAD', { event = eventName })
            return false
        end
    end

    return true
end
exports('ValidateEvent', AC.ValidateEvent)

-- Wraps `handler` so it only runs when AC.ValidateEvent passes. Use from
-- your own resources to protect specific net events without duplicating
-- validation logic:
--   RegisterNetEvent('my_resource:giveMoney')
--   AddEventHandler('my_resource:giveMoney', AC.ProtectEvent('my_resource:giveMoney', function(amount) ... end))
function AC.ProtectEvent(eventName, handler)
    return function(...)
        local src = source
        if AC.ValidateEvent(src, eventName, ...) then
            handler(...)
        end
    end
end
