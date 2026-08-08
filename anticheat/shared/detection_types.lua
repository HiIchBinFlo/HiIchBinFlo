--[[
    shared/detection_types.lua
    Canonical detection identifiers, their category, and base suspicion
    weights. Nothing here punishes anything by itself — server/detection.lua
    combines these into a confidence score before any action is taken.
]]

DetectionTypes = {
    -- category, baseScore (added to the player's rolling suspicion score
    -- when server validation agrees the signal is real)
    NOCLIP                  = { category = 'movement',   score = 35 },
    FLY                     = { category = 'movement',   score = 35 },
    FREECAM                 = { category = 'movement',   score = 20 },
    TELEPORT                = { category = 'movement',   score = 30 },
    SPEEDHACK                = { category = 'movement',   score = 25 },
    ABNORMAL_ACCELERATION    = { category = 'movement',   score = 15 },
    IMPOSSIBLE_DISTANCE       = { category = 'movement',   score = 25 },
    AIR_MOVEMENT             = { category = 'movement',   score = 20 },
    SUPER_JUMP                = { category = 'movement',   score = 20 },
    INFINITE_STAMINA          = { category = 'movement',   score = 10 },
    GRAVITY_MANIPULATION       = { category = 'movement',   score = 25 },
    ABNORMAL_FALL_SPEED         = { category = 'movement',   score = 15 },
    INVALID_STATE_CHANGE        = { category = 'movement',   score = 10 },

    GODMODE                 = { category = 'player',     score = 30 },
    INFINITE_HEALTH           = { category = 'player',     score = 30 },
    INFINITE_ARMOR             = { category = 'player',     score = 20 },
    HEALTH_MANIPULATION        = { category = 'player',     score = 25 },
    ARMOR_MANIPULATION          = { category = 'player',     score = 15 },
    DAMAGE_IMMUNITY             = { category = 'player',     score = 30 },
    ABNORMAL_DAMAGE_PATTERN      = { category = 'player',     score = 10 },

    AIMBOT_SUSPICION            = { category = 'combat',     score = 5 }, -- accumulated, see combat scoring
    SNAP_AIM                    = { category = 'combat',     score = 4 },
    PERFECT_TRACKING             = { category = 'combat',     score = 4 },
    INHUMAN_REACTION             = { category = 'combat',     score = 4 },
    SUSPICIOUS_HEADSHOT_RATE       = { category = 'combat',     score = 6 },

    UNAUTHORIZED_WEAPON          = { category = 'weapons',    score = 40 },
    UNAUTHORIZED_WEAPON_GIVE       = { category = 'weapons',    score = 40 },
    AMMO_MANIPULATION            = { category = 'weapons',    score = 25 },
    INFINITE_AMMO                = { category = 'weapons',    score = 20 },
    RAPID_FIRE                  = { category = 'weapons',    score = 20 },
    FIRE_RATE_MANIPULATION        = { category = 'weapons',    score = 20 },
    DAMAGE_MANIPULATION           = { category = 'weapons',    score = 25 },
    RANGE_MANIPULATION            = { category = 'weapons',    score = 15 },
    EXPLOSIVE_AMMO                = { category = 'weapons',    score = 30 },

    UNAUTHORIZED_VEHICLE          = { category = 'vehicles',   score = 25 },
    VEHICLE_GODMODE               = { category = 'vehicles',   score = 30 },
    VEHICLE_HEALTH_MANIPULATION     = { category = 'vehicles',   score = 25 },
    VEHICLE_SPEED_MANIPULATION      = { category = 'vehicles',   score = 25 },
    FLY_VEHICLE                  = { category = 'vehicles',   score = 30 },
    VEHICLE_THROW                = { category = 'vehicles',   score = 35 },
    VEHICLE_TELEPORT              = { category = 'vehicles',   score = 25 },
    MASS_VEHICLE_SPAWN              = { category = 'vehicles',   score = 20 },
    UNAUTHORIZED_MODIFICATION       = { category = 'vehicles',   score = 15 },

    ENTITY_SPAM                  = { category = 'entities',   score = 20 },
    OBJECT_SPAM                  = { category = 'entities',   score = 20 },
    PED_SPAM                     = { category = 'entities',   score = 20 },
    VEHICLE_SPAM                 = { category = 'entities',   score = 20 },
    PICKUP_SPAM                  = { category = 'entities',   score = 20 },
    NETWORK_ENTITY_ABUSE            = { category = 'entities',   score = 25 },

    EXPLOSION_SPAM                = { category = 'explosions', score = 25 },
    UNAUTHORIZED_EXPLOSION_TYPE      = { category = 'explosions', score = 20 },
    EXPLOSION_DAMAGE_ABUSE           = { category = 'explosions', score = 20 },

    EVENT_ABUSE                  = { category = 'events',     score = 30 },
    EVENT_RATE_LIMIT               = { category = 'events',     score = 15 },
    EVENT_INVALID_PAYLOAD           = { category = 'events',     score = 20 },

    INTEGRITY_MISMATCH             = { category = 'integrity',  score = 15 },
    UNEXPECTED_RESOURCE_STATE        = { category = 'integrity',  score = 15 },
    DETECTION_TAMPERING             = { category = 'integrity',  score = 40 },
}

