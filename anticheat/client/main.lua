--[[
    client/main.lua
    Core scheduler, profiler and NUI bridge. This is the ONLY persistent
    thread the anti-cheat runs for interval-based checks - every protection
    module registers a tick function here instead of running its own
    Citizen.CreateThread loop. Event-driven modules attach their own
    AddEventHandler/RegisterNetEvent calls (cheap, no polling) separately.
]]

AC = AC or {}
AC.Modules = {}
AC.Perf = { entries = {}, frameLoad = 0.0 }
AC.State = {
    panelOpen = false,
    authorized = false, -- allowed to open the settings panel
    ped = PlayerPedId(),
    playerId = PlayerId(),
    suppressedTeleport = 0, -- GetGameTimer() deadline until which teleports are ignored
    suppressedStateUntil = 0,
}

local playerId = PlayerId()

-- ---------------------------------------------------------------------------
-- Local effective config (defaults from shared/config.lua, overwritten by
-- the server-authoritative copy on join / on admin change)
-- ---------------------------------------------------------------------------
AC.Config = Utils.DeepCopy(Config)

RegisterNetEvent('anticheat:syncConfig', function(serverConfig)
    Utils.MergeDefaults(serverConfig, Config)
    AC.Config = serverConfig
end)

RegisterNetEvent('anticheat:authorized', function(isAuthorized)
    AC.State.authorized = isAuthorized
end)

function AC.IsProtectionEnabled(name)
    local p = AC.Config.Protections[name]
    return p ~= nil and p.enabled == true
end
exports('IsProtectionEnabled', AC.IsProtectionEnabled)

-- Legitimate scripts (spawn systems, garages, admin teleports, ...) call
-- this immediately before moving a player so movement.lua doesn't flag it.
function AC.AllowTeleport(durationMs)
    AC.State.suppressedTeleport = GetGameTimer() + (durationMs or 2000)
end
exports('AllowTeleport', AC.AllowTeleport)

function AC.AllowStateChange(durationMs)
    AC.State.suppressedStateUntil = GetGameTimer() + (durationMs or 2000)
end
exports('AllowStateChange', AC.AllowStateChange)

function AC.IsTeleportSuppressed()
    return GetGameTimer() < AC.State.suppressedTeleport
end

function AC.IsStateChangeSuppressed()
    return GetGameTimer() < AC.State.suppressedStateUntil
end

-- ---------------------------------------------------------------------------
-- Profiler
-- ---------------------------------------------------------------------------
local function getPerfEntry(name)
    local e = AC.Perf.entries[name]
    if not e then
        e = { ring = Utils.NewRingBuffer(30), last = 0.0, peak = 0.0, category = 'unknown' }
        AC.Perf.entries[name] = e
    end
    return e
end

function AC.Perf.Record(name, ms)
    local e = getPerfEntry(name)
    e.ring:push(ms)
    e.last = ms
    if ms > e.peak then e.peak = ms end
end

function AC.Perf.GetAverage(name)
    local e = AC.Perf.entries[name]
    if not e or e.ring.count == 0 then return 0.0 end
    local sum = 0.0
    for v in e.ring:each() do sum = sum + v end
    return sum / e.ring.count
end

-- Coarse, cheap load estimate derived from the last rendered frame time.
-- Sampled at most once per scheduler pass (never a per-frame thread).
function AC.Perf.GetLoadFactor()
    local frameMs = GetFrameTime() * 1000.0
    local threshold = AC.Config.Performance.autoLowEndThresholdMs or 8.0
    local load = Utils.Clamp(frameMs / threshold, 0.0, 1.0)
    AC.Perf.frameLoad = load
    return load
end

function AC.Perf.Snapshot()
    local out = {}
    for name, e in pairs(AC.Perf.entries) do
        out[name] = {
            avgMs = Utils.Round(AC.Perf.GetAverage(name), 3),
            lastMs = Utils.Round(e.last, 3),
            peakMs = Utils.Round(e.peak, 3),
            category = e.category,
        }
    end
    return out
end

-- ---------------------------------------------------------------------------
-- Module registry
-- name: matches a Config.Protections key, and is what the profiler keys on
-- opts: { category, tick = function() end, baseInterval, minInterval,
--         maxInterval, eventOnly, protections }
--
-- `protections`: some ticks share one cheap position/state sample across
-- several related detections (e.g. noclip/teleport/speedhack all read the
-- same ped coords once) instead of re-fetching it per protection. Pass the
-- full list of protection keys such a tick can report so the scheduler only
-- skips it when ALL of them are disabled - otherwise turning off `noclip`
-- alone would silently stop `teleport`/`speedhack` too. Defaults to
-- `{ name }` for one-protection-per-tick modules.
-- ---------------------------------------------------------------------------
function AC.RegisterCheck(name, opts)
    getPerfEntry(name).category = opts.category or 'unknown'
    AC.Modules[name] = {
        category = opts.category,
        tick = opts.tick,
        interval = opts.baseInterval or (AC.Config.Advanced.scanIntervalMs or 500),
        minInterval = opts.minInterval or 250,
        maxInterval = opts.maxInterval or 4000,
        nextRun = 0,
        eventOnly = opts.eventOnly or false,
        protections = opts.protections or { name },
    }
end

