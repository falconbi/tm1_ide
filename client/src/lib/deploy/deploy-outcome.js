// What a deploy result actually means for the target, and what to do next.
//
// A deploy is not one step: preconditions → pull → record → subsets/views →
// verification → safety checks. Each fails differently and leaves the target in
// a different state, so "no rollback, fix forward" is not guidance — it is a
// sentence that describes one of six cases.
//
// This maps the result the server returns (core/git-deploy.js execute) onto:
//   title  — what failed
//   prod   — what state the target is in NOW
//   action — the one next thing to do
//   tone   — red (target may be wrong), amber (needs a retry or attention), green

const TONE = { red: 'red', amber: 'amber', green: 'emerald' }

export function classifyDeployOutcome(res) {
  if (!res) return null
  const err = String(res.error ?? '')

  // Refused / failed before the pull ran.
  if (!res.executed) {
    if (/^Pull failed/i.test(err)) {
      return {
        kind: 'pull-failed', tone: TONE.red,
        title: 'The pull failed part-way',
        prod: 'The target may hold some of the release but not all of it. Its recorded commit has NOT moved, so it no longer matches what it last received.',
        action: 'Do not run the deploy again. Open Drift first: if it reports differences, the target has to be returned to its last received commit before anything else ships.',
      }
    }
    return {
      kind: 'refused', tone: TONE.amber,
      title: 'Stopped before anything changed',
      prod: 'The target is untouched.',
      action: err || 'Fix the reason above, then deploy again.',
    }
  }

  // Applied, but the bookkeeping failed.
  if (res.recorded === false) {
    return {
      kind: 'unrecorded', tone: TONE.amber,
      title: 'Deployed, but the deploy record was not written',
      prod: `The target has the release and is at ${res.targetCommit ?? 'the released commit'}.`,
      action: 'The IDE does not know which commit the target received, so drift and "already deployed" will be wrong until that is fixed. Investigate before the next deploy.',
    }
  }

  // Applied, but the objects that only travel over REST did not all land.
  if (res.subsetsViews?.errors?.length) {
    const n = res.subsetsViews.errors.length
    return {
      kind: 'subsets-views', tone: TONE.amber,
      title: `${n} subset/view${n === 1 ? '' : 's'} did not apply`,
      prod: 'The cubes, dimensions and processes are on the target. The subsets and views, which TM1 Git does not pull, did not all land.',
      action: `Deploy the same release again — that step re-applies and is safe to repeat. If it keeps failing: ${res.subsetsViews.errors.map(e => `${e.type} ${e.name}: ${e.error}`).join('; ')}`,
    }
  }

  // Applied, but verification could not confirm every object.
  if (res.incomplete?.length || res.incompleteCheckError) {
    return {
      kind: 'incomplete', tone: TONE.amber,
      title: 'Some objects could not be confirmed on the target',
      prod: 'The deploy ran. Verification could not prove every object in the release is there.',
      action: res.incompleteCheckError
        ? `Deploy the same release again. The check itself errored: ${res.incompleteCheckError}`
        : `Deploy the same release again. Still missing: ${res.incomplete.join(', ')}`,
    }
  }

  // Applied, but the model is now wrong.
  if (res.verification && res.controlOk === false) {
    const failed = (res.verification.results ?? []).filter(r => !r.pass)
    return {
      kind: 'checks-failed', tone: TONE.red,
      title: 'Deployed, but the safety checks failed',
      prod: `The target has the release and is at ${res.targetCommit ?? 'the released commit'} — but what it computes is now wrong.`,
      action: `Fix it on DEV, commit, build a new release and deploy that. ${failed.length ? `First failure: ${failed[0].description}` : ''} There is no automatic rollback yet.`,
    }
  }

  return {
    kind: 'ok', tone: TONE.green,
    title: 'Deployed',
    prod: `The target is at ${res.targetCommit ?? 'the released commit'}.`,
    action: '',
  }
}

// The colour classes the card uses, kept out of the JSX so the tone names above
// stay the only vocabulary.
export function toneClasses(tone) {
  if (tone === TONE.red)   return 'border-red-600/40 bg-red-500/5 text-red-600'
  if (tone === TONE.green) return 'border-emerald-600/30 bg-emerald-600/5 text-emerald-700'
  return 'border-amber-600/40 bg-amber-500/5 text-amber-600'
}
