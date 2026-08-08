--[[
    client/integrity.lua
    Godmode/health suspicion signals plus lightweight resource/state
    integrity checks. The client can observe its own health/armor/damage
    events, but it can never prove them - server/validation.lua cross-checks
    the networked (server-synced) health/armor state before scoring.
]]

local DEFAULT_MAX_HEALTH = 200
local baselineMaxHealth = nil
local damageWithoutLossCount = 0
local lastHealth, lastArmor = nil, nil
local invincibleUntil = 0
local hitsSinceReset = 0

-- Legitimate scripts (spawn protection, missions, vehicle invincibility,
-- admin god mode) call this before/while granting real invincibility so
-- godmode.lua doesn't flag it.
function AC.AllowInvincibility(durationMs)
    invincibleUntil = GetGameTimer() + (durationMs or 3000)
end
exports('AllowInvincibility', AC.AllowInvincibility)

local function isInvincibilityContextExempt()
    if GetGameTimer() < invincibleUntil then return true end
    if AC.IsStateChangeSuppressed() then return true end
    return false
end

-- CEventNetworkEntityDamage argument layout (victim, attacker, ..., victimDied
-- at index 4, weaponUsed at index 7, isMeleeDamage at index 8) follows the
-- community-standard mapping used across most FiveM frameworks; verify
-- against your game build if you fork this for a heavily modified server.
AddEventHandler('gameEventTriggered', function(name, args)
    if name ~= 'CEventNetworkEntityDamage' then return end
    local victim = args[1]
    local ped = PlayerPedId()
    if victim ~= ped then return end

    local victimDied = args[4] == 1
    local weaponUsed = args[7]

    if isInvincibilityContextExempt() or victimDied then
        hitsSinceReset = 0
        return
    end

    if not weaponUsed or weaponUsed == 0 then return end

    Citizen.SetTimeout(50, function()
        local health = GetEntityHealth(ped)
        if lastHealth and health >= lastHealth then
            hitsSinceReset = hitsSinceReset + 1
            if hitsSinceReset >= 3 and AC.IsProtectionEnabled('godmode') then
                AC.Report('DAMAGE_IMMUNITY', { hitsWithoutLoss = hitsSinceReset, weaponUsed = weaponUsed })
            end
        else
            hitsSinceReset = 0
        end
        lastHealth = health
    end)
end)

AC.RegisterCheck('godmode', {
    category = 'player',
    baseInterval = 1500,
    minInterval = 800,
    maxInterval = 5000,
    tick = function()
        local ped = PlayerPedId()
        if IsEntityDead(ped) then return end

        local maxHealth = GetEntityMaxHealth(ped)
        baselineMaxHealth = baselineMaxHealth or math.max(maxHealth, DEFAULT_MAX_HEALTH)

        if not isInvincibilityContextExempt() then
            if maxHealth > baselineMaxHealth + 50 then
                AC.Report('HEALTH_MANIPULATION', { maxHealth = maxHealth, baseline = baselineMaxHealth })
            end

            local health = GetEntityHealth(ped)
            local armor = GetPedArmour(ped)

            if lastHealth and health > lastHealth + 20 and not IsPedGettingUp(ped) then
                -- Health regenerated far faster than any vanilla/framework
                -- regen curve without a matching heal event.
                AC.Report('HEALTH_MANIPULATION', { from = lastHealth, to = health })
            end

            if armor >= 100 and lastArmor and lastArmor >= 100 then
                -- Sustained max armor alone is common (bought armor); only
                -- meaningful combined with damage-immunity hits, tracked above.
            end

            lastHealth, lastArmor = health, armor
        end
    end,
})

-- ---------------------------------------------------------------------------
-- Lightweight resource/state integrity: scans for known-bad resource name
-- patterns and verifies our own core functions haven't been clobbered by
-- another script running in the same Lua state (Citizen scripts share a
-- runtime per resource, so this mainly guards against accidental collisions
-- and obviously malicious re-registration attempts, not memory-level cheats).
-- ---------------------------------------------------------------------------
local originalReportFn = AC.Report
local blacklistPatterns = { 'menu', 'cheat', 'injector', 'bypass' }

local function scanResources()
    local count = GetNumResources()
    for i = 0, count - 1 do
        local name = GetResourceByFindIndex(i)
        if name then
            local lower = name:lower()
            for _, pattern in ipairs(blacklistPatterns) do
                if lower:find(pattern, 1, true) and GetResourceState(name) == 'started' then
                    AC.Report('UNEXPECTED_RESOURCE_STATE', { resource = name })
                    break
                end
            end
        end
    end
end

AC.RegisterCheck('integrity', {
    category = 'integrity',
    baseInterval = 15000,
    minInterval = 10000,
    maxInterval = 60000,
    tick = function()
        if AC.Report ~= originalReportFn then
            -- Something replaced our reporting function - can't self-report
            -- through it, so fall back to a raw server event directly.
            TriggerServerEvent('anticheat:report', 'DETECTION_TAMPERING', {}, GetGameTimer())
            return
        end
        scanResources()
        TriggerServerEvent('anticheat:heartbeat', GetGameTimer())
    end,
})
