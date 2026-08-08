--[[
    client/combat.lua
    Behaviour-based aim suspicion. This deliberately does NOT flag "crosshair
    on player" - it builds a rolling 0-100 aim score out of several weak
    signals (consistency of tracking, snap-to-target speed, headshot ratio)
    and only reports the aggregate, on a cooldown, so a single lucky shot or
    a single snappy flick never matters on its own.

    Sampling only does real work while the player is actually free-aiming,
    so the idle cost is a couple of native calls, not a hot loop.
]]

local rotSamples = Utils.NewRingBuffer(10) -- {t, rot}
local currentTarget = 0
local lastSwitchAt = 0
local consistentStreak = 0
local aimScore = 0.0
local lastScoreDecayAt = GetGameTimer()

local shotsFired = 0
local headshots = 0
local shotWindowStart = GetGameTimer()

local function decayAimScore(now)
    local elapsed = now - lastScoreDecayAt
    if elapsed <= 0 then return end
    aimScore = Utils.DecayScore(aimScore, 4.0, elapsed) -- faster decay than global suspicion
    lastScoreDecayAt = now
end

local function angleBetween(a, b)
    local dx = math.abs(a.x - b.x)
    local dy = math.abs(a.y - b.y)
    local dz = math.abs(a.z - b.z)
    if dx > 180 then dx = 360 - dx end
    if dy > 180 then dy = 360 - dy end
    if dz > 180 then dz = 360 - dz end
    return math.sqrt(dx * dx + dy * dy + dz * dz)
end

local function sampleTracking(now)
    local rot = GetGameplayCamRot(2)
    rotSamples:push({ t = now, rot = rot })
    if rotSamples.count < 3 then return end

    local s1, s2, s3 = rotSamples:get(1), rotSamples:get(2), rotSamples:get(3)
    local dt1 = (s1.t - s2.t) / 1000.0
    local dt2 = (s2.t - s3.t) / 1000.0
    if dt1 <= 0 or dt2 <= 0 then return end

    local vel1 = angleBetween(s1.rot, s2.rot) / dt1
    local vel2 = angleBetween(s2.rot, s3.rot) / dt2

    if vel1 > 5 and vel2 > 5 then
        local diff = math.abs(vel1 - vel2) / math.max(vel1, vel2)
        if diff < 0.03 then
            -- Near-perfectly constant angular velocity while actively
            -- tracking - unusual for human micro-corrections.
            consistentStreak = consistentStreak + 1
            if consistentStreak >= 6 then
                aimScore = math.min(100, aimScore + 3)
            end
        else
            consistentStreak = math.max(0, consistentStreak - 1)
        end
    end
end

local function checkTargetSwitch(now)
    local target = GetEntityPlayerIsFreeAimingAt(PlayerId())
    if not target then target = 0 end

    if target ~= 0 and target ~= currentTarget and currentTarget ~= 0 then
        local dt = now - lastSwitchAt
        local s1 = rotSamples:get(1)
        local s2 = rotSamples:get(2)
        if s1 and s2 and dt > 0 and dt < 5000 then
            local angle = angleBetween(s1.rot, s2.rot)
            local ms = math.abs(s1.t - s2.t)
            if ms > 0 and ms < 120 and angle > 55 then
                aimScore = math.min(100, aimScore + 15)
            end
        end
    end

    if target ~= currentTarget then
        currentTarget = target
        lastSwitchAt = now
    end
end

-- See client/integrity.lua for the shared note on CEventNetworkEntityDamage's
-- community-standard argument layout.
AddEventHandler('gameEventTriggered', function(name, args)
    if name ~= 'CEventNetworkEntityDamage' then return end
    local attacker = args[2]
    if attacker ~= PlayerPedId() then return end

    local victim = args[1]
    shotsFired = shotsFired + 1

    local ok, boneName = pcall(function() return select(2, GetPedLastDamageBone(victim)) end)
    if ok and boneName == 'SKEL_Head' then
        headshots = headshots + 1
    end
end)

local function evaluateHeadshotRate(now)
    local windowMs = now - shotWindowStart
    if windowMs < 20000 or shotsFired < 8 then return end

    local ratio = headshots / shotsFired
    if ratio > 0.75 then
        aimScore = math.min(100, aimScore + 10)
    end

    shotsFired, headshots = 0, 0
    shotWindowStart = now
end

local reportCooldown = Utils.NewCooldownTracker()

AC.RegisterCheck('aimbot', {
    category = 'combat',
    baseInterval = 150,
    minInterval = 100,
    maxInterval = 1000,
    tick = function()
        local now = GetGameTimer()
        decayAimScore(now)

        local playerId = PlayerId()
        if IsPlayerFreeAiming(playerId) then
            sampleTracking(now)
            checkTargetSwitch(now)
        else
            rotSamples:clear()
            consistentStreak = 0
        end

        evaluateHeadshotRate(now)

        if aimScore >= (AC.Config.Advanced.confidenceThreshold or 60) then
            if reportCooldown:ready('aimbot', 8000) then
                AC.Report('AIMBOT_SUSPICION', { score = Utils.Round(aimScore, 1) })
            end
        end
    end,
})
