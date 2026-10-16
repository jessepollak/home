# Result header

`components/ui/result-header.tsx` owns the outcome mark, title, description and atomic live status for pending, success, failed and unknown results. Reuse it rather than constructing another status panel.

Defaults remain a level-three heading and the outcome texture's text tone for raised money-result surfaces. A page below the shell's level-one heading uses `headingLevel={2}`. A page-level header on the muted page background uses `textTone="foreground"` so its title and description keep readable contrast; raised surfaces retain the default `"texture"` tone. Neither option changes result semantics.

`ui-result-header--pending-page` demonstrates the page contract. `journeys-account-leave--queued-with-blockers` integrates it with the production shell and nested Back navigation.
