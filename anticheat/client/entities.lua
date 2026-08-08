--[[
    client/entities.lua
    Entity/object/ped/vehicle/pickup spam is primarily enforced server-side
    (server/main.lua hooks the `entityCreating` server event, which can see
    and cancel every networked entity regardless of which client or script
    created it - the client can never see entities other resources create
    without a real native call, and definitely can't be trusted to self-
    report its own abuse). This module only provides a coarse, cheap,
    distance-limited "how crowded is it around me" sensor used as
    supporting context, not a standalone verdict.
]]

local SCAN_RADIUS = 30.0
local lastCounts = { objects = 0, peds = 0, vehicles = 0 }

local function countNearby(pool, coords, radius)
    local count = 0
    local handles = GetGamePool(pool)
    for i = 1, #handles do
        local ent = handles[i]
        if DoesEntityExist(ent) and Utils.Distance(coords, GetEntityCoords(ent)) <= radius then
            count = count + 1
        end
    end
    return count
end

AC.RegisterCheck('entitySpam', {
    category = 'entities',
    baseInterval = 4000,
    minInterval = 2500,
    maxInterval = 12000,
    tick = function()
        local ped = PlayerPedId()
        local coords = GetEntityCoords(ped)

        local objects = countNearby('CObject', coords, SCAN_RADIUS)
        local vehicles = countNearby('CVehicle', coords, SCAN_RADIUS)
        local peds = countNearby('CPed', coords, SCAN_RADIUS)

        local thresholds = AC.Config.Advanced.entitySpamThresholds or { objects = 80, vehicles = 40, peds = 60 }

        if objects > thresholds.objects and objects > lastCounts.objects then
            AC.Report('OBJECT_SPAM', { count = objects, radius = SCAN_RADIUS })
        end
        if vehicles > thresholds.vehicles and vehicles > lastCounts.vehicles then
            AC.Report('VEHICLE_SPAM', { count = vehicles, radius = SCAN_RADIUS })
        end
        if peds > thresholds.peds and peds > lastCounts.peds then
            AC.Report('PED_SPAM', { count = peds, radius = SCAN_RADIUS })
        end

        lastCounts = { objects = objects, vehicles = vehicles, peds = peds }
    end,
})

-- Local explosion sighting -> lightweight context report. Authoritative
-- rate limiting + whitelist enforcement happens server-side against the
-- server's own `explosionEvent` (see server/main.lua), which fires
-- regardless of what any single client reports.
local explosionCooldown = Utils.NewCooldownTracker()
AddEventHandler('explosionEvent', function(sender, ev)
    if not explosionCooldown:ready('local_explosion', 1000) then return end
    if not AC.IsProtectionEnabled('explosionSpam') then return end
    AC.Report('EXPLOSION_SPAM', { explosionType = ev.explosionType, posX = ev.posX, posY = ev.posY, posZ = ev.posZ })
end)
