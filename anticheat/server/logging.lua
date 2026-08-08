--[[
    server/logging.lua
    Structured, de-duplicated logging. Console output always matches the
    same block format; file + webhook are optional and never spam - both
    are gated by cooldowns and a minimum confidence for the webhook.
]]

AC = AC or {}
AC.Logging = {}

local logCooldowns = Utils.NewCooldownTracker()
local fileBuffer = {}
local FLUSH_INTERVAL_MS = 10000

local function formatBlock(entry)
    local lines = {
        '[ANTICHEAT]',
        ('Player: %s'):format(entry.name or 'unknown'),
        ('ID: %s'):format(tostring(entry.source)),
        ('Detection: %s'):format(entry.detectionType),
    }

    if entry.confidence then
        table.insert(lines, ('Confidence: %s'):format(tostring(entry.confidence)))
    end
    if entry.evidence then
        for k, v in pairs(entry.evidence) do
            if type(v) == 'table' then
                table.insert(lines, ('%s: x=%.2f y=%.2f z=%.2f'):format(k, v.x or 0, v.y or 0, v.z or 0))
            else
                table.insert(lines, ('%s: %s'):format(k, tostring(v)))
            end
        end
    end
    table.insert(lines, ('Server Validation: %s'):format(entry.validated and 'PASSED' or 'FAILED'))
    table.insert(lines, ('Suspicion Score: %s'):format(tostring(entry.score or 0)))
    table.insert(lines, ('Action: %s'):format((entry.action or 'log'):upper()))

    return table.concat(lines, '\n')
end

local function sendWebhook(entry)
    local url = Config.Advanced.logging.webhook
    if not url or url == '' then return end
    if (entry.confidence or 0) * 100 < (Config.Advanced.logging.webhookMinConfidence or 60) then return end

    local color = 15158332 -- red
    if entry.action == 'log' or entry.action == 'warn' then color = 15844367 end -- yellow

    local payload = {
        embeds = {
            {
                title = 'Anti-Cheat Detection',
                color = color,
                fields = {
                    { name = 'Player', value = ('%s (ID %s)'):format(entry.name or 'unknown', tostring(entry.source)), inline = true },
                    { name = 'Detection', value = entry.detectionType, inline = true },
                    { name = 'Action', value = (entry.action or 'log'):upper(), inline = true },
                    { name = 'Confidence', value = tostring(Utils.Round((entry.confidence or 0) * 100, 1)) .. '%', inline = true },
                    { name = 'Score', value = tostring(entry.score or 0), inline = true },
                },
                timestamp = os.date('!%Y-%m-%dT%H:%M:%SZ'),
            },
        },
    }

    PerformHttpRequest(url, function() end, 'POST', json.encode(payload), { ['Content-Type'] = 'application/json' })
end

function AC.Logging.Write(entry)
    local dedupeKey = tostring(entry.source) .. ':' .. entry.detectionType
    local cooldownMs = Config.Advanced.detectionCooldownMs or 3000
    if not logCooldowns:ready(dedupeKey, cooldownMs) then return end

    local block = formatBlock(entry)

    if Config.Advanced.logging.console then
        print('^3' .. block .. '^0')
    end

    if Config.Advanced.logging.file then
        table.insert(fileBuffer, block)
    end

    sendWebhook(entry)
end

Citizen.CreateThread(function()
    while true do
        Wait(FLUSH_INTERVAL_MS)
        if #fileBuffer > 0 then
            local chunk = table.concat(fileBuffer, '\n\n') .. '\n\n'
            fileBuffer = {}
            local existing = LoadResourceFile(GetCurrentResourceName(), 'anticheat.log') or ''
            -- Cap the persisted log at ~2MB to avoid unbounded disk growth.
            if #existing > 2 * 1024 * 1024 then
                existing = existing:sub(-1024 * 1024)
            end
            SaveResourceFile(GetCurrentResourceName(), 'anticheat.log', existing .. chunk, -1)
        end
    end
end)
