export const SUPPORTED_LOCALES = ["en", "es", "ja", "id"] as const;
export type Locale = typeof SUPPORTED_LOCALES[number];

export const LOCALE_OPTIONS: ReadonlyArray<{ id: Locale; nativeName: string; englishName: string }> = [
  { id: "en", nativeName: "English", englishName: "English" },
  { id: "es", nativeName: "Español", englishName: "Spanish" },
  { id: "ja", nativeName: "日本語", englishName: "Japanese" },
  { id: "id", nativeName: "Bahasa Indonesia", englishName: "Indonesian" },
];

export const LANGUAGE_TAGS: Record<Locale, string> = {
  en: "en-US",
  es: "es-ES",
  ja: "ja-JP",
  id: "id-ID",
};

const EN_MESSAGES = {
  "language.heading": "Language",
  "language.description": "Choose the language used by the interface, lessons, and glossary.",
  "language.label": "Interface language",
  "language.canonical": "English is the canonical catalog. Missing translations fall back to English and are reported during development.",
  "guided.badge": "Guided lesson",
  "guided.step": "Step {current} of {total}",
  "guided.worksheetMeta": "Cataclysm classroom worksheet · Name: ______________________ · Date: ____________",
  "guided.worksheetFooter": "Educational model — first-order estimates, not an operational forecast.",
  "guided.close": "Close lesson",
  "guided.print": "Print worksheet",
  "guided.printTitle": "Print a classroom worksheet with this lesson's questions",
  "guided.back": "Back",
  "guided.next": "Next",
  "guided.done": "Done",
  "guided.training": "Guided training",
  "guided.walkthroughs": "{count} model walkthroughs",
  "guided.completed": "Lesson completed",
} as const;

export type MessageKey = keyof typeof EN_MESSAGES;
type MessageCatalog = Partial<Record<MessageKey, string>>;

const ES_MESSAGES: MessageCatalog = {
  "language.heading": "Idioma",
  "language.description": "Elige el idioma de la interfaz, las lecciones y el glosario.",
  "language.label": "Idioma de la interfaz",
  "language.canonical": "El inglés es el catálogo canónico. Las traducciones que falten vuelven al inglés y se notifican durante el desarrollo.",
  "guided.badge": "Lección guiada",
  "guided.step": "Paso {current} de {total}",
  "guided.worksheetMeta": "Hoja de trabajo de Cataclysm · Nombre: ______________________ · Fecha: ____________",
  "guided.worksheetFooter": "Modelo educativo: estimaciones de primer orden, no un pronóstico operativo.",
  "guided.close": "Cerrar",
  "guided.print": "Imprimir",
  "guided.printTitle": "Imprimir una hoja de trabajo con las preguntas de esta lección",
  "guided.back": "Atrás",
  "guided.next": "Siguiente",
  "guided.done": "Terminar",
  "guided.training": "Formación guiada",
  "guided.walkthroughs": "{count} recorridos del modelo",
  "guided.completed": "Lección completada",
};

const JA_MESSAGES: MessageCatalog = {
  "language.heading": "言語",
  "language.description": "インターフェース、レッスン、用語集で使用する言語を選択します。",
  "language.label": "表示言語",
  "language.canonical": "英語が基準カタログです。翻訳がない項目は英語で表示され、開発時に警告されます。",
  "guided.badge": "ガイド付きレッスン",
  "guided.step": "{total} ステップ中 {current}",
  "guided.worksheetMeta": "Cataclysm 学習ワークシート · 名前: ______________________ · 日付: ____________",
  "guided.worksheetFooter": "教育用モデル — 一次近似であり、運用予報ではありません。",
  "guided.close": "閉じる",
  "guided.print": "印刷",
  "guided.printTitle": "このレッスンの設問を含む学習ワークシートを印刷",
  "guided.back": "戻る",
  "guided.next": "次へ",
  "guided.done": "完了",
  "guided.training": "ガイド付き学習",
  "guided.walkthroughs": "モデル解説 {count} 件",
  "guided.completed": "レッスン完了",
};

const ID_MESSAGES: MessageCatalog = {
  "language.heading": "Bahasa",
  "language.description": "Pilih bahasa untuk antarmuka, pelajaran, dan glosarium.",
  "language.label": "Bahasa antarmuka",
  "language.canonical": "Bahasa Inggris adalah katalog acuan. Terjemahan yang belum tersedia kembali ke bahasa Inggris dan dilaporkan saat pengembangan.",
  "guided.badge": "Pelajaran terpandu",
  "guided.step": "Langkah {current} dari {total}",
  "guided.worksheetMeta": "Lembar kerja kelas Cataclysm · Nama: ______________________ · Tanggal: ____________",
  "guided.worksheetFooter": "Model pendidikan — perkiraan orde pertama, bukan prakiraan operasional.",
  "guided.close": "Tutup",
  "guided.print": "Cetak",
  "guided.printTitle": "Cetak lembar kerja kelas dengan pertanyaan pelajaran ini",
  "guided.back": "Kembali",
  "guided.next": "Lanjut",
  "guided.done": "Selesai",
  "guided.training": "Pelatihan terpandu",
  "guided.walkthroughs": "{count} panduan model",
  "guided.completed": "Pelajaran selesai",
};

const CATALOGS: Record<Locale, MessageCatalog> = {
  en: EN_MESSAGES,
  es: ES_MESSAGES,
  ja: JA_MESSAGES,
  id: ID_MESSAGES,
};

const warnedMissing = new Set<string>();

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function warnMissingTranslation(locale: Locale, key: string): void {
  if (locale === "en" || !import.meta.env.DEV) return;
  const warningKey = `${locale}:${key}`;
  if (warnedMissing.has(warningKey)) return;
  warnedMissing.add(warningKey);
  console.warn(`[i18n] missing ${locale} translation for "${key}"; falling back to English.`);
}

export function resetMissingTranslationWarningsForTests(): void {
  warnedMissing.clear();
}

function interpolate(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match);
}

export function translate(
  locale: Locale,
  key: MessageKey,
  values?: Record<string, string | number>,
): string {
  const localized = CATALOGS[locale][key];
  if (localized === undefined) warnMissingTranslation(locale, key);
  return interpolate(localized ?? EN_MESSAGES[key], values);
}

export function readStoredLocale(): Locale {
  if (typeof localStorage === "undefined") return "en";
  try {
    const value = JSON.parse(localStorage.getItem("tsunamisim.locale") ?? "null") as unknown;
    return isLocale(value) ? value : "en";
  } catch {
    return "en";
  }
}
