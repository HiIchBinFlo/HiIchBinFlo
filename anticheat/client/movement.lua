--[[
    client/movement.lua
    Movement-related suspicion signals: noclip, fly, freecam, teleport,
    speedhack, super jump, infinite stamina, gravity manipulation, abnormal
    fall speed and invalid state changes.

    Every check here is a SIGNAL, not a verdict - the client cannot see
    world collision from the server side, so all of these are reported with
    evidence and re-checked against server-tracked position history in
    server/validation.lua before they ever touch a suspicion score.
]]

local history = Utils.NewRingBuffer(8) -- {t, coords, vel, speed}
local lastSample = nil
local airborneStartMs = nil
local freecamStartMs = nil
local spawnGraceUntil = GetGameTimer() + 4000 -- ignore everything right after resource/spawn
local lastInterior = 0
local staminaHistory = Utils.NewRingBuffer(6)

local MAX_HUMAN_SPEED = 8.5      -- m/s, sprinting on foot with stamina/road perks
local MAX_VEHICLE_SPEED = 130.0   -- m/s, generous ceiling for supercars/aircraft edge cases
local MAX_FALL_SPEED = 55.0       -- m/s terminal-ish velocity ceiling

local function inContextException(ped)
    if AC.IsTeleportSuppressed() or AC.IsStateChangeSuppressed() then return true end
    if GetGameTimer() < spawnGraceUntil then return true end
    if IsPedRagdoll(ped) then return true end
    if IsPedClimbing(ped) then return true end
    if IsPedSwimming(ped) or IsPedSwimmingUnderWater(ped) then return true end
    if IsPedInParachuteFreeFall(ped) or IsPedInParachute(ped) then return true end
    if IsEntityAttached(ped) then return true end -- cutscenes, attach-to-vehicle scripts, etc.
    if IsPedInAnyVehicle(ped, false) then return true end
    return false
end

RegisterNetEvent('anticheat:respawned', function()
    spawnGraceUntil = GetGameTimer() + 4000
    history:clear()
    lastSample = nil
end)

AddEventHandler('playerSpawned', function()
    spawnGraceUntil = GetGameTimer() + 4000
    history:clear()
    lastSample = nil
end)

local function resetBaseline()
    history:clear()
    lastSample = nil
    airborneStartMs = nil
end

local function checkTeleportAndSpeed(ped, now, coords)
    if not lastSample then return end
    local dt = (now - lastSample.t) / 1000.0
    if dt <= 0 then return end

    local dist = Utils.Distance(coords, lastSample.coords)
    local speed = dist / dt
    local inVehicle = IsPedInAnyVehicle(ped, false)
    local cap = inVehicle and MAX_VEHICLE_SPEED or MAX_HUMAN_SPEED

    -- Teleport: single-tick jump far beyond anything physically reachable,
    -- even accounting for lag/interpolation.
    if dist > 40 and speed > cap * 4 then
        if AC.IsProtectionEnabled('teleport') then
            AC.Report('TELEPORT', {
                from = lastSample.coords, to = coords, distance = Utils.Round(dist, 2),
                deltaMs = math.floor(dt * 1000),
            })
        end
        resetBaseline()
        return
    end

    -- Speedhack / impossible distance: sustained speed above the plausible
    -- cap, not just a single-frame spike (network jitter tolerant).
    if speed > cap * 1.5 then
        if AC.IsProtectionEnabled('speedhack') then
            AC.Report('SPEEDHACK', { speed = Utils.Round(speed, 2), cap = cap, inVehicle = inVehicle })
        end
    end

    -- Abnormal acceleration: velocity delta between samples beyond what
    -- sprinting/braking/vehicle engines can plausibly produce.
    local prevSpeed = lastSample.speed or 0
    local accel = math.abs(speed - prevSpeed) / dt
    local accelCap = inVehicle and 40.0 or 20.0
    if accel > accelCap then
        if AC.IsProtectionEnabled('speedhack') then
            AC.Report('ABNORMAL_ACCELERATION', { accel = Utils.Round(accel, 2), inVehicle = inVehicle })
        end
    end

    return speed
end

-- Raycast-based noclip signal: the client CAN see world geometry (the
-- server cannot), so this only ever runs client-side and is reported as
-- evidence for the server to correlate with position-history plausibility.
local function checkNoclip(ped, coords)
    if not lastSample then return end
    if IsEntityInWater(ped) then return end

    local from = lastSample.coords
    local to = coords
    if Utils.Distance(from, to) < 0.5 then return end

    local rayHandle = StartShapeTestRay(from.x, from.y, from.z + 0.5, to.x, to.y, to.z + 0.5, 1 + 16, ped, 0)
    local _, hit, _, _, _ = GetShapeTestResult(rayHandle)

    if hit == 1 then
        -- Something solid sits between the two samples, yet the ped ended
        -- up past it without any collision response (no ragdoll/stumble).
        if AC.IsProtectionEnabled('noclip') then
            AC.Report('NOCLIP', { from = from, to = to })
        end
    end
end

local function checkFly(ped, now, coords, horizontalSpeed)
    if IsPedFalling(ped) or IsPedJumping(ped) then
        airborneStartMs = nil
        return
    end

    if IsEntityInAir(ped) then
        airborneStartMs = airborneStartMs or now
        local airborneMs = now - airborneStartMs
        if airborneMs > 2500 and (horizontalSpeed or 0) > 2.0 then
            if AC.IsProtectionEnabled('fly') then
                AC.Report('FLY', { airborneMs = airborneMs, speed = Utils.Round(horizontalSpeed or 0, 2) })
            end
        elseif airborneMs > 1200 and (horizontalSpeed or 0) < 0.3 then
            -- hovering in place mid-air with no fall - classic noclip/fly hover
            if AC.IsProtectionEnabled('fly') then
                AC.Report('AIR_MOVEMENT', { airborneMs = airborneMs })
            end
        end
    else
        airborneStartMs = nil
    end
