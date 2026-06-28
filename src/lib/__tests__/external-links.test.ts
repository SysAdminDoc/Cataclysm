import { describe, expect, it } from "vitest";
import capability from "../../../src-tauri/capabilities/default.json";
import { listDemoPresets } from "../demo";
import {
  CITATION_LEGACY_HTTP_EXCEPTIONS,
  TRUSTED_EXTERNAL_URLS,
  validateCitationUrl,
  validateTrustedExternalUrl,
} from "../external-links";

type ShellOpenPermission = {
  allow: Array<{ url: string }>;
  identifier: string;
};

function isShellOpenPermission(value: unknown): value is ShellOpenPermission {
  return (
    typeof value === "object" &&
    value !== null &&
    "identifier" in value &&
    (value as { identifier?: unknown }).identifier === "shell:allow-open" &&
    "allow" in value &&
    Array.isArray((value as { allow?: unknown }).allow)
  );
}

describe("external link policy", () => {
  it("allows shipped citation URLs and documents legacy HTTP exceptions", () => {
    for (const preset of listDemoPresets()) {
      const validation = validateCitationUrl(preset.reference_url);
      expect(validation, `${preset.id} reference URL should be allowed`).toMatchObject({ ok: true });
    }

    expect(CITATION_LEGACY_HTTP_EXCEPTIONS).toEqual([
      expect.objectContaining({
        reason: expect.stringMatching(/no HTTPS mirror/i),
        url: "http://library.lanl.gov/tsunami/ts193.pdf",
      }),
      expect.objectContaining({
        reason: expect.stringMatching(/no HTTPS mirror/i),
        url: "http://www.tsunamisociety.org/213choi.pdf",
      }),
    ]);
  });

  it("rejects broad hosts, mutated paths, and unsupported schemes", () => {
    expect(validateCitationUrl("https://www.science.org/")).toMatchObject({ ok: false });
    expect(validateCitationUrl("https://doi.org/10.1029/2021AV000627?utm_source=test")).toMatchObject({
      ok: false,
    });
    expect(validateCitationUrl("http://library.lanl.gov/")).toMatchObject({ ok: false });
    expect(validateCitationUrl("javascript:alert(1)")).toMatchObject({ ok: false });
    expect(validateTrustedExternalUrl("https://cesium.com/ion/signup")).toMatchObject({ ok: true });
  });

  it("keeps the Tauri shell-open capability synced to exact vetted URLs", () => {
    const shellPermission = capability.permissions.find(isShellOpenPermission);

    expect(shellPermission, "default capability must declare shell:allow-open").toBeDefined();
    const capabilityUrls = shellPermission?.allow.map((entry) => entry.url).sort() ?? [];

    expect(capabilityUrls).toEqual([...TRUSTED_EXTERNAL_URLS].sort());
    expect(capabilityUrls.every((url) => !url.includes("*"))).toBe(true);
  });
});
