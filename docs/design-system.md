# UI system

Home is a shadcn app using the Base UI preset. The migration history and owner decisions are recorded in [issue #347](https://github.com/jessepollak/home/issues/347).

- [Components](design-system/components.md)
- [Component workshop](design-system/component-workshop.md)
- [Theme](design-system/theme.md)
- [Rules](design-system/rules.md)
- [Styling guards](design-system/styling-guards.md)
- See [Home-owned product pieces](design-system/product-pieces/) for one file per product behavior.
- See [Home section primitives](design-system/primitives/) for one file per primitive, each naming the code that constructs it and the Figma component it corresponds to in [figma-mapping.json](design-explorations/figma-mapping.json) (#683).
- [Testing](design-system/testing.md)
- The teardown and sheet-deferral measurements live in [measurements](design-system/measurements/), one file per measured change.
- [Story inventories](design-system/stories/)

## Where new entries go

A new top-level topic gets a new file in `docs/design-system/` linked from this index; a subsection goes in its topic file. Product pieces, primitives, story groups and measurements each get one file in their directory. Never append a new section to this index.
