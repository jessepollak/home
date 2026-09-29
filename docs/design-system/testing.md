# Testing

Keep tests for Home behavior: exact amounts, dispatch counts, owner fences, routing, cancellation, focus restoration, and other failures that would affect users or money. Follow the [test policy](../architecture.md#test-policy) for what not to test. The owner checks presentation manually; Home has no screenshot baselines.

`bun run --cwd apps/web test:stories` is the production story-interaction gate: it runs selected stories' `play` functions and the a11y audit in headless Chromium. Exploration-tagged stories run in the separate non-blocking **exploration story tests** job (`bun run --cwd apps/web test:stories:explorations`). Neither job is part of `bun check`, so run the relevant story tests with `agent-browser` proof when a change touches stories or owned components.
