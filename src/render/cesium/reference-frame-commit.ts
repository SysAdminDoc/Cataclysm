export type ReferenceFrameCommitHost = {
  render: () => void;
  scene: { requestRender: () => void };
};

/**
 * Commit a reference frame through the full Viewer render path. Calling
 * Scene.render directly skips CesiumWidget's clock tick and therefore skips
 * DataSourceDisplay.update(), leaving newly reconciled Entity graphics stale.
 */
export function commitReferenceFrame(
  viewer: ReferenceFrameCommitHost,
  root: HTMLElement,
  identity: string,
): () => void {
  delete root.dataset.referenceDirectFrameCommitted;
  viewer.scene.requestRender();
  viewer.render();
  root.dataset.referenceDirectFrameCommitted = identity;
  return () => {
    if (root.dataset.referenceDirectFrameCommitted === identity) {
      delete root.dataset.referenceDirectFrameCommitted;
    }
  };
}
