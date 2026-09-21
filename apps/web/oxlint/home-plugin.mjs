import {
  noBaseUiImports,
  noBrowserSdkImports,
  noClientServerImports,
  noRelativeLocationAssignment,
  noServerClientImports,
  noSharedRuntimeImports,
  noStorybookImports,
} from "./rules/imports.mjs";
import { requireServerOnly } from "./rules/server-only.mjs";
import { noLiteralUtilityStyles } from "./rules/styles.mjs";
import { noLocalFormatting } from "./rules/formatting.mjs";
import { noRawButtons, noRawFields } from "./rules/raw-elements.mjs";
import { noRestyle } from "./rules/no-restyle.mjs";
import {
  exactMockModules,
  noPresentationClassReads,
  noRealWaits,
  noSourceReads,
} from "./rules/tests.mjs";
import {
  noChainedTypeAssertions,
  noReduceAccumulatorCopy,
  noReducerAccumulatorSpread,
  noReflectIndirection,
  noUnknownAliases,
  noVagueObjectParameters,
  noWidenThenAssert,
} from "./rules/anti-slop.mjs";
import { noDetachedClassConstantsRule } from "./rules/no-detached-class-constants.mjs";
import { noUnknownTailwindClasses } from "./rules/unknown-classes.mjs";
import { noLiteralJsxColors } from "./rules/jsx-colors.mjs";
import { isolateInstrumentationCalls, noSilentCatch } from "./rules/observability.mjs";
import { noAmountFallback } from "./rules/amounts.mjs";
import { noComments } from "./rules/no-comments.mjs";

const homePlugin = {
  meta: { name: "home" },
  rules: {
    "no-storybook-imports": noStorybookImports,
    "no-client-server-imports": noClientServerImports,
    "no-server-client-imports": noServerClientImports,
    "no-shared-runtime-imports": noSharedRuntimeImports,
    "no-browser-sdk-imports": noBrowserSdkImports,
    "no-base-ui-imports": noBaseUiImports,
    "no-relative-location-assignment": noRelativeLocationAssignment,
    "require-server-only": requireServerOnly,
    "no-literal-utility-styles": noLiteralUtilityStyles,
    "no-local-formatting": noLocalFormatting,
    "no-raw-buttons": noRawButtons,
    "no-raw-fields": noRawFields,
    "no-restyle": noRestyle,
    "no-source-reads": noSourceReads,
    "no-real-waits": noRealWaits,
    "no-presentation-class-reads": noPresentationClassReads,
    "exact-mock-modules": exactMockModules,
    "no-chained-type-assertions": noChainedTypeAssertions,
    "no-reflect-indirection": noReflectIndirection,
    "no-vague-object-parameters": noVagueObjectParameters,
    "no-unknown-aliases": noUnknownAliases,
    "no-reducer-accumulator-spread": noReducerAccumulatorSpread,
    "no-reduce-accumulator-copy": noReduceAccumulatorCopy,
    "no-widen-then-assert": noWidenThenAssert,
    "no-detached-class-constants": noDetachedClassConstantsRule,
    "no-unknown-tailwind-classes": noUnknownTailwindClasses,
    "no-literal-jsx-colors": noLiteralJsxColors,
    "no-silent-catch": noSilentCatch,
    "isolate-instrumentation-calls": isolateInstrumentationCalls,
    "no-amount-fallback": noAmountFallback,
    "no-comments": noComments,
  },
};

export default homePlugin;
