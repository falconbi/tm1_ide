#!/usr/bin/env node
'use strict'

// ── TM1 Git integration — lab evaluation spike (Step 2) ─────────────────────
// Throwaway script for IMPROVEMENTS 10.1. Drives TM1's built-in Git REST API on
// a lab server pair (TM1_Test_DEV → TM1_Test_PROD). Every write is an explicit
// action; the default is read-only plans (push/pull "what will change" previews).
//
// Usage:
//   node eval-tm1-git.js --server TM1_Test_DEV --repo <url> --deployment DEV --token <PAT> --action <a>
//   Actions: init | status | plans | push-plan | push-execute | pull-plan | pull-execute
//   Push/pull opts: --branch dev --newbranch dev --message "msg" --author "Name" --email "n@x.com"
//
// Never executes without an explicit --action push-execute / pull-execute.
// The plan id is printed after push-plan/pull-plan so you can review, then execute.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const { makeClient } = require('../core/adapter_registry')

function arg(name, def) {
    const i = process.argv.indexOf('--' + name)
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const SERVER    = arg('server')
const REPO      = arg('repo')
const DEPLOY    = arg('deployment', 'DEV')
const USER      = arg('user', '')
const TOKEN     = arg('token', process.env.TM1_GIT_TOKEN || '')
const ACTION    = arg('action', 'status')
const BRANCH    = arg('branch', '')
const NEWBRANCH = arg('newbranch', '')
const MESSAGE   = arg('message', '')
const AUTHOR    = arg('author', USER)
const EMAIL     = arg('email', '')
const FORCE     = arg('force', '') === 'true'

if (!SERVER) { console.error('Usage: --server <name> [--repo <url>] [--deployment <D>] [--token <PAT>] --action <a>'); process.exit(1) }

const client = makeClient(SERVER, null)
const creds  = { Username: USER, Password: TOKEN }

async function main() {
    switch (ACTION) {
        case 'init': {
            const r = await client.post('GitInit', { URL: REPO, Deployment: DEPLOY, ...creds, Force: FORCE })
            console.log('GitInit OK:', JSON.stringify(r, null, 2))
            break
        }
        case 'status': {
            const r = await client.post('GitStatus', creds)
            console.log('GitStatus:', JSON.stringify(r, null, 2))
            break
        }
        case 'plans': {
            const r = await client.get('GitPlans')
            console.log('Plans:', JSON.stringify(r.value ?? r, null, 2))
            break
        }
        case 'push-plan': {
            const r = await client.post('GitPush', {
                Branch: BRANCH, NewBranch: NEWBRANCH, Force: FORCE,
                Message: MESSAGE, Author: AUTHOR, Email: EMAIL, ...creds,
            })
            console.log('PUSH PLAN (review, then push-execute):', JSON.stringify(r, null, 2))
            break
        }
        case 'pull-plan': {
            const r = await client.post('GitPull', {
                Branch: BRANCH, ExecutionMode: 'SingleCommit', Force: FORCE, ...creds,
            })
            console.log('PULL PLAN (review, then pull-execute):', JSON.stringify(r, null, 2))
            break
        }
        case 'push-execute': {
            const id = arg('plan')
            if (!id) { console.error('push-execute needs --plan <id> (from push-plan)'); process.exit(1) }
            const r = await client.post(`GitPlans('${encodeURIComponent(id)}')/tm1.Execute`, {})
            console.log('PUSH EXECUTED:', JSON.stringify(r, null, 2))
            break
        }
        case 'pull-execute': {
            const id = arg('plan')
            if (!id) { console.error('pull-execute needs --plan <id> (from pull-plan)'); process.exit(1) }
            const r = await client.post(`GitPlans('${encodeURIComponent(id)}')/tm1.Execute`, {})
            console.log('PULL EXECUTED:', JSON.stringify(r, null, 2))
            break
        }
        default:
            console.error('Unknown --action', ACTION)
            process.exit(1)
    }
}

main().catch(e => {
    console.error('ERROR:', e.response?.status, e.response?.data?.error?.message ?? e.message)
    process.exit(1)
})