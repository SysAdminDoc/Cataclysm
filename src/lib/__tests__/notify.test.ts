import { beforeEach, describe, expect, it, vi } from "vitest";

const notification = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("../tauri", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/plugin-notification", () => notification);

import { isWindowUnfocused, notifyRunComplete } from "../notify";

describe("solver completion notifications", () => {
  beforeEach(() => {
    notification.isPermissionGranted.mockReset().mockResolvedValue(true);
    notification.requestPermission.mockReset().mockResolvedValue("granted");
    notification.sendNotification.mockReset();
  });

  it("sends a local notification only when enabled and unfocused", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    expect(isWindowUnfocused()).toBe(true);
    await notifyRunComplete("Cataclysm", "Simulation run finished.", true);

    expect(notification.sendNotification).toHaveBeenCalledWith({
      title: "Cataclysm",
      body: "Simulation run finished.",
    });
  });

  it("does not request permission when disabled or focused", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus");
    hasFocus.mockReturnValue(false);
    await notifyRunComplete("Cataclysm", "ignored", false);
    hasFocus.mockReturnValue(true);
    await notifyRunComplete("Cataclysm", "ignored", true);

    expect(notification.requestPermission).not.toHaveBeenCalled();
    expect(notification.sendNotification).not.toHaveBeenCalled();
  });
});
