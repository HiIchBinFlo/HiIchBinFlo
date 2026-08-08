--[[
    server/player_state.lua
    Per-player authoritative state: position/health history (used to
    independently re-derive speed/teleport plausibility), suspicion score,
    detection/false-positive counters and whitelist status. This is the
    server's own memory - it never trusts a client's self-reported history.
]]

AC = AC or {}
AC.Players = {}

local function newState(src)
    return {
        source = src,
        joinedAt = os.time(),
        positionHistory = Utils.NewRingBuffer(20), -- {t, coords, weaponHash}
        healthHistory = Utils.NewRingBuffer(10),   -- {t, health, armor}
        suspicionScore = 0,
        lastDecayAt = GetGameTimer(),
        lastDetectionAt = 0,
        detections = {},          -- type -> count
        falsePositives = {},      -- type -> count
        lastReportAt = {},        -- type -> GetGameTimer(), for cooldown enforcement
        currentWeapon = nil,
        whitelistOverride = nil,   -- explicit true/false set via export, overrides ACE lookup
        frozen = false,
        offenseHistory = {},       -- {t, action} for escalation window
        lastHeartbeatAt = GetGameTimer(),
    }
end

function AC.GetState(src)
    local state = AC.Players[src]
    if not state then
        state = newState(src)
        AC.Players[src] = state
    end
    return state
end

function AC.RemovePlayer(src)
    AC.Players[src] = nil
end

AddEventHandler('playerDropped', function()
    AC.RemovePlayer(source)
end)

-- ---------------------------------------------------------------------------
-- Whitelist / permission groups
-- Framework-agnostic default: ACE permissions. Call the SetPlayerWhitelisted
-- export from your framework's admin resource to override explicitly
-- (e.g. based on your own admin/staff table) without touching ACE.
-- ---------------------------------------------------------------------------
function AC.IsWhitelisted(src)
    local state = AC.GetState(src)
    if state.whitelistOverride ~= nil then return state.whitelistOverride end

    if not Config.Advanced.adminBypass then return false end

    if IsPlayerAceAllowed(src, Config.Whitelist.bypassAce) then return true end

    for _, group in ipairs(Config.Advanced.permissionGroups.bypass or {}) do
        if IsPlayerAceAllowed(src, 'group.' .. group) then return true end
    end

    return false
end
exports('IsWhitelisted', AC.IsWhitelisted)

function AC.SetPlayerWhitelisted(src, value)
    AC.GetState(src).whitelistOverride = value
end
exports('SetPlayerWhitelisted', AC.SetPlayerWhitelisted)

-- ---------------------------------------------------------------------------
-- Position/health history
-- ---------------------------------------------------------------------------
function AC.PushPosition(src, coords, weaponHash)
    local state = AC.GetState(src)
    state.positionHistory:push({ t = GetGameTimer(), coords = coords, weaponHash = weaponHash })
end

function AC.PushHealth(src, health, armor)
    local state = AC.GetState(src)
    state.healthHistory:push({ t = GetGameTimer(), health = health, armor = armor })
end

function AC.GetLastPosition(src)
    return AC.GetState(src).positionHistory:latest()
end

-- ---------------------------------------------------------------------------
-- Score access (used by the settings panel + exports)
-- ---------------------------------------------------------------------------
function AC.GetPlayerScore(src)
    return AC.GetState(src).suspicionScore
end
exports('GetPlayerScore', AC.GetPlayerScore)

-- Periodic server-side position refresh independent of client reports, so
-- history exists even for players who never trigger a detection. Cheap:
-- GetEntityCoords on synced player peds is just a state read, no world
-- queries, run at a relaxed interval.
Citizen.CreateThread(function()
    while true do
        Wait(2000)
        for _, src in ipairs(GetPlayers()) do
            local ped = GetPlayerPed(src)
            if ped ~= 0 then
                local ok, coords = pcall(GetEntityCoords, ped)
                if ok then
                    AC.PushPosition(tonumber(src), coords)
                    local okh, health = pcall(GetEntityHealth, ped)
                    local oka, armor = pcall(GetPedArmour, ped)
                    if okh and oka then
                        AC.PushHealth(tonumber(src), health, armor)
                    end
                end
            end
        end
    end
end)
