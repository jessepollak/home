// Base UI holds a closing popup in the DOM until its exit animation finishes, so every
// story that closes a sheet waits on the browser's animation clock rather than on the
// state change. On a loaded runner that clock is the slowest thing in the suite: a
// stretched drawer transition turned 16 invest-trade plays into "dialog still in the
// document" failures, and a single CI run failed the same way on an ordinary one. The
// flag skips that wait and unmounts synchronously, exactly as the DOM unit harness does
// for happy-dom, so a play function observes the close instead of racing it.
(globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = true;
