# Home section primitives

Each Home section primitive has its own file. Add a file per new primitive rather than extending the [UI-system guide](../../design-system.md). Each file names the code that constructs it and the Figma component it corresponds to in [figma-mapping.json](../../design-explorations/figma-mapping.json).

The Home dashboard and its panels compose one construction per visual from a small primitive set.

Not every heading construction is part of the set. `HomeSectionHeading` in `apps/web/client/home/home-overview.tsx` renders a plain `h2`; expressing it as a `CardTitle` would change both the element and its typography, so it stays as it is.
