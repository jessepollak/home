const supportedLanguages = new Set([
  "ar", "hy", "az", "bn", "bg", "my", "ca", "km", "zh", "zh-tw", "hr", "cs", "da", "nl", "en", "et", "fl", "fi", "fr", "ka", "de", "el", "ha", "he", "hi", "hu", "id", "it", "ja", "kk", "ko", "lo", "lv", "lt", "ms", "no", "fa", "pl", "pt", "pt-br", "ro", "ru", "sr", "sk", "sl", "es", "sw", "sv", "tg", "tr", "th", "uk", "ur", "uz", "vi", "zu",
]);

export function sumsubLanguage(tag: string): string {
  const normalized = tag.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "pt-br" || normalized.startsWith("pt-br-")) return "pt-br";
  if (normalized === "zh-tw" || normalized.startsWith("zh-tw-") || normalized === "zh-hant" || normalized.startsWith("zh-hant-")) return "zh-tw";
  const language = normalized.split("-")[0];
  return supportedLanguages.has(language) ? language : "en";
}
