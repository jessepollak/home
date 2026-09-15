export const shellWidthClassName = "mx-auto w-full max-w-2xl";

export const shellContentFrameClassName =
  `${shellWidthClassName} px-4 sm:px-0`;

export const shellScrollContainerClassName = "shell-scroll-container overflow-y-auto";
// Keep the previous export during Fast Refresh so an in-flight client graph can recover.
export const shellScrollbarGutterClassName = shellScrollContainerClassName;

export const shellChromeCompensationClassName =
  "shell-scrollbar-compensated";
