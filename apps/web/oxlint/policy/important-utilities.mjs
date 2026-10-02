export const importantUtilityAllowlist = [
  { file: "components/ui/badge.tsx", token: "[&>svg]:size-3!", reason: "Badge-owned direct icons must retain their fixed size over icon-provided sizes." },
  { file: "components/ui/drawer.tsx", token: "motion-reduce:duration-0!", reason: "Reduced motion must override the drawer's state-driven transition durations." },
  { file: "components/ui/toast.tsx", token: "motion-reduce:duration-0!", reason: "Reduced motion must override the toast's state-driven transition durations." },
  { file: "client/money-modal/money-modal.tsx", token: "pb-4!", reason: "Keyboard-open sheet layout depends on it; the Keyboard Close One Tap journey story fails without it." },
  { file: "client/money-modal/money-modal.tsx", token: "pb-[max(1rem,calc(env(safe-area-inset-bottom)_-_var(--sheet-keyboard-inset,0px)))]!", reason: "Keyboard-open sheet layout depends on it; the Keyboard Close One Tap journey story fails without it." },
];
