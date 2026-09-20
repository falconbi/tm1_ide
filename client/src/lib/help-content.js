// ── In-app contextual help content ──────────────────────────────────────────
//
// One entry per editor/area, shown via HelpPanel.jsx from a '?' toolbar button.
// This is the pilot for replacing docs/index.html (a standalone GitHub Pages
// doc that had drifted — wrong keyboard shortcuts, a removed snippet still
// mentioned): content that ships with the code gets reviewed alongside the
// change that would make it stale, instead of living on a separate page
// nobody remembers to update.
//
// Each entry's `sections` is a list of { heading, body } — body is plain
// strings/JSX-free markdown-lite (rendered by HelpPanel with basic `code`
// span support only), kept deliberately simple rather than pulling in a
// markdown renderer for a handful of paragraphs.

export const HELP_CONTENT = {
  rules: {
    title: 'Rules Editor',
    sections: [
      {
        heading: 'Formatting',
        body: 'Click **Format** in the toolbar to format the entire rules file. To format a single rule, select it first — the formatter applies only to the selection. Formatting preserves regions, comments, and feeders structure.',
      },
      {
        heading: 'Validation',
        body: '**Check** runs the current buffer through the static validator and the live TM1 `CheckRules` endpoint, showing errors inline with a pass/fail glow on the button.',
      },
      {
        heading: 'Cell Trace',
        body: 'The **Trace** panel lets you enter element coordinates and see the full calculation chain — which rules fired, in what order, and what intermediate values were produced.',
      },
      {
        heading: 'Regions',
        body: 'Use `#Region Name` / `#EndRegion` to fold and organise sections. The **Regions** menu jumps to any region; **Collapse/Expand** toggles all of them at once.',
      },
      {
        heading: 'Snippets',
        body: 'The **Snippets** panel lists ready-to-insert templates for element functions, date, and string functions. Type a function name and press Tab to expand it inline.',
      },
      {
        heading: 'Feeders',
        body: '**Fire Feeders** runs `CheckFeedersForRules` for this cube, recalculating feeder propagation. Open a view afterward to see zero-value rule cells highlighted amber.',
      },
    ],
  },
}
