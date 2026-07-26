// --app-h: the height of what the reader can actually see, in pixels.
//
// The game screen is a one-viewport app, and sizing it with 100dvh was not enough
// on a real phone: the footer still drifted off the bottom edge and the header
// still scrolled away. dvh is the right idea but it is the browser's account of
// the viewport, updated in steps as it animates its chrome; visualViewport.height
// is the measurement itself, reported continuously through the gesture. CSS keeps
// `100dvh` as the fallback value, so a browser without this script (or without
// visualViewport) lands exactly where it did before.
//
// Pinch-zoom also shrinks the visual viewport, and there the app must NOT follow —
// a zoomed-in reader wants to pan the same layout, not have it re-flow under them.
// Above 1x we fall back to innerHeight.
export function trackViewportHeight() {
  const vv = window.visualViewport
  const root = document.documentElement

  const apply = () => {
    const zoomed = vv ? vv.scale > 1.01 : false
    const h = vv && !zoomed ? vv.height : window.innerHeight
    // Round, don't floor: a fractional height leaves a hairline of page behind the
    // footer on fractional-DPR screens, which is the very seam this is closing.
    root.style.setProperty('--app-h', `${Math.round(h)}px`)
  }

  apply()
  // resize covers chrome show/hide, rotation and the keyboard; scroll covers the
  // visual viewport being panned (which is how a hidden chrome bar reports back on
  // some browsers). Both are cheap — one custom-property write.
  vv?.addEventListener('resize', apply)
  vv?.addEventListener('scroll', apply)
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
}
