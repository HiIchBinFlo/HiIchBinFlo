--[[
    shared/utilities.lua
    Small, dependency-free helpers used by both sides. Nothing here allocates
    per-frame tables; ring buffers pre-allocate their slots once.
]]

Utils = {}

-- ---------------------------------------------------------------------------
-- Math
-- ---------------------------------------------------------------------------

function Utils.Distance(a, b)
    local dx, dy, dz = a.x - b.x, a.y - b.y, a.z - b.z
    return math.sqrt(dx * dx + dy * dy + dz * dz)
end

function Utils.Distance2D(a, b)
    local dx, dy = a.x - b.x, a.y - b.y
    return math.sqrt(dx * dx + dy * dy)
end

function Utils.Clamp(value, min, max)
    if value < min then return min end
    if value > max then return max end
    return value
end

function Utils.Lerp(a, b, t)
    return a + (b - a) * t
end

function Utils.Round(value, decimals)
    local mult = 10 ^ (decimals or 0)
    return math.floor(value * mult + 0.5) / mult
end

-- ---------------------------------------------------------------------------
-- Table helpers
-- ---------------------------------------------------------------------------

function Utils.ShallowCopy(t)
    local out = {}
    for k, v in pairs(t) do out[k] = v end
    return out
end

function Utils.DeepCopy(t)
    if type(t) ~= 'table' then return t end
    local out = {}
    for k, v in pairs(t) do out[k] = Utils.DeepCopy(v) end
    return out
end

function Utils.MergeDefaults(target, defaults)
    for k, v in pairs(defaults) do
        if target[k] == nil then
            target[k] = type(v) == 'table' and Utils.DeepCopy(v) or v
        elseif type(v) == 'table' and type(target[k]) == 'table' then
            Utils.MergeDefaults(target[k], v)
        end
    end
    return target
end

function Utils.Contains(list, value)
    for i = 1, #list do
        if list[i] == value then return true end
    end
    return false
end

-- ---------------------------------------------------------------------------
-- RingBuffer: fixed-size history buffer, no per-push allocation once warm.
-- Used for movement/health/aim history so we never keep unbounded tables.
-- ---------------------------------------------------------------------------

local RingBuffer = {}
RingBuffer.__index = RingBuffer

function Utils.NewRingBuffer(size)
    return setmetatable({ size = size, items = {}, head = 0, count = 0 }, RingBuffer)
end

function RingBuffer:push(value)
    self.head = (self.head % self.size) + 1
    self.items[self.head] = value
    if self.count < self.size then self.count = self.count + 1 end
end

function RingBuffer:latest()
    if self.count == 0 then return nil end
    return self.items[self.head]
end

-- n = 1 is latest, n = 2 is one before that, etc.
function RingBuffer:get(n)
    if n > self.count then return nil end
    local idx = self.head - (n - 1)
    if idx < 1 then idx = idx + self.size end
    return self.items[idx]
end

function RingBuffer:each()
    local i = 0
    return function()
        i = i + 1
        if i > self.count then return nil end
        return self:get(i)
    end
end

function RingBuffer:clear()
    self.items = {}
    self.head = 0
    self.count = 0
end

Utils.RingBuffer = RingBuffer

-- ---------------------------------------------------------------------------
-- RateLimiter: token-bucket style limiter for per-player / per-event limits.
-- ---------------------------------------------------------------------------

local RateLimiter = {}
RateLimiter.__index = RateLimiter

-- capacity: max burst, refillPerSec: tokens regained per second
function Utils.NewRateLimiter(capacity, refillPerSec)
    return setmetatable({
        capacity = capacity,
        refill = refillPerSec,
        tokens = capacity,
        last = GetGameTimer(),
    }, RateLimiter)
end

function RateLimiter:consume(cost)
    cost = cost or 1
    local now = GetGameTimer()
    local elapsed = (now - self.last) / 1000.0
    self.last = now
    self.tokens = math.min(self.capacity, self.tokens + elapsed * self.refill)
    if self.tokens >= cost then
        self.tokens = self.tokens - cost
        return true
    end
    return false
end

Utils.RateLimiter = RateLimiter

-- ---------------------------------------------------------------------------
-- Cooldown: simple "has enough time passed" helper keyed by string.
-- ---------------------------------------------------------------------------

local Cooldown = {}
Cooldown.__index = Cooldown

function Utils.NewCooldownTracker()
    return setmetatable({ times = {} }, Cooldown)
end

function Cooldown:ready(key, ms)
    local now = GetGameTimer()
    local last = self.times[key]
    if not last or (now - last) >= ms then
        self.times[key] = now
        return true
    end
    return false
end

Utils.Cooldown = Cooldown

-- ---------------------------------------------------------------------------
-- ScoreDecay: exponential-ish linear decay helper for suspicion scores.
-- ---------------------------------------------------------------------------

function Utils.DecayScore(score, decayPerSecond, elapsedMs)
    if score <= 0 then return 0 end
    local decayed = score - (decayPerSecond * (elapsedMs / 1000.0))
    return decayed > 0 and decayed or 0
end

-- ---------------------------------------------------------------------------
-- Adaptive interval helper: grows/shrinks a scan interval between min/max
-- based on a "load" signal (0..1) without allocating anything.
-- ---------------------------------------------------------------------------

function Utils.AdaptiveInterval(current, min, max, load)
    -- load close to 1 => system busy => back off toward max
    -- load close to 0 => system idle => tighten toward min
    local target = Utils.Lerp(min, max, load)
    return math.floor(Utils.Lerp(current, target, 0.25))
end

return Utils
