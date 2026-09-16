# Agent instruction review

The [Astra guide](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) recommends concise routing, narrowly triggered skills, relevant context loaded when needed, and explicit completion criteria.

Applied here: AGENTS links product tasks to strategy, shaping tasks to the brief template, and tracking tasks to the Project guide. Issue briefs carry concrete acceptance. Existing execution, review, credential, and merge boundaries remain authoritative.

Home's animate, review-animations, mobile-native, and explicitly invoked retro skills already have distinct purposes. No general planning skill is needed for this setup. A follow-up under Design #207 should check duplicated timing guidance and references to older UI direction against the current design system. Change those only after checking actual callers and behavior.

The guide is not a reason to remove repository gates. In particular, `bun check`, independent review, and Jesse-only merge remain required. Keep product intent, technical constraints, and authorization in their respective source documents rather than copying them into every task.
