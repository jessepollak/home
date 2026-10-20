# Operator brand settings

`Operator/Brand Settings` uses the production editor at `/admin/settings/brand`. Story IDs: `operator-brand-settings--deployment-defaults`, `--saved`, `--lightened-background`, `--save-succeeds`, `--save-error`, `--conflict` and `--operator-changed`. The editor shows source and revision, a Light-theme preview of the name, description, primary and background colors, and the field limits from the shared brand contract. The conflict and operator-change scenarios exercise the real controls and recovery; no operator credentials or database are used.

The preview is scoped with CSS variables and shows the Light theme only. A dark background color is shown at its applied, lightened value; a primary color that cannot keep 4.5:1 as link text on the page background is shown at its applied, darkened value. Cancel and the Back link write nothing.
