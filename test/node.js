require('web-midi-api-shim')

const qbmidi = require('../build/qbmidi.js')
qbmidi.init()
qbmidi.enableLogs(true)
