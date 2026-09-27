# HLTPC public viewer

Applied from UI UX Pro Max (nextlevelbuilder/ui-ux-pro-max-skill), using the sports results editorial dashboard search after one off-topic recommendation.

## Direction
An editorial esports archive. Lead with the latest Major champion, provide direct access to the final and playoffs, then recent results, rankings and community news. Preserve actual team logos and player photographs. No automatic carousel or decorative 3D effects.

## Foundations
- Charcoal background #101216, surfaces #191c22 and #20242c, borders #343a45.
- Primary text #f5f5f2, secondary text #abb3c0, championship accent #efb449. Gold buttons use dark text.
- Existing Inter for reading and Oswald for titles; JetBrains Mono for scores. Body 16px, essential labels 12–14px, headings 26–54px.
- 8px spacing foundation, 24–40px section separation, 10–16px panel radii. Desktop content width 1200px.

## Interaction
Visible keyboard focus, skip link, labeled search, current navigation announced with aria-current, controls at least 44px high, reduced motion respected. Statistics tables scroll inside their panels. Mobile navigation scrolls within its own container.

## Data presentation
Completed tournaments show champion and final results. Unplayed decider maps are explicitly labeled and omitted from statistics tabs and source completion ratios. Incomplete recordings retain official scores and visibly identify partial statistics.

The public stylesheet is scoped to .public-site so the admin retains its working interface. Private source demos, credentials and recovery artifacts are excluded from the deployment allowlist.
