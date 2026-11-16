'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'client', 'src')
const ALLOW = path.join(ROOT, 'lib', 'api.js')
const ALLOWLIST = [
  {
    "file": "hooks/useApi.js",
    "line": 10,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "hooks/useApi.js",
    "line": 697,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "lib/catalog-runtime.js",
    "line": 34,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "lib/tm1-completion.js",
    "line": 169,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/CatalogAdmin.jsx",
    "line": 232,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/CatalogAdmin.jsx",
    "line": 322,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/CatalogAdmin.jsx",
    "line": 349,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/GitSetup.jsx",
    "line": 28,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/GitSetup.jsx",
    "line": 36,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/GitSetup.jsx",
    "line": 47,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/GitSetup.jsx",
    "line": 58,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/FileManager.jsx",
    "line": 34,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/ChangeLogPanel.jsx",
    "line": 149,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/ChangeLogPanel.jsx",
    "line": 157,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/CubeDataSources.jsx",
    "line": 25,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/RuleLensPanel.jsx",
    "line": 17,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/ProcessEditor.jsx",
    "line": 119,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/ProcessEditor.jsx",
    "line": 277,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/PicklistBuilder.jsx",
    "line": 8,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/GitDrift.jsx",
    "line": 24,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/GitDrift.jsx",
    "line": 34,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/Explorer.jsx",
    "line": 485,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/Explorer.jsx",
    "line": 501,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/DeployWizard.jsx",
    "line": 88,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/DeployWizard.jsx",
    "line": 99,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/DeployWizard.jsx",
    "line": 109,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/DeployWizard.jsx",
    "line": 134,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/DeployWizard.jsx",
    "line": 177,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/SaveDataButton.jsx",
    "line": 33,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/RunbookDialog.jsx",
    "line": 110,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/DeployHistory.jsx",
    "line": 155,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/DeployHistory.jsx",
    "line": 295,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/ServerLoginDialog.jsx",
    "line": 47,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/CubeMapEditor.jsx",
    "line": 878,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/CubeMapEditor.jsx",
    "line": 906,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/AssertionsManager.jsx",
    "line": 26,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/AssertionsManager.jsx",
    "line": 34,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/AssertionsManager.jsx",
    "line": 58,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/AssertionsManager.jsx",
    "line": 70,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/AssertionsManager.jsx",
    "line": 80,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/AssertionsManager.jsx",
    "line": 91,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/ModelHealth.jsx",
    "line": 62,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/ModelHealth.jsx",
    "line": 75,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/LoginPage.jsx",
    "line": 26,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/LoginPage.jsx",
    "line": 29,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/LoginPage.jsx",
    "line": 57,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "store/index.js",
    "line": 111,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "store/index.js",
    "line": 158,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/mdx/ResultGrid.jsx",
    "line": 88,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  },
  {
    "file": "components/PeriodBuilder/index.jsx",
    "line": 76,
    "kind": "pending",
    "reason": "round 2b conversion pending"
  }
]

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? files(p) : (/\.(js|jsx)$/.test(e.name) ? [p] : [])
  })
}

test('the client calls the server through lib/api or hooks, never raw fetch', () => {
  const bad = []
  for (const file of files(ROOT)) {
    if (file === ALLOW) continue
    const rel = path.relative(ROOT, file)
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*/, '')
      if (/(^|[^\w.$])fetch\(/.test(code)) bad.push(`${rel}:${i + 1} raw fetch`)
      if (/apiFetch\(/.test(code)) {
        const ok = ALLOWLIST.some(a => a.file === rel && a.line === i + 1)
        if (!ok) bad.push(`${rel}:${i + 1} apiFetch outside allowlist`)
      }
    })
  }
  assert.deepEqual(bad, [])
})
