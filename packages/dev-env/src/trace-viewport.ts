// The window `cw verify browser start` opens and `cw verify trace` measures at, apart from the
// trace code so starting a browser doesn't load it.

export type Viewport = { width: number; height: number };

/** The window every trace is taken at: CLS is a share of the viewport, so it moves with the size. */
export const TRACE_VIEWPORT: Viewport = { width: 1280, height: 800 };
