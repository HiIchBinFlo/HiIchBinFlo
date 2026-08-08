--[[
    server/detection.lua
    The confidence/score engine - the one place that turns "a signal fired"
    into "an action happens". A single detection almost never crosses the
    punishment threshold by itself (see shared/config.lua's Advanced.
    punishmentThreshold); it takes multiple correlated signals, each
    weighted by server-side validation confidence, whitelisting and
    per-protection sensitivity.

        Client Detection -> Server Validation -> Confidence -> Score -> Action
]]

AC = AC or {}

local function decayScore(state)
    local now = GetGameTimer()
    local elapsed = now - state.lastDecayAt
    state.lastDecayAt = now

    local sinceDetection = now - (state.lastDetectionAt or 0)
    if sinceDetection < (Config.Advanced.scoreDecay.graceMs or 15000) then
        return -- no decay right after a fresh detection
    end

    state.suspicionScore = Utils.DecayScore(state.suspicionScore, Config.Advanced.scoreDecay.perSecond or 1.5, elapsed)
end

local function computeScoreAddition(detectionType, def, confidence, protectionConfig)
    if detectionType == 'AIMBOT_SUSPICION' then
        return nil -- handled by caller using the aim-specific bands
    end

    local sensitivity = (protectionConfig.sensitivity or 1.0) * (Config.Advanced.detectionSensitivity or 1.0)
    return def.score * confidence * sensitivity
end

local function computeAimAddition(evidence)
    local aimScore = Utils.Clamp(evidence.score or 0, 0, 100)
    for _, band in ipairs(Config.Scoring.aimScoreBands) do
        if aimScore <= band.max then
            return aimScore * band.multiplier, aimScore
        end
    end
    return 0, aimScore
end

local punishmentCooldowns = Utils.NewCooldownTracker()

function AC.Report(src, detectionType, evidence, clientTimestamp)
    local def = DetectionTypes[detectionType]
    if not def then return end

    local protectionKey = DetectionTypes.ProtectionKey[detectionType]
    local protectionConfig = protectionKey and Config.Protections[protectionKey]
    if not protectionConfig or not protectionConfig.enabled then return end

    local state = AC.GetState(src)

    if not (state.lastReportAt[detectionType] == nil
        or (GetGameTimer() - state.lastReportAt[detectionType]) >= (protectionConfig.cooldown or 3000)) then
        return
    end
    state.lastReportAt[detectionType] = GetGameTimer()

    decayScore(state)

    local accepted, confidence, reason = AC.Validation.Validate(src, detectionType, evidence or {})

    state.detections[detectionType] = (state.detections[detectionType] or 0) + 1
    if not accepted then
        state.falsePositives[detectionType] = (state.falsePositives[detectionType] or 0) + 1
        if Config.Advanced.debug then
            AC.Logging.Write({
                source = src, name = GetPlayerName(src), detectionType = detectionType,
                confidence = 0, evidence = evidence, validated = false,
                score = state.suspicionScore, action = 'log',
            })
        end
        return
    end

    local addition, aimScore
    if detectionType == 'AIMBOT_SUSPICION' then
        addition, aimScore = computeAimAddition(evidence or {})
    else
        addition = computeScoreAddition(detectionType, def, confidence, protectionConfig)
    end

    state.suspicionScore = math.min(state.suspicionScore + addition, 999)
    state.lastDetectionAt = GetGameTimer()

    local whitelisted = AC.IsWhitelisted(src)
    local plannedAction = whitelisted and 'log' or 'log'
    local overThreshold = state.suspicionScore >= (Config.Advanced.punishmentThreshold or 100)

    if overThreshold and not whitelisted then
        plannedAction = protectionConfig.action
    end

    AC.Logging.Write({
        source = src,
        name = GetPlayerName(src),
        detectionType = detectionType,
        confidence = confidence,
        evidence = evidence,
        validated = true,
        score = Utils.Round(state.suspicionScore, 1),
        action = plannedAction,
    })

    if overThreshold and not whitelisted then
        if punishmentCooldowns:ready('punish:' .. src, 5000) then
            AC.Punishment.Execute(src, detectionType, protectionConfig.action, {
                confidence = confidence,
                evidence = evidence,
                validated = true,
                score = Utils.Round(state.suspicionScore, 1),
            })
            -- Halve the score after acting so a single burst doesn't chain
            -- into repeated punishments while still preserving history for
            -- the escalation window in server/punishment.lua.
            state.suspicionScore = state.suspicionScore / 2
        end
    end
end

RegisterNetEvent('anticheat:report', function(detectionType, evidence, clientTimestamp)
    AC.Report(source, detectionType, evidence, clientTimestamp)
end)

-- Lets other server resources feed the score engine directly (e.g. a
-- server-authoritative check that lives outside this resource entirely).
function AC.AddSuspicion(src, amount, reason)
    local state = AC.GetState(src)
    decayScore(state)
    state.suspicionScore = math.min(state.suspicionScore + amount, 999)
    state.lastDetectionAt = GetGameTimer()

    if state.suspicionScore >= (Config.Advanced.punishmentThreshold or 100) and not AC.IsWhitelisted(src) then
        if punishmentCooldowns:ready('punish:' .. src, 5000) then
            AC.Punishment.Execute(src, reason or 'EXTERNAL_SUSPICION', 'kick', {
                confidence = 1.0, evidence = { reason = reason }, validated = true,
                score = Utils.Round(state.suspicionScore, 1),
            })
            state.suspicionScore = state.suspicionScore / 2
        end
    end
end
exports('AddSuspicion', AC.AddSuspicion)

-- Background decay tick for players who currently have score but haven't
-- triggered a fresh report (so the number visibly comes back down).
Citizen.CreateThread(function()
    while true do
        Wait(5000)
        for _, state in pairs(AC.Players) do
            if state.suspicionScore > 0 then
                decayScore(state)
            end
        end
    end
end)
