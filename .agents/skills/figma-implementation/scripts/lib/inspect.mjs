// Browser-side DOM measurement for the measure gate.
//
// `collectMeasurements` is injected into the page as source
// (`Function.prototype.toString()`), so it must stay self-contained: no imports,
// no module-scope helpers, no bundler transforms. Everything it needs arrives
// through its arguments, and it returns a structured-cloneable object.
//
// Coordinate convention (documented in references/verification.md):
//   rect.width/height   the element's border-box size
//   rect.left/top       offset from the frame element's content-box origin
//   rect.right/bottom   inset from that content box's right/bottom edge
// With no frameSelector, left/top are page-relative and right/bottom are
// viewport-relative.

/**
 * @param {string | null} frameSelector selector for the element that stands in for the Figma frame
 * @param {"border" | "content"} frameBox which box of that element the Figma frame maps to
 * @param {{ name: string, selector: string, direction?: "h" | "v", styles?: Record<string, string> }[]} elements
 */
export function collectMeasurements(frameSelector, frameBox, elements) {
  const round = (value) => Math.round(value * 100) / 100;
  const px = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  let origin = null;
  if (frameSelector) {
    const frame = document.querySelector(frameSelector);
    if (frame) {
      const frameRect = frame.getBoundingClientRect();
      const style = getComputedStyle(frame);
      const insetLeft = frameBox === "content" ? px(style.borderLeftWidth) + px(style.paddingLeft) : 0;
      const insetTop = frameBox === "content" ? px(style.borderTopWidth) + px(style.paddingTop) : 0;
      const insetRight = frameBox === "content" ? px(style.borderRightWidth) + px(style.paddingRight) : 0;
      const insetBottom = frameBox === "content" ? px(style.borderBottomWidth) + px(style.paddingBottom) : 0;
      const borderWidth = px(style.borderLeftWidth) + px(style.borderRightWidth);
      const borderHeight = px(style.borderTopWidth) + px(style.borderBottomWidth);
      const paddingWidth = px(style.paddingLeft) + px(style.paddingRight);
      const paddingHeight = px(style.paddingTop) + px(style.paddingBottom);
      origin = {
        x: frameRect.left + insetLeft,
        y: frameRect.top + insetTop,
        width: Math.max(0, frameRect.width - insetLeft - insetRight),
        height: Math.max(0, frameRect.height - insetTop - insetBottom),
        box: frameBox,
        scrollWidth: frame.scrollWidth,
        clientWidth: frame.clientWidth,
        // Full box ladder so the spec can point the Figma frame at the right box
        // (`frameSize: { width: "contentWidth", height: "paddingHeight" }`).
        borderWidth: frameRect.width,
        borderHeight: frameRect.height,
        contentWidth: Math.max(0, frameRect.width - borderWidth - paddingWidth),
        contentHeight: Math.max(0, frameRect.height - borderHeight - paddingHeight),
        paddingWidth: Math.max(0, frameRect.width - borderWidth),
        paddingHeight: Math.max(0, frameRect.height - borderHeight),
      };
    }
  }

  const viewport = { width: window.innerWidth, height: window.innerHeight };

  const measured = elements.map((element) => {
    const node = document.querySelector(element.selector);
    if (!node) return { name: element.name, selector: element.selector, missing: true };
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);

    const styles = {};
    for (const key of Object.keys(element.styles ?? {})) {
      const computed = style[key];
      styles[key] =
        computed !== undefined && computed !== ""
          ? computed
          : style.getPropertyValue(key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`));
    }

    const box = origin ?? { x: 0, y: 0, width: viewport.width, height: viewport.height };
    const borderWidth = px(style.borderLeftWidth) + px(style.borderRightWidth);
    const borderHeight = px(style.borderTopWidth) + px(style.borderBottomWidth);
    const paddingWidth = px(style.paddingLeft) + px(style.paddingRight);
    const paddingHeight = px(style.paddingTop) + px(style.paddingBottom);
    const result = {
      name: element.name,
      selector: element.selector,
      rect: {
        width: round(rect.width),
        height: round(rect.height),
        left: round(rect.left - box.x),
        top: round(rect.top - box.y),
        right: round(box.x + box.width - rect.right),
        bottom: round(box.y + box.height - rect.bottom),
        // Box ladder, so a Figma frame can be mapped to the right DOM box:
        // Figma auto-layout pads *inside* a frame (its padding box), while the
        // DOM pads inside the border box. `contentWidth` is the box inside the
        // element's own padding; `paddingWidth` is the border box minus border.
        contentWidth: round(rect.width - borderWidth - paddingWidth),
        contentHeight: round(rect.height - borderHeight - paddingHeight),
        paddingWidth: round(rect.width - borderWidth),
        paddingHeight: round(rect.height - borderHeight),
      },
      styles,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      color: style.color,
      text: (node.textContent ?? "").trim().slice(0, 80),
      overflowsHorizontally: node.scrollWidth > node.clientWidth + 1,
      gapToNext: null,
    };

    const sibling = node.nextElementSibling;
    if (sibling) {
      const siblingRect = sibling.getBoundingClientRect();
      const vertical =
        element.direction === "v"
          ? true
          : element.direction === "h"
            ? false
            : siblingRect.top >= rect.bottom - 1;
      result.gapToNext = round(vertical ? siblingRect.top - rect.bottom : siblingRect.left - rect.right);
    }
    return result;
  });

  return {
    frame: origin
      ? {
          width: round(origin.width),
          height: round(origin.height),
          box: origin.box,
          scrollWidth: origin.scrollWidth,
          clientWidth: origin.clientWidth,
          borderWidth: round(origin.borderWidth),
          borderHeight: round(origin.borderHeight),
          contentWidth: round(origin.contentWidth),
          contentHeight: round(origin.contentHeight),
          paddingWidth: round(origin.paddingWidth),
          paddingHeight: round(origin.paddingHeight),
        }
      : null,
    viewport,
    elements: measured,
  };
}

/**
 * Minimal summary of the page state, used to fail fast when a story did not
 * render (an empty `#storybook-root` diffs as garbage).
 */
export function describeStoryRoot() {
  const root = document.querySelector("#storybook-root");
  return {
    present: Boolean(root),
    childCount: root ? root.children.length : 0,
    text: root ? (root.textContent ?? "").trim().slice(0, 120) : "",
    bodyBackground: getComputedStyle(document.body).backgroundColor,
  };
}
