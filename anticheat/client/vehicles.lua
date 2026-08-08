--[[
    client/vehicles.lua
    Vehicle protections: own-vehicle godmode/speed/fly/teleport, plus a
    spatially- and temporally-limited scan for the "vehicle thrown at a
    player" pattern. Nearby-vehicle scans only ever look at vehicles within
    a small radius and are capped per tick - never a full entity-pool scan.
]]

local ownVehHistory = Utils.NewRingBuffer(6) -- {t, coords, speed, health}
local lastOwnVehicle = 0
local nearbyVelocityCache = {} -- handle -> {t, vel, coords}

local VEHICLE_CLASS_MAX_SPEED = {
    [8] = 45.0,   -- motorcycles
    [15] = 30.0,   -- helicopters (handled separately, generous)
    [16] = 140.0,  -- planes
    default = 90.0,
}

local function getSpeedCap(vehicle)
    local class = GetVehicleClass(vehicle)
    return VEHICLE_CLASS_MAX_SPEED[class] or VEHICLE_CLASS_MAX_SPEED.default
end

local function isFlyingClass(vehicle)
    local class = GetVehicleClass(vehicle)
    return class == 15 or class == 16 -- helicopters, planes
end

local function checkOwnVehicle(ped)
    if not IsPedInAnyVehicle(ped, false) then
        ownVehHistory:clear()
        lastOwnVehicle = 0
        return
    end

    local vehicle = GetVehiclePedIsIn(ped, false)
    if GetPedInVehicleSeat(vehicle, -1) ~= ped then
        -- Only the driver's inputs are meaningful for speed/throw analysis.
        ownVehHistory:clear()
        return
    end

    if vehicle ~= lastOwnVehicle then
        ownVehHistory:clear()
        lastOwnVehicle = vehicle
    end

    local now = GetGameTimer()
    local coords = GetEntityCoords(vehicle)
    local speed = GetEntitySpeed(vehicle)
    local health = GetVehicleEngineHealth(vehicle)

    local prev = ownVehHistory:latest()
    if prev then
        local dt = (now - prev.t) / 1000.0
        if dt > 0 then
            local dist = Utils.Distance(coords, prev.coords)
            local impliedSpeed = dist / dt

            if dist > 60 and impliedSpeed > 200 and AC.IsTeleportSuppressed() == false then
                if AC.IsProtectionEnabled('vehicleSpeed') then
                    AC.Report('VEHICLE_TELEPORT', { distance = Utils.Round(dist, 2) })
                end
            elseif speed > getSpeedCap(vehicle) * 1.4 and AC.IsProtectionEnabled('vehicleSpeed') then
                AC.Report('VEHICLE_SPEED_MANIPULATION', { speed = Utils.Round(speed, 2), model = GetEntityModel(vehicle) })
            end
        end
    end

    if not isFlyingClass(vehicle) and IsEntityInAir(vehicle) then
        local heightAboveGround = GetEntityHeightAboveGround(vehicle)
        if heightAboveGround > 8.0 and speed > 5.0 then
            if AC.IsProtectionEnabled('vehicleGodmode') then
                AC.Report('FLY_VEHICLE', { height = Utils.Round(heightAboveGround, 2) })
            end
        end
    end

    ownVehHistory:push({ t = now, coords = coords, speed = speed, health = health })
end

-- Anti Vehicle Throw: only scans vehicles within THROW_RADIUS of the local
-- player, at most THROW_SCAN_LIMIT per tick, and only reports when a vehicle
-- with no driver suddenly gains a large velocity spike aimed roughly at a
-- nearby player - explosions/ramps/collisions are excluded via the sampled
-- exclusion window below.
local THROW_RADIUS = 20.0
local THROW_SCAN_LIMIT = 12
local recentExplosionUntil = 0

AddEventHandler('explosionEvent', function()
    -- Give physics from nearby explosions a window to explain sudden
    -- vehicle velocity before we consider it a "throw".
    recentExplosionUntil = GetGameTimer() + 1500
end)

local function scanNearbyVehiclesForThrow(myPed, myCoords)
    if GetGameTimer() < recentExplosionUntil then return end

    local handle, vehicle = FindFirstVehicle()
    local success
    local scanned = 0
    repeat
        if scanned >= THROW_SCAN_LIMIT then break end
        if DoesEntityExist(vehicle) then
            local coords = GetEntityCoords(vehicle)
            if Utils.Distance(myCoords, coords) <= THROW_RADIUS then
                scanned = scanned + 1
                local driver = GetPedInVehicleSeat(vehicle, -1)
                local hasDriver = driver ~= 0 and DoesEntityExist(driver)
                local vel = GetEntityVelocity(vehicle)
                local speed = math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z)

                local cache = nearbyVelocityCache[vehicle]
                if cache then
                    local dt = (GetGameTimer() - cache.t) / 1000.0
                    if dt > 0 then
                        local accel = math.abs(speed - cache.speed) / dt
                        if not hasDriver and accel > 25 and speed > 15 then
                            local distToMe = Utils.Distance(coords, myCoords)
                            if distToMe < THROW_RADIUS and AC.IsProtectionEnabled('vehicleThrow') then
                                AC.Report('VEHICLE_THROW', {
                                    vehicle = GetEntityModel(vehicle),
                                    speed = Utils.Round(speed, 2),
                                    accel = Utils.Round(accel, 2),
                                })
                            end
                        end
                    end
                end
                nearbyVelocityCache[vehicle] = { t = GetGameTimer(), speed = speed }
            end
        end
        success, vehicle = FindNextVehicle(handle)
    until not success
    EndFindVehicle(handle)
end

AC.RegisterCheck('vehicleGodmode', {
    category = 'vehicles',
    baseInterval = 500,
    minInterval = 300,
    maxInterval = 2500,
    -- Shares one vehicle position/speed sample across godmode/fly/speed/
    -- teleport checks - see AC.RegisterCheck's docstring in client/main.lua.
    protections = { 'vehicleGodmode', 'vehicleSpeed' },
    tick = function()
        checkOwnVehicle(PlayerPedId())
    end,
})

AC.RegisterCheck('vehicleThrow', {
    category = 'vehicles',
    baseInterval = 800,
    minInterval = 500,
    maxInterval = 3000,
    tick = function()
        local ped = PlayerPedId()
        scanNearbyVehiclesForThrow(ped, GetEntityCoords(ped))
    end,
})
