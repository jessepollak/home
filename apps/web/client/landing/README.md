# SupportedGlobe

A scoped, static-first landing centerpiece. It owns only the globe, its interaction
and screen-reader description—not a hero, country setting, auth, navigation, or
product eligibility. There is no widget dropdown, country readout or visible motion
button. The root header remains the single country setting.

```tsx
import { SupportedGlobe } from "@/client/landing/supported-globe";

<SupportedGlobe />
```

The default derives from `regionIds` and `presentationRegions`, excluding the
neutral profile whose `countryCode` is null. No support roster is copied here.
The geographic table is deliberately broader than configured support.

Actual-use props:

```ts
type SupportedGlobeProps = {
  className?: string;
  countries?: readonly {
    countryCode: string; // unique, uppercase ISO alpha-2 code from the sourced table
    countryName: string;
    currency: { code: string | null; name: string };
  }[];
};
```

`countries` is for an explicitly scoped presentation roster; omit it for the logged-out
landing. Unknown codes are not plotted at invented coordinates. `className` can
constrain size/placement. Default width is 100%, max 640px; the full sphere remains
inside its square stage at every size. Keep headline, benefit copy, CTAs and
surrounding layout in the parent.

## Rendering and interaction

- Server HTML includes a local shaded SVG background, correctly projected current
  markers, and an accessible profile/availability description. No JS/WebGL is
  necessary to read the landing or use independent sign-in UI.
- An intersection observer defers `import("./globe-renderer")` until on screen.
  The renderer uses documented WebGL 1 APIs with two programs/two draw calls:
  a shaded orthographic sphere and sourced land points. No added dependencies,
  textures, remote assets, scene graph, physics or animation packages.
- Default rotation is 2.5°/second. Horizontal primary-pointer dragging follows the
  pointer (180° per stage width), with release velocity capped at ±180°/second.
  Exact exponential integration decays to the default with a 900ms time constant.
  A stationary hold before release discards stale velocity. Repeated drags reset
  the prior gesture; cancel/lost capture clears inertia and releases capture.
- Draw workload, including pointer movement, is capped at 30 frames/second (apart
  from initialization/resize), DPR 1.5 and a 960×960 backing buffer. Tab visibility
  and intersection suspend rAF, release any drag, discard inertia and reset the
  clock on return. Hidden time never becomes a rotation jump.
- `touch-action: pan-y pinch-zoom` preserves browser scrolling and zoom. Vertical
  gestures and secondary touches abandon dragging. No pointer handler calls
  `preventDefault`; native pointer cancellation is handled explicitly.
- Reduced motion defaults to no autorotation **or release inertia**. Direct drag
  and arrow-key rotation remain available. The single focused globe supports Space
  to pause/resume (explicit motion opt-in) and Left/Right arrows to rotate by 12°.
  Screen-reader instructions and a live motion state accompany the focus ring;
  key handling is scoped to this element, not the document. Focus/hover alone
  does not pause rotation. Country dots are not keyboard stops.
- Country dots keep sourced geographic positions, hemisphere culling and circular
  clipping. They are not displaced to declutter Europe. Markers identify configured
  presentation profiles, never token/funding/product eligibility.
- No WebGL, shader/import failure or context loss retains/restores the SVG view.
  Its orientation stays fixed and it has no inert keyboard control. Context loss
  does not repeatedly retry an unhealthy GPU context.
- Unmount cancels rAF, releases pointer capture, disconnects observers, removes all
  listeners, deletes both buffers/programs and all four shaders, then releases
  the context. Profile prop changes update markers without rebuilding the GPU.

## Tests and limits

`bun test apps/web/client/landing` checks automatic configured coverage, euro-area
coverage, coordinate choice, antipodes/antimeridian/poles, land vectors, motion policy,
SSR fallback, bounded velocity and decay, pointer/cancel/repeated drag handling,
frame/DPR/buffer caps, suspension and complete resource disposal. Browser validation
also covers keyboard controls, touch page scrolling, actual WebGL draws/pixels,
context-loss fallback, composition order, auth-sheet reachability and viewport fit.

Natural Earth is a simplified cartographic source, not a political/eligibility map.
Some small islands have a supported marker but no land dots at 110m scale. A fixed
12° northward camera tilt shows a full, uncropped globe but not the extreme south
polar cap. For provenance, license and deterministic regeneration see
[GEOGRAPHY.md](./GEOGRAPHY.md).

Implementation API references:
- https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event
- https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
- https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action
- https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API

Browser evidence is recorded outside the repository in the task handoff. Software
WebGL observations are validation evidence, not a physical-device performance claim.
