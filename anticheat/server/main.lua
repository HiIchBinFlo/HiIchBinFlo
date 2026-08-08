--[[
    server/main.lua
    Bootstraps the resource, wires up the remaining server-authoritative
    layers that don't belong in a single-responsibility file:
      - entityCreating rate limits (real entity-spam enforcement)
      - explosionEvent rate limits + type whitelist
      - weapon-change validation
      - config sync to clients + NUI-driven config updates
      - admin commands
]]

AC = AC or {}

-- Runtime-mutable copy of the shared defaults; persisted overrides (from
-- the settings panel) are merged on top at startup if present.
Config = Utils.DeepCopy(Config)

local function loadOverrides()
    local raw = LoadResourceFile(GetCurrentResourceName(), 'config_overrides.json')
    if not raw then return end
    local ok, overrides = pcall(json.decode, raw)
    if ok and type(overrides) == 'table' then
        Utils.MergeDefaults(overrides, Config)
        Config = overrides
    end
end

local function saveOverrides()
    SaveResourceFile(GetCurrentResourceName(), 'config_overrides.json', json.encode(Config), -1)
end

loadOverrides()

-- ---------------------------------------------------------------------------
-- Player lifecycle
-- ---------------------------------------------------------------------------
RegisterNetEvent('anticheat:playerReady', function()
    local src = source
    TriggerClientEvent('anticheat:syncConfig', src, Config)
    TriggerClientEvent('anticheat:authorized', src, IsPlayerAceAllowed(src, Config.Whitelist.panelAce))
end)

RegisterNetEvent('anticheat:heartbeat', function()
    AC.GetState(source).lastHeartbeatAt = GetGameTimer()
end)

AddEventHandler('playerSpawned', function()
    -- no-op placeholder for frameworks that fire this server-side; the
    -- client-side spawn grace period lives in client/movement.lua
end)

-- ---------------------------------------------------------------------------
-- Weapon validation
-- ---------------------------------------------------------------------------
RegisterNetEvent('anticheat:weaponChanged', function(weaponHash)
    local src = source
    if not Config.Protections.weapon.enabled then return end

    local state = AC.GetState(src)
    state.currentWeapon = weaponHash

    local allowed = false
    for _, name in ipairs(Config.Whitelist.weapons) do
        if GetHashKey(name) == weaponHash then allowed = true break end
    end
    if not allowed and state.weaponAllowances and state.weaponAllowances[weaponHash]
        and GetGameTimer() < state.weaponAllowances[weaponHash] then
        allowed = true
    end

    if not allowed then
        AC.Report(src, 'UNAUTHORIZED_WEAPON', { weapon = weaponHash })
    end
end)

-- ---------------------------------------------------------------------------
-- Entity spam: the one true rate limiter. entityCreating fires for every
-- networked entity regardless of which script or client created it and can
-- be cancelled outright, so this is real enforcement, not just detection.
-- ---------------------------------------------------------------------------
local playerLimiters = {}   -- src -> { object=RateLimiter, vehicle=RateLimiter, ped=RateLimiter, pickup=RateLimiter }
local globalLimiter = Utils.NewRateLimiter(Config.Advanced.globalEntityRateLimit.capacity, Config.Advanced.globalEntityRateLimit.perSec)
local burstCooldowns = Utils.NewCooldownTracker()

local ENTITY_TYPE_NAMES = { [1] = 'ped', [2] = 'vehicle', [3] = 'object' }

local function getLimiters(src)
    local l = playerLimiters[src]
    if not l then
        local cfg = Config.Advanced.entityRateLimits
        l = {
            ped = Utils.NewRateLimiter(cfg.ped.capacity, cfg.ped.perSec),
            vehicle = Utils.NewRateLimiter(cfg.vehicle.capacity, cfg.vehicle.perSec),
            object = Utils.NewRateLimiter(cfg.object.capacity, cfg.object.perSec),
        }
        playerLimiters[src] = l
    end
    return l
end

AddEventHandler('playerDropped', function()
    playerLimiters[source] = nil
end)

