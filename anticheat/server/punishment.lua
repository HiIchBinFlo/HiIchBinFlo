--[[
    server/punishment.lua
    Executes the final action the confidence/score engine (server/detection.lua)
    decides on. Nothing in this file makes the decision - it only carries it
    out, and only after AC.Validation + the score engine have already agreed.
    Bans are stored in a flat JSON file so the framework has zero external
    dependencies; swap AC.Punishment.LoadBans/SaveBans for your own
    database layer if you have one (see docs/INSTALL.md).
]]

AC = AC or {}
AC.Punishment = {}

local BANS_FILE = 'bans.json'
local bansCache = nil

local function loadBans()
    if bansCache then return bansCache end
    local raw = LoadResourceFile(GetCurrentResourceName(), BANS_FILE)
    bansCache = raw and json.decode(raw) or {}
    return bansCache
end

local function saveBans()
    SaveResourceFile(GetCurrentResourceName(), BANS_FILE, json.encode(bansCache or {}), -1)
end

local function getIdentifiers(src)
    local ids = {}
    for i = 0, GetNumPlayerIdentifiers(src) - 1 do
        table.insert(ids, GetPlayerIdentifier(src, i))
    end
    return ids
end

local function primaryIdentifier(ids)
    for _, id in ipairs(ids) do
        if id:find('license:') then return id end
    end
    return ids[1]
end

function AC.Punishment.IsBanned(ids)
    local bans = loadBans()
    for _, id in ipairs(ids) do
        local ban = bans[id]
        if ban then
            if not ban.expiresAt or ban.expiresAt > os.time() then
                return ban
            end
        end
    end
    return nil
end

function AC.Punishment.AddBan(src, ids, reason, durationHours)
    local bans = loadBans()
    local expiresAt = durationHours and (os.time() + durationHours * 3600) or nil
    local record = { reason = reason, bannedAt = os.time(), expiresAt = expiresAt, identifiers = ids }
    for _, id in ipairs(ids) do
        bans[id] = record
    end
    saveBans()
end

function AC.Punishment.RemoveBan(identifier)
    local bans = loadBans()
    bans[identifier] = nil
    saveBans()
end

-- ---------------------------------------------------------------------------
-- Escalation: repeated offenses within Config.Punishment.escalation.windowHours
-- force a minimum severity even if the current single detection would only
-- warrant a lighter action.
-- ---------------------------------------------------------------------------
local function escalate(state, action)
    if not Config.Punishment.escalation.enabled then return action end

    local now = os.time()
    local windowStart = now - (Config.Punishment.escalation.windowHours * 3600)
    local recent = {}
    for _, offense in ipairs(state.offenseHistory) do
        if offense.t >= windowStart then table.insert(recent, offense) end
    end
    state.offenseHistory = recent

    table.insert(state.offenseHistory, { t = now, action = action })
    local count = #state.offenseHistory

    local forced = Config.Punishment.escalation.thresholds[count]
    if not forced then return action end

    local severity = { log = 0, warn = 1, freeze = 2, kick = 3, tempban = 4, ban = 5 }
    if (severity[forced] or 0) > (severity[action] or 0) then
        return forced
    end
    return action
end

local function requestProof(src, callback)
    if not Config.Punishment.requireProof then callback(nil) return end
    if GetResourceState('screenshot-basic') ~= 'started' then callback(nil) return end

    local ok, err = pcall(function()
        exports['screenshot-basic']:requestClientScreenshot(src, {}, function(data)
            callback(data and data.url or nil)
        end)
    end)
    if not ok then callback(nil) end
end

function AC.Punishment.Execute(src, detectionType, action, context)
    local state = AC.GetState(src)
    action = escalate(state, action)

    local name = GetPlayerName(src) or 'unknown'
    local reason = ('Anti-Cheat: %s (score %s)'):format(detectionType, tostring(context.score or 0))

    requestProof(src, function(proofUrl)
        if action == 'log' then
            -- Already logged by server/logging.lua; nothing further to do.
        elseif action == 'warn' then
            TriggerClientEvent('chat:addMessage', src, {
                color = { 255, 165, 0 },
                args = { 'Anti-Cheat', 'Suspicious activity detected. Further violations may result in a kick or ban.' },
            })
        elseif action == 'freeze' then
            TriggerClientEvent('anticheat:freeze', src, Config.Punishment.freezeDurationMs)
        elseif action == 'kick' then
            DropPlayer(src, reason)
        elseif action == 'tempban' then
            local ids = getIdentifiers(src)
            AC.Punishment.AddBan(src, ids, reason, Config.Punishment.tempBanDurationHours)
            DropPlayer(src, ('%s (temporary ban, %sh)'):format(reason, Config.Punishment.tempBanDurationHours))
        elseif action == 'ban' then
            local ids = getIdentifiers(src)
            AC.Punishment.AddBan(src, ids, reason, nil)
            DropPlayer(src, ('%s (permanent ban)'):format(reason))
        end

        AC.Logging.Write({
            source = src,
            name = name,
            detectionType = detectionType,
            confidence = context.confidence,
            evidence = context.evidence,
            validated = context.validated,
            score = context.score,
            action = action,
            proofUrl = proofUrl,
        })
    end)
end

-- ---------------------------------------------------------------------------
-- Ban gate on connect
-- ---------------------------------------------------------------------------
AddEventHandler('playerConnecting', function(name, setKickReason, deferrals)
    local src = source
    deferrals.defer()
    Citizen.Wait(0)

    local ids = getIdentifiers(src)
    local ban = AC.Punishment.IsBanned(ids)
    if ban then
        local msg = ban.expiresAt
            and ('You are temporarily banned. Reason: %s. Expires: %s'):format(ban.reason, os.date('%Y-%m-%d %H:%M:%S', ban.expiresAt))
            or ('You are permanently banned. Reason: %s'):format(ban.reason)
        deferrals.done(msg)
        return
    end

    deferrals.done()
end)

RegisterCommand('anticheat:unban', function(source, args)
    if source ~= 0 and not IsPlayerAceAllowed(source, Config.Whitelist.bypassAce) then return end
    local identifier = args[1]
    if not identifier then return end
    AC.Punishment.RemoveBan(identifier)
    print(('[ANTICHEAT] Removed ban for identifier %s'):format(identifier))
end, true)
