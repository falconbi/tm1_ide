'use strict'

// Thin re-export — deploy tool uses the same TM1Client and PAW auth
// as the IDE server. Auth is driven by the same env vars:
//   PAW_HOST, PAW_USERNAME, PAW_PASSWORD
const { TM1Client } = require('../../../core/tm1_client')

module.exports = { TM1Client }