AddEventHandler('entityCreating', function(entity)
    if not Config.Protections.entitySpam.enabled then return end

    local src = source
    if not src or src == 0 or src == '' then return end -- server/script-owned entities

    if not globalLimiter:consume(1) then
        CancelEvent()
        return
    end

    local ok, entityType = pcall(GetEntityType, entity)
    local typeName = ok and ENTITY_TYPE_NAMES[entityType] or nil
    if not typeName then return end

    local limiters = getLimiters(src)
    local limiter = limiters[typeName]
    if limiter and not limiter:consume(1) then
        CancelEvent()

        local detectionType = ({ object = 'OBJECT_SPAM', vehicle = 'VEHICLE_SPAM', ped = 'PED_SPAM' })[typeName]
        AC.Report(src, detectionType, { entityType = typeName })

        if burstCooldowns:ready('burst:' .. src, 2000) then
            AC.Report(src, 'NETWORK_ENTITY_ABUSE', { entityType = typeName })
        end
    end
end)

-- ---------------------------------------------------------------------------
-- Explosion spam / unauthorized types
-- ---------------------------------------------------------------------------
local explosionLimiters = {}

local function getExplosionLimiter(src)
    local l = explosionLimiters[src]
    if not l then
        local cfg = Config.Advanced.explosionRateLimit
        l = Utils.NewRateLimiter(cfg.capacity, cfg.perSec)
        explosionLimiters[src] = l
    end
    return l
end

AddEventHandler('playerDropped', function()
    explosionLimiters[source] = nil
end)

AddEventHandler('explosionEvent', function(sender, ev)
    if not Config.Protections.explosionSpam.enabled then return end
    if not sender or sender == 0 then return end -- script/server-triggered explosions

    if not Config.Whitelist.explosionTypes[ev.explosionType] then
        local limiter = getExplosionLimiter(sender)
        if not limiter:consume(1) then
            AC.Report(sender, 'EXPLOSION_SPAM', { explosionType = ev.explosionType })
            local ok = pcall(CancelEvent)
        else
            AC.Report(sender, 'UNAUTHORIZED_EXPLOSION_TYPE', { explosionType = ev.explosionType })
        end
    end
end)

-- ---------------------------------------------------------------------------
-- Config sync from the settings panel. Only an authorized admin's changes
-- are accepted; the merged, validated config is then broadcast to everyone.
-- ---------------------------------------------------------------------------
RegisterNetEvent('anticheat:updateConfig', function(partial)
    local src = source
    if not IsPlayerAceAllowed(src, Config.Whitelist.panelAce) then return end
    if type(partial) ~= 'table' then return end

    -- Only known top-level sections may be updated; unknown keys are
    -- dropped instead of merged, so the NUI can't inject arbitrary globals.
    local allowedSections = { Performance = true, Advanced = true, Detection = true, Protections = true, Whitelist = true }
    for section, value in pairs(partial) do
        if allowedSections[section] and type(value) == 'table' then
            Utils.MergeDefaults(value, Config[section] or {})
            Config[section] = value
        end
    end

    saveOverrides()

    for _, plyId in ipairs(GetPlayers()) do
        TriggerClientEvent('anticheat:syncConfig', tonumber(plyId), Config)
    end
end)

-- ---------------------------------------------------------------------------
-- Admin commands
-- ---------------------------------------------------------------------------
local function isAdmin(src)
    return src == 0 or IsPlayerAceAllowed(src, Config.Whitelist.panelAce)
end

RegisterCommand('ac_score', function(source, args)
    if not isAdmin(source) then return end
    local target = tonumber(args[1])
    if not target then print('Usage: ac_score <playerId>') return end
    print(('[ANTICHEAT] Player %s suspicion score: %s'):format(target, AC.GetPlayerScore(target)))
end, false)

RegisterCommand('ac_whitelist', function(source, args)
    if not isAdmin(source) then return end
    local target = tonumber(args[1])
    local value = args[2]
    if not target or value == nil then print('Usage: ac_whitelist <playerId> <true|false>') return end
    AC.SetPlayerWhitelisted(target, value == 'true')
    print(('[ANTICHEAT] Player %s whitelist override set to %s'):format(target, value))
end, false)

RegisterCommand('ac_reload', function(source)
    if not isAdmin(source) then return end
    loadOverrides()
    for _, plyId in ipairs(GetPlayers()) do
        TriggerClientEvent('anticheat:syncConfig', tonumber(plyId), Config)
    end
    print('[ANTICHEAT] Config reloaded from disk.')
end, false)

print('[ANTICHEAT] Loaded. Protections: ' .. (function()
    local n = 0
    for _, p in pairs(Config.Protections) do if p.enabled then n = n + 1 end end
    return n
end)() .. ' active.')
