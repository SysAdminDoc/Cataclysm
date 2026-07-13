import { describe, expect, it } from "vitest";
import { waitForRenderReplay } from "../tauri";

describe("desktop render-channel completion", () => {
  it("waits for channel packets that arrive after the command result", async () => {
    const replay = { complete: false, frame_count: 0 };
    let chain = Promise.resolve();
    setTimeout(() => {
      chain = chain.then(async () => {
        replay.frame_count = 60;
        replay.complete = true;
      });
    }, 12);

    await expect(
      waitForRenderReplay(replay, 60, () => chain, () => null, 250),
    ).resolves.toBeUndefined();
  });

  it("fails immediately for decoder errors and completed count mismatches", async () => {
    const decoderError = new Error("bad render packet");
    await expect(
      waitForRenderReplay(
        { complete: false, frame_count: 0 },
        60,
        () => Promise.resolve(),
        () => decoderError,
        250,
      ),
    ).rejects.toBe(decoderError);
    await expect(
      waitForRenderReplay(
        { complete: true, frame_count: 59 },
        60,
        () => Promise.resolve(),
        () => null,
        250,
      ),
    ).rejects.toThrow("completed with 59 frames; expected 60");
  });

  it("times out when a channel never produces its end packet", async () => {
    await expect(
      waitForRenderReplay(
        { complete: false, frame_count: 0 },
        60,
        () => Promise.resolve(),
        () => null,
        1,
      ),
    ).rejects.toThrow("timed out waiting for the backend render stream");
  });
});
