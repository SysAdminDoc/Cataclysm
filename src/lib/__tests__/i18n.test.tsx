import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOCALE_OPTIONS,
  getMissingMessageKeys,
  resetMissingTranslationWarningsForTests,
  translate,
  warnMissingTranslation,
  type Locale,
} from "../i18n-core";
import { I18nProvider, useI18n } from "../i18n";

function LocaleProbe() {
  const { locale, languageTag, t, formatNumber } = useI18n();
  return (
    <div>
      <output aria-label="locale">{locale}</output>
      <output aria-label="language tag">{languageTag}</output>
      <output aria-label="heading">{t("language.heading")}</output>
      <output aria-label="steps">{t("guided.step", { current: 2, total: 4 })}</output>
      <output aria-label="number">{formatNumber(1234)}</output>
    </div>
  );
}

describe("i18n", () => {
  beforeEach(() => {
    localStorage.clear();
    resetMissingTranslationWarningsForTests();
  });

  it("ships named catalogs for every supported locale", () => {
    expect(LOCALE_OPTIONS.map(({ id }) => id)).toEqual(["en", "es", "ja", "id"]);
    const expectedHeadings: Record<Locale, string> = {
      en: "Language",
      es: "Idioma",
      ja: "言語",
      id: "Bahasa",
    };
    for (const locale of LOCALE_OPTIONS.map(({ id }) => id)) {
      expect(getMissingMessageKeys(locale)).toEqual([]);
      expect(translate(locale, "language.heading")).toBe(expectedHeadings[locale]);
      expect(translate(locale, "guided.step", { current: 2, total: 4 })).not.toContain("{current}");
    }
  });

  it("reads persisted locale, updates document language, and refreshes after settings save", async () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    render(<I18nProvider><LocaleProbe /></I18nProvider>);

    expect(screen.getByLabelText("locale")).toHaveTextContent("ja");
    expect(screen.getByLabelText("language tag")).toHaveTextContent("ja-JP");
    expect(screen.getByLabelText("heading")).toHaveTextContent("言語");
    expect(document.documentElement).toHaveAttribute("lang", "ja");

    localStorage.setItem("tsunamisim.locale", JSON.stringify("es"));
    await act(async () => window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved")));
    expect(screen.getByLabelText("locale")).toHaveTextContent("es");
    expect(screen.getByLabelText("heading")).toHaveTextContent("Idioma");
    expect(document.documentElement).toHaveAttribute("lang", "es");
  });

  it("warns once per missing non-English key during development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      warnMissingTranslation("es", "test.missing");
      warnMissingTranslation("es", "test.missing");
      warnMissingTranslation("ja", "test.missing");
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(
        '[i18n] missing es translation for "test.missing"; falling back to English.',
      );
    } finally {
      warn.mockRestore();
    }
  });
});