end

local function checkGravityAndFall(ped)
    if not IsEntityInAir(ped) or IsPedInParachuteFreeFall(ped) then return end
    local vel = GetEntityVelocity(ped)
    local vz = vel.z

    if vz < -MAX_FALL_SPEED then
        if AC.IsProtectionEnabled('gravity') then
            AC.Report('ABNORMAL_FALL_SPEED', { verticalSpeed = Utils.Round(vz, 2) })
        end
    end

    -- Falling but vertical speed staying near zero for an extended period
    -- (feather-fall / gravity-disable) while clearly airborne and not
    -- parachuting/on a ladder/swimming.
    if IsPedFalling(ped) and math.abs(vz) < 0.5 then
        if AC.IsProtectionEnabled('gravity') then
            AC.Report('GRAVITY_MANIPULATION', { verticalSpeed = Utils.Round(vz, 2) })
        end
    end
end

local function checkSuperJump(ped)
    if not IsPedJumping(ped) then return end
    local vel = GetEntityVelocity(ped)
    if vel.z > 9.0 then -- normal jump impulse tops out well below this
        if AC.IsProtectionEnabled('superJump') then
            AC.Report('SUPER_JUMP', { verticalVelocity = Utils.Round(vel.z, 2) })
        end
    end
end

local function checkInfiniteStamina(ped)
    if not IsPedSprinting(ped) then
        staminaHistory:clear()
        return
    end
    local stamina = GetPlayerSprintStaminaRemaining(PlayerId())
    staminaHistory:push(stamina)
    if staminaHistory.count == staminaHistory.size then
        local allFull = true
        for v in staminaHistory:each() do
            if v < 99 then allFull = false break end
        end
        if allFull then
            if AC.IsProtectionEnabled('infiniteStamina') then
                AC.Report('INFINITE_STAMINA', { sampleCount = staminaHistory.count })
            end
        end
    end
end

-- Freecam: gameplay camera diverges far from the ped for a sustained
-- period while the ped itself stays put (rules out normal third-person
-- look-around, which snaps back and doesn't hold a static large offset).
local function checkFreecam(ped, now, coords)
    local camCoord = GetGameplayCamCoord()
    local dist = Utils.Distance(camCoord, coords)
    if dist > 15.0 then
        freecamStartMs = freecamStartMs or now
        if now - freecamStartMs > 3000 then
            if AC.IsProtectionEnabled('freecam') then
                AC.Report('FREECAM', { camDistance = Utils.Round(dist, 2) })
            end
        end
    else
        freecamStartMs = nil
    end
end

local function checkInterior(ped)
    local interior = GetInteriorFromEntity(ped)
    if lastInterior ~= 0 and interior ~= lastInterior then
        -- Legit interior changes happen via doors/scripts constantly; this
        -- is informational only and folds into teleport context, not its
        -- own report.
        resetBaseline()
    end
    lastInterior = interior
end

AC.RegisterCheck('noclip', {
    category = 'movement',
    baseInterval = 400,
    minInterval = 250,
    maxInterval = 2000,
    -- Shares one position sample per tick across noclip/teleport/speedhack -
    -- see AC.RegisterCheck's docstring in client/main.lua for why this
    -- needs the full protections list rather than just 'noclip'.
    protections = { 'noclip', 'teleport', 'speedhack' },
    tick = function()
        local ped = PlayerPedId()
        if not DoesEntityExist(ped) or IsEntityDead(ped) then resetBaseline() return end
        local now = GetGameTimer()
        local coords = GetEntityCoords(ped)

        checkInterior(ped)

        if inContextException(ped) then
            lastSample = { t = now, coords = coords, speed = 0 }
            return
        end

        local speed = checkTeleportAndSpeed(ped, now, coords)
        if lastSample then
            checkNoclip(ped, coords)
        end

        lastSample = { t = now, coords = coords, speed = speed or 0 }
    end,
})

AC.RegisterCheck('fly', {
    category = 'movement',
    baseInterval = 500,
    minInterval = 300,
    maxInterval = 2500,
    tick = function()
        local ped = PlayerPedId()
        if inContextException(ped) then airborneStartMs = nil return end
        local now = GetGameTimer()
        local coords = GetEntityCoords(ped)
        local vel = GetEntityVelocity(ped)
        local horizontalSpeed = math.sqrt(vel.x * vel.x + vel.y * vel.y)
        checkFly(ped, now, coords, horizontalSpeed)
    end,
})

AC.RegisterCheck('gravity', {
    category = 'movement',
    baseInterval = 500,
    minInterval = 300,
    maxInterval = 2500,
    protections = { 'gravity', 'superJump' },
    tick = function()
        local ped = PlayerPedId()
        if inContextException(ped) then return end
        checkGravityAndFall(ped)
        checkSuperJump(ped)
    end,
})

AC.RegisterCheck('infiniteStamina', {
    category = 'movement',
    baseInterval = 2000,
    minInterval = 1000,
    maxInterval = 6000,
    tick = function()
        local ped = PlayerPedId()
        if IsPedInAnyVehicle(ped, false) or IsEntityDead(ped) then return end
        checkInfiniteStamina(ped)
    end,
})

AC.RegisterCheck('freecam', {
    category = 'movement',
    baseInterval = 700,
    minInterval = 400,
    maxInterval = 3000,
    tick = function()
        local ped = PlayerPedId()
        if inContextException(ped) then freecamStartMs = nil return end
        checkFreecam(ped, GetGameTimer(), GetEntityCoords(ped))
    end,
})
