import {
  CANONICAL_TERMS_ARE_LANGUAGE_NEUTRAL,
  languageOptions,
  normalizeLanguage,
  parseLanguageCommand,
  resolvePresentationLanguage,
  t,
} from "../src/presentation/language.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

assert(normalizeLanguage("VI") === "vi", "VI should normalize to vi");
assert(normalizeLanguage("Tiếng Việt") === "vi", "Vietnamese label should normalize");
assert(normalizeLanguage("English") === "en", "English label should normalize");
assert(parseLanguageCommand("CFI LANGUAGE VI") === "vi", "VI command should parse");
assert(parseLanguageCommand("CFI LANG AUTO") === "auto", "AUTO shorthand should parse");
assert(
  resolvePresentationLanguage({ preference: "vi", detectedLanguage: "en" }) === "vi",
  "Explicit preference must win",
);
assert(
  resolvePresentationLanguage({ preference: "auto", detectedLanguage: "Japanese" }) === "ja",
  "AUTO should use detected supported language",
);
assert(
  resolvePresentationLanguage({ preference: "auto", detectedLanguage: "unknown" }) === "en",
  "Unsupported AUTO language should use fallback",
);
assert(t("dataQuality", "vi") === "Chất lượng dữ liệu", "Vietnamese label mismatch");
assert(t("noStrongSignal", "en") === "NO STRONG SIGNAL", "English label mismatch");
assert(languageOptions().length === 13, "Expected 13 language options including Auto");
assert(CANONICAL_TERMS_ARE_LANGUAGE_NEUTRAL === true, "Canonical terms must stay neutral");

console.log("CFI multilingual presentation tests: PASS");
