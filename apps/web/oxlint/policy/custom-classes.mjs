// Project-owned, non-Tailwind classes that are intentionally used in class strings.
// Tailwind's design system cannot resolve these because they are plain CSS rules
// (defined in app/globals.css or a CSS module) rather than `@utility` registrations.
// A new entry requires the class to be defined in checked-in CSS.
export const allowedCustomClasses = new Set([
  "shell-scroll-container",
  "shell-scrollbar-compensated",
]);