-- Confidence bands (0-100) used to describe an aim/combat suspicion score
-- to admins in logs/UI. Purely descriptive, thresholds for actions are
-- configured separately in Config.Advanced.
DetectionTypes.ConfidenceBands = {
    { max = 30,  label = 'normal' },
    { max = 60,  label = 'watch' },
    { max = 80,  label = 'suspicious' },
    { max = 95,  label = 'highly_suspicious' },
    { max = 100, label = 'high_certainty' },
}

-- Maps each detection type to the Config.Protections key that governs its
-- enabled state, action, cooldown and sensitivity.
DetectionTypes.ProtectionKey = {
    NOCLIP = 'noclip',
    FLY = 'fly',
    FREECAM = 'freecam',
    TELEPORT = 'teleport',
    SPEEDHACK = 'speedhack',
    ABNORMAL_ACCELERATION = 'speedhack',
    IMPOSSIBLE_DISTANCE = 'speedhack',
    AIR_MOVEMENT = 'fly',
    SUPER_JUMP = 'superJump',
    INFINITE_STAMINA = 'infiniteStamina',
    GRAVITY_MANIPULATION = 'gravity',
    ABNORMAL_FALL_SPEED = 'gravity',
    INVALID_STATE_CHANGE = 'noclip',

    GODMODE = 'godmode',
    INFINITE_HEALTH = 'godmode',
    INFINITE_ARMOR = 'godmode',
    HEALTH_MANIPULATION = 'godmode',
    ARMOR_MANIPULATION = 'godmode',
    DAMAGE_IMMUNITY = 'godmode',
    ABNORMAL_DAMAGE_PATTERN = 'godmode',

    AIMBOT_SUSPICION = 'aimbot',
    SNAP_AIM = 'aimbot',
    PERFECT_TRACKING = 'aimbot',
    INHUMAN_REACTION = 'aimbot',
    SUSPICIOUS_HEADSHOT_RATE = 'aimbot',

    UNAUTHORIZED_WEAPON = 'weapon',
    UNAUTHORIZED_WEAPON_GIVE = 'weapon',
    AMMO_MANIPULATION = 'weapon',
    INFINITE_AMMO = 'weapon',
    RAPID_FIRE = 'weapon',
    FIRE_RATE_MANIPULATION = 'weapon',
    DAMAGE_MANIPULATION = 'weapon',
    RANGE_MANIPULATION = 'weapon',
    EXPLOSIVE_AMMO = 'weapon',

    UNAUTHORIZED_VEHICLE = 'vehicleSpawn',
    VEHICLE_GODMODE = 'vehicleGodmode',
    VEHICLE_HEALTH_MANIPULATION = 'vehicleGodmode',
    VEHICLE_SPEED_MANIPULATION = 'vehicleSpeed',
    FLY_VEHICLE = 'vehicleGodmode',
    VEHICLE_THROW = 'vehicleThrow',
    VEHICLE_TELEPORT = 'vehicleGodmode',
    MASS_VEHICLE_SPAWN = 'vehicleSpawn',
    UNAUTHORIZED_MODIFICATION = 'vehicleSpawn',

    ENTITY_SPAM = 'entitySpam',
    OBJECT_SPAM = 'entitySpam',
    PED_SPAM = 'entitySpam',
    VEHICLE_SPAM = 'entitySpam',
    PICKUP_SPAM = 'entitySpam',
    NETWORK_ENTITY_ABUSE = 'entitySpam',

    EXPLOSION_SPAM = 'explosionSpam',
    UNAUTHORIZED_EXPLOSION_TYPE = 'explosionSpam',
    EXPLOSION_DAMAGE_ABUSE = 'explosionSpam',

    EVENT_ABUSE = 'eventValidation',
    EVENT_RATE_LIMIT = 'eventValidation',
    EVENT_INVALID_PAYLOAD = 'eventValidation',

    INTEGRITY_MISMATCH = 'integrity',
    UNEXPECTED_RESOURCE_STATE = 'integrity',
    DETECTION_TAMPERING = 'integrity',
}

function DetectionTypes.GetConfidenceLabel(score)
    for _, band in ipairs(DetectionTypes.ConfidenceBands) do
        if score <= band.max then return band.label end
    end
    return 'high_certainty'
end

return DetectionTypes
