fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'anticheat'
author 'HiIchBinFlo'
description 'Multi-layer, performance-first FiveM anti-cheat framework'
version '1.0.0'

shared_scripts {
    'shared/utilities.lua',
    'shared/detection_types.lua',
    'shared/config.lua',
}

client_scripts {
    'client/main.lua',
    'client/integrity.lua',
    'client/movement.lua',
    'client/combat.lua',
    'client/weapons.lua',
    'client/vehicles.lua',
    'client/entities.lua',
}

server_scripts {
    'server/player_state.lua',
    'server/validation.lua',
    'server/logging.lua',
    'server/punishment.lua',
    'server/detection.lua',
    'server/main.lua',
}

ui_page 'ui/settings-panel/index.html'

files {
    'ui/settings-panel/index.html',
    'ui/settings-panel/style.css',
    'ui/settings-panel/app.js',
}

exports {
    'IsProtectionEnabled',
    'AllowTeleport',
    'AllowStateChange',
    'AllowInvincibility',
}

server_exports {
    'GetPlayerScore',
    'AddSuspicion',
    'IsWhitelisted',
    'SetPlayerWhitelisted',
    'AllowTeleport',
    'AllowInvincibility',
    'AllowWeapon',
    'ValidateEvent',
    'RegisterEventValidator',
}