local function isModuleActive(mod)
    for i = 1, #mod.protections do
        if AC.IsProtectionEnabled(mod.protections[i]) then return true end
    end
    return false
end

-- ---------------------------------------------------------------------------
-- Report a detection to the server for validation + scoring. Client never
-- decides punishment - it only ever reports evidence.
-- ---------------------------------------------------------------------------
local reportCooldowns = Utils.NewCooldownTracker()
AC.Network = { events = 0, bytes = 0, windowStart = GetGameTimer() }

function AC.Report(detectionType, evidence)
    local cd = (AC.Config.Advanced.detectionCooldownMs or 3000)
    if not reportCooldowns:ready(detectionType, cd) then return end

    TriggerServerEvent('anticheat:report', detectionType, evidence or {}, GetGameTimer())

    AC.Network.events = AC.Network.events + 1
    local ok, encoded = pcall(json.encode, evidence or {})
    AC.Network.bytes = AC.Network.bytes + (ok and #encoded or 32) + 24 -- rough event-name/overhead estimate
end

function AC.Perf.GetNetworkStats()
    local now = GetGameTimer()
    local elapsedSec = math.max((now - AC.Network.windowStart) / 1000.0, 1)
    return {
        eventsPerMin = Utils.Round(AC.Network.events / elapsedSec * 60, 1),
        bytesPerMin = Utils.Round(AC.Network.bytes / elapsedSec * 60, 0),
    }
end

-- ---------------------------------------------------------------------------
-- Scheduler: single thread, adaptive sleep. Never Wait(0).
-- ---------------------------------------------------------------------------
Citizen.CreateThread(function()
    while true do
        local now = GetGameTimer()
        local soonest = now + 1000
        local budget = AC.Config.Performance.maxBudgetMsPerTick or 0.6
        local spent = 0.0
        local load = AC.Perf.GetLoadFactor()
        local lowEnd = AC.Config.Performance.lowEndMode or (load > 0.9)

        for name, mod in pairs(AC.Modules) do
            if not mod.eventOnly and isModuleActive(mod) then
                if now >= mod.nextRun then
                    if spent < budget then
                        local t0 = GetGameTimer()
                        local ok = pcall(mod.tick)
                        local elapsed = GetGameTimer() - t0
                        spent = spent + elapsed
                        AC.Perf.Record(name, elapsed)
                    end

                    local effectiveMax = lowEnd and (mod.maxInterval * 2) or mod.maxInterval
                    mod.interval = Utils.AdaptiveInterval(mod.interval, mod.minInterval, effectiveMax, load)
                    mod.nextRun = GetGameTimer() + mod.interval
                end
                if mod.nextRun < soonest then soonest = mod.nextRun end
            end
        end

        local sleep = soonest - GetGameTimer()
        sleep = Utils.Clamp(sleep, 25, 1000)
        Wait(sleep)
    end
end)

-- ---------------------------------------------------------------------------
-- NUI bridge
-- ---------------------------------------------------------------------------
local function openPanel()
    if not AC.State.authorized then return end
    AC.State.panelOpen = true
    SetNuiFocus(true, true)
    SendNUIMessage({ type = 'open', config = AC.Config, perf = AC.Perf.Snapshot() })
end

local function closePanel()
    AC.State.panelOpen = false
    SetNuiFocus(false, false)
    SendNUIMessage({ type = 'close' })
end

RegisterCommand('anticheat', function()
    if AC.State.panelOpen then closePanel() else openPanel() end
end, false)

RegisterKeyMapping('anticheat', 'Open Anti-Cheat Settings Panel', 'keyboard', 'F9')

RegisterNUICallback('close', function(_, cb)
    closePanel()
    cb('ok')
end)

RegisterNUICallback('getPerf', function(_, cb)
    cb(AC.Perf.Snapshot())
end)

RegisterNUICallback('updateConfig', function(data, cb)
    -- Never trust/apply locally - forward to the server, which is
    -- authoritative and will broadcast the validated config back.
    TriggerServerEvent('anticheat:updateConfig', data)
    cb('ok')
end)

-- Periodic (low-frequency) push of fresh perf stats while the panel is open.
Citizen.CreateThread(function()
    while true do
        if AC.State.panelOpen then
            SendNUIMessage({ type = 'perf', perf = AC.Perf.Snapshot(), network = AC.Perf.GetNetworkStats() })
            Wait(2000)
        else
            Wait(1000)
        end

        -- Roll the network-usage window every 60s so the rate reflects
        -- recent activity instead of an all-time average.
        if GetGameTimer() - AC.Network.windowStart > 60000 then
            AC.Network = { events = 0, bytes = 0, windowStart = GetGameTimer() }
        end
    end
end)

AddEventHandler('onResourceStop', function(resource)
    if resource == GetCurrentResourceName() and AC.State.panelOpen then
        SetNuiFocus(false, false)
    end
end)

RegisterNetEvent('anticheat:freeze', function(durationMs)
    local ped = PlayerPedId()
    FreezeEntityPosition(ped, true)
    Citizen.SetTimeout(durationMs or 10000, function()
        if DoesEntityExist(ped) then
            FreezeEntityPosition(ped, false)
        end
    end)
end)

TriggerServerEvent('anticheat:playerReady')
