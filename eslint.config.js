'use strict'

const js = require('@eslint/js')
const globals = require('globals')

const unused = ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]

module.exports = [
  {
    ignores: [
      'client/**',
      'node_modules/**',
      'static/**',
      'packages/**',
      'Bedrock/**',
      'tmp/**',
      'venv/**',
      'tests/**',
      'docs/**',
      'lenses/**',
      'data/**',
      '.tm1baseline/**',
    ],
  },
  {
    files: ['server.js', 'lens-server.js', 'core/**/*.js', 'tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': unused },
  },
  {
    files: ['shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': unused },
  },
]
