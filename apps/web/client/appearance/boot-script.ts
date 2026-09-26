import {
  appearanceDarkClass,
  appearancePreferenceKey,
  appearanceThemeColors,
} from "@/shared/appearance/preference";

export const appearanceBootScript = `(()=>{const key=${JSON.stringify(appearancePreferenceKey)},darkClass=${JSON.stringify(appearanceDarkClass)},colors=${JSON.stringify(appearanceThemeColors)};let preference;try{preference=window.localStorage.getItem(key)}catch{preference=null}let prefersDark=false;if(preference!=="dark"&&preference!=="light"){try{prefersDark=window.matchMedia?.("(prefers-color-scheme: dark)").matches??false}catch{}}const dark=preference==="dark"||(preference!=="light"&&prefersDark);document.documentElement.classList.toggle(darkClass,dark);document.querySelector('meta[name="theme-color"]')?.setAttribute("content",dark?colors.dark:colors.light)})()`;
