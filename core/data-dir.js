'use strict'

// ── Where runtime state lives ───────────────────────────────────────────────
// data/ holds governance records (change sets, approvals, deploy state, deploy
// reports, settings, secrets). Tests used to write into the REAL directory: the
// deploy-records file accumulated a `TG1` bucket and dozens of fake "refused
// (INCOMING1/OTHER99)" entries, and the change-set database filled with test
// sessions. A test that writes into the thing it is meant to check is not a test
// of anything.
//
// One rule for every module that stores state:
//   TM1_IDE_DATA_DIR   explicit override (a deployment, a test harness)
//   under the runner   node --test sets NODE_TEST_CONTEXT in every test process,
//                      so each test FILE gets its own throwaway directory
//   otherwise          <repo>/data

const fs = require('fs')
const os = require('os')
const path = require('path')

function resolveDataDir() {
    const override = process.env.TM1_IDE_DATA_DIR
    if (override) return path.resolve(override)
    if (process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test') {
        return fs.mkdtempSync(path.join(os.tmpdir(), 'tm1ide-testdata-'))
    }
    return path.join(__dirname, '..', 'data')
}

const DATA_DIR = resolveDataDir()
fs.mkdirSync(DATA_DIR, { recursive: true })

module.exports = { DATA_DIR }
