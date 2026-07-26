import { useEffect, useRef, useState } from 'react'

// Viewport diagnostics overlay, opened with ?diag=1 (or #diag) on the game screen.
// It exists because the interesting moment is mid-gesture — while the browser is
// animating its chrome — and nobody can screenshot mid-drag. So every reading also
// carries the extreme seen since load: drag the page around, then read the "worst"
// column. A non-zero worst gap or scroll is the bug, in numbers.
type Row = { label: string; now: string; worst?: string }

const px = (n: number) => `${Math.round(n)}`

export function Diag() {
  const [rows, setRows] = useState<Row[]>([])
  const worst = useRef({ scroll: 0, gap: 0, headerOff: 0, vvMin: Infinity, vvMax: 0, ihMin: Infinity, ihMax: 0 })

  useEffect(() => {
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
    document.body.appendChild(probe)

    let raf = 0
    const tick = () => {
      const vv = window.visualViewport
      const root = document.documentElement
      const game = document.querySelector('.game')
      const footer = document.querySelector('footer.youredge') ?? document.querySelector('.reveal-main')
      const header = document.querySelector('.chrome')
      const visible = vv ? vv.height : window.innerHeight
      const footerBottom = footer ? footer.getBoundingClientRect().bottom : 0
      const headerTop = header ? header.getBoundingClientRect().top : 0
      const gap = visible - footerBottom
      const w = worst.current
      w.scroll = Math.max(w.scroll, Math.abs(window.scrollY))
      w.gap = Math.max(w.gap, gap)
      w.headerOff = Math.max(w.headerOff, -headerTop)
      w.vvMin = Math.min(w.vvMin, visible)
      w.vvMax = Math.max(w.vvMax, visible)
      w.ihMin = Math.min(w.ihMin, window.innerHeight)
      w.ihMax = Math.max(w.ihMax, window.innerHeight)
      const cs = getComputedStyle(root)
      const bs = getComputedStyle(document.body)
      const ps = getComputedStyle(probe)

      setRows([
        { label: 'gap below footer', now: px(gap), worst: px(w.gap) },
        { label: 'header top', now: px(headerTop), worst: `-${px(w.headerOff)}` },
        { label: 'window.scrollY', now: px(window.scrollY), worst: px(w.scroll) },
        { label: 'visualViewport h', now: vv ? px(vv.height) : 'n/a', worst: `${px(w.vvMin)}..${px(w.vvMax)}` },
        { label: 'innerHeight', now: px(window.innerHeight), worst: `${px(w.ihMin)}..${px(w.ihMax)}` },
        { label: 'vv offsetTop / scale', now: vv ? `${px(vv.offsetTop)} / ${vv.scale.toFixed(2)}` : 'n/a' },
        { label: '--app-h', now: cs.getPropertyValue('--app-h').trim() || '(unset)' },
        { label: 'html h / overflow', now: `${cs.height} / ${cs.overflowY}` },
        { label: 'body h / overflow', now: `${bs.height} / ${bs.overflowY}` },
        { label: 'overscroll html', now: cs.overscrollBehaviorY },
        { label: '.game h', now: game ? px(game.getBoundingClientRect().height) : 'n/a' },
        { label: 'doc scrollHeight', now: px(root.scrollHeight) },
        { label: 'safe-area t/r/b/l', now: [ps.paddingTop, ps.paddingRight, ps.paddingBottom, ps.paddingLeft].join(' ') },
        {
          label: 'supports',
          now: [
            CSS.supports('height', '100dvh') ? 'dvh' : '!dvh',
            CSS.supports('selector(:has(*))') ? 'has' : '!has',
            CSS.supports('overflow', 'clip') ? 'clip' : '!clip',
            CSS.supports('overscroll-behavior', 'none') ? 'osb' : '!osb',
          ].join(' '),
        },
      ])
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); probe.remove() }
  }, [])

  return (
    <div className="diag" role="status">
      <div className="diag-head">viewport diag · now / worst</div>
      {rows.map((r) => (
        <div key={r.label} className="diag-row">
          <span className="diag-k">{r.label}</span>
          <span className="diag-v">{r.now}</span>
          <span className="diag-w">{r.worst ?? ''}</span>
        </div>
      ))}
    </div>
  )
}

// Query param only — the app routes on the hash, so a #diag flag would collide
// with it. Reach it as https://host/?diag=1 (the hash route survives alongside).
export const diagRequested = () => new URLSearchParams(location.search).has('diag')
