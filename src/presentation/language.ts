export const CFI_LANGUAGES = {
  auto: { label: "Auto", locale: "auto" },
  vi: { label: "Tiếng Việt", locale: "vi-VN" },
  en: { label: "English", locale: "en-US" },
  zh: { label: "中文", locale: "zh-CN" },
  ja: { label: "日本語", locale: "ja-JP" },
  ko: { label: "한국어", locale: "ko-KR" },
  es: { label: "Español", locale: "es-ES" },
  pt: { label: "Português", locale: "pt-PT" },
  fr: { label: "Français", locale: "fr-FR" },
  de: { label: "Deutsch", locale: "de-DE" },
  it: { label: "Italiano", locale: "it-IT" },
  th: { label: "ไทย", locale: "th-TH" },
  id: { label: "Bahasa Indonesia", locale: "id-ID" },
} as const;

export type CfiLanguage = keyof typeof CFI_LANGUAGES;

export type LanguagePreference = {
  language: CfiLanguage;
  updatedAt?: string;
};

const aliases: Record<string, CfiLanguage> = {
  auto: "auto",
  vi: "vi",
  vn: "vi",
  vietnamese: "vi",
  "tiếng việt": "vi",
  tiengviet: "vi",
  en: "en",
  eng: "en",
  english: "en",
  zh: "zh",
  cn: "zh",
  chinese: "zh",
  中文: "zh",
  ja: "ja",
  jp: "ja",
  japanese: "ja",
  日本語: "ja",
  ko: "ko",
  kr: "ko",
  korean: "ko",
  한국어: "ko",
  es: "es",
  spanish: "es",
  español: "es",
  pt: "pt",
  portuguese: "pt",
  português: "pt",
  fr: "fr",
  french: "fr",
  français: "fr",
  de: "de",
  german: "de",
  deutsch: "de",
  it: "it",
  italian: "it",
  italiano: "it",
  th: "th",
  thai: "th",
  ไทย: "th",
  id: "id",
  indonesian: "id",
  "bahasa indonesia": "id",
};

const ui = {
  dataQuality: {
    vi: "Chất lượng dữ liệu",
    en: "Data quality",
    zh: "数据质量",
    ja: "データ品質",
    ko: "데이터 품질",
    es: "Calidad de datos",
    pt: "Qualidade dos dados",
    fr: "Qualité des données",
    de: "Datenqualität",
    it: "Qualità dei dati",
    th: "คุณภาพข้อมูล",
    id: "Kualitas data",
  },
  strongSignal: {
    vi: "TÍN HIỆU MẠNH",
    en: "STRONG SIGNAL",
    zh: "强信号",
    ja: "強いシグナル",
    ko: "강한 신호",
    es: "SEÑAL FUERTE",
    pt: "SINAL FORTE",
    fr: "SIGNAL FORT",
    de: "STARKES SIGNAL",
    it: "SEGNALE FORTE",
    th: "สัญญาณแรง",
    id: "SINYAL KUAT",
  },
  noStrongSignal: {
    vi: "KHÔNG CÓ TÍN HIỆU MẠNH",
    en: "NO STRONG SIGNAL",
    zh: "无强信号",
    ja: "強いシグナルなし",
    ko: "강한 신호 없음",
    es: "SIN SEÑAL FUERTE",
    pt: "SEM SINAL FORTE",
    fr: "AUCUN SIGNAL FORT",
    de: "KEIN STARKES SIGNAL",
    it: "NESSUN SEGNALE FORTE",
    th: "ไม่มีสัญญาณแรง",
    id: "TIDAK ADA SINYAL KUAT",
  },
  persistentDb: {
    vi: "Persistent DB",
    en: "Persistent DB",
    zh: "Persistent DB",
    ja: "Persistent DB",
    ko: "Persistent DB",
    es: "Persistent DB",
    pt: "Persistent DB",
    fr: "Persistent DB",
    de: "Persistent DB",
    it: "Persistent DB",
    th: "Persistent DB",
    id: "Persistent DB",
  },
} as const;

type UiKey = keyof typeof ui;

type NonAutoLanguage = Exclude<CfiLanguage, "auto">;

export function normalizeLanguage(input?: string | null): CfiLanguage | null {
  if (!input) return null;
  const normalized = input.trim().toLowerCase();
  return aliases[normalized] ?? null;
}

export function parseLanguageCommand(text?: string | null): CfiLanguage | null {
  if (!text) return null;
  const match = text.trim().match(/^CFI\s+LANG(?:UAGE)?\s+(.+)$/i);
  if (!match) return null;
  return normalizeLanguage(match[1]);
}

export function resolvePresentationLanguage(args: {
  preference?: CfiLanguage | null;
  detectedLanguage?: string | null;
  fallback?: NonAutoLanguage;
}): NonAutoLanguage {
  const fallback = args.fallback ?? "en";

  if (args.preference && args.preference !== "auto") {
    return args.preference;
  }

  const detected = normalizeLanguage(args.detectedLanguage);
  if (detected && detected !== "auto") return detected;

  return fallback;
}

export function t(key: UiKey, language: NonAutoLanguage): string {
  return ui[key][language] ?? ui[key].en;
}

export function languageOptions() {
  return Object.entries(CFI_LANGUAGES).map(([value, meta]) => ({
    value: value as CfiLanguage,
    label: meta.label,
    locale: meta.locale,
  }));
}

/**
 * Canonical football identifiers and market codes are intentionally not translated.
 * Examples: team canonical_name, competition IDs, 3+ HT, 7+ FT, Other HT,
 * Other FT, NEW, DUPLICATE_COMPATIBLE, COMPLEMENTARY, CONFLICT, REJECTED.
 */
export const CANONICAL_TERMS_ARE_LANGUAGE_NEUTRAL = true;
