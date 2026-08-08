--[[
    client/weapons.lua
    Weapon suspicion signals: unauthorized weapons, ammo manipulation,
    rapid/fire-rate manipulation. The server holds the authoritative
    whitelist (Config.Whitelist.weapons + any job/resource whitelist) and
    makes the final call in server/validation.lua - this module only
    reports what the local weapon/ammo state looks like.
]]

local currentWeapon = nil
local lastAmmo = nil
local shotIntervals = Utils.NewRingBuffer(8)
local lastShotAt = 0
local wasShooting = false

-- Conservative per-class minimum interval (ms) between shots. Anything
-- consistently faster than this, sustained across a full ring buffer, is
-- reported - single fast taps (real macro/rapid clickers exist) are
-- filtered out by requiring the whole buffer to agree.
local FIRE_RATE_FLOORS = {
    default = 80,
    [GetHashKey('WEAPON_PISTOL')] = 140,
    [GetHashKey('WEAPON_COMBATPISTOL')] = 140,
    [GetHashKey('WEAPON_SNIPERRIFLE')] = 900,
    [GetHashKey('WEAPON_HEAVYSNIPER')] = 1100,
    [GetHashKey('WEAPON_PUMPSHOTGUN')] = 700,
}

local function checkWeaponChange(ped)
    local _, weaponHash = GetCurrentPedWeapon(ped, true)
    if weaponHash == currentWeapon then return end

    currentWeapon = weaponHash
    shotIntervals:clear()
    lastAmmo = nil

    TriggerServerEvent('anticheat:weaponChanged', weaponHash)
end

local function checkAmmo(ped)
    if currentWeapon == nil or currentWeapon == GetHashKey('WEAPON_UNARMED') then return end
    local ammo = GetAmmoInPedWeapon(ped, currentWeapon)

    if lastAmmo ~= nil and ammo > lastAmmo then
        -- Ammo increased without a pickup/reload/give event we were told
        -- about. Server cross-checks this against its own weapon-give log.
        if AC.IsProtectionEnabled('weapon') then
            AC.Report('AMMO_MANIPULATION', { weapon = currentWeapon, from = lastAmmo, to = ammo })
        end
    end

    lastAmmo = ammo
end

local function checkFireRate(ped)
    if currentWeapon == nil then return end
    local shooting = IsPedShooting(ped)

    if shooting and not wasShooting then
        local now = GetGameTimer()
        if lastShotAt > 0 then
            shotIntervals:push(now - lastShotAt)
        end
        lastShotAt = now

        if shotIntervals.count == shotIntervals.size then
            local floor = FIRE_RATE_FLOORS[currentWeapon] or FIRE_RATE_FLOORS.default
            local allFast = true
            for interval in shotIntervals:each() do
                if interval >= floor then allFast = false break end
            end
            if allFast and AC.IsProtectionEnabled('weapon') then
                AC.Report('RAPID_FIRE', { weapon = currentWeapon, floorMs = floor })
            end
        end
    end

    wasShooting = shooting
end

AC.RegisterCheck('weapon', {
    category = 'weapons',
    baseInterval = 250,
    minInterval = 150,
    maxInterval = 1500,
    tick = function()
        local ped = PlayerPedId()
        if IsEntityDead(ped) then return end
        checkWeaponChange(ped)
        checkAmmo(ped)
        checkFireRate(ped)
    end,
})

-- Weapon-give validation is a classic event-abuse vector: a modified
-- client can fake having received a weapon it never should have. We do not
-- trust local GiveWeaponToPed calls originating from anywhere but our own
-- server event, and that server event itself re-checks the whitelist
-- (see server/validation.lua's `weapon` rule + server/main.lua's handler).
RegisterNetEvent('anticheat:forceRemoveWeapon', function(weaponHash)
    local ped = PlayerPedId()
    RemoveWeaponFromPed(ped, weaponHash)
end)
