// Layout-level UX heuristics, evaluated inside the browser at the
// moment a screenshot is captured. Eight signals:
//
//   1. overflow      — any element whose right edge extends past the
//                      viewport width (broken responsive layout).
//   2. overlap       — pairs of visible, non-ancestor elements whose
//                      bounding boxes intersect and which aren't an
//                      intentional stack (modals, popovers).
//   3. whitespaceGap — outsized vertical gaps between top-level page
//                      sections (uneven whitespace distribution).
//   4. wrap          — short labels (≤ 40 chars) inside button / label
//                      / heading / chip-style containers that render
//                      across more than one line. Catches mid-word
//                      breaks like "Warm-" / "up" that overflow stays
//                      blind to. (Audit F11.)
//   5. ellipsis      — text-overflow:ellipsis nodes whose scrollWidth
//                      exceeds clientWidth — labels truncated to "…".
//   6. clipping      — text whose bounding rect extends past the
//                      nearest ancestor with overflow:hidden/clip.
//                      Catches "10 km" bleeding into the − button.
//   7. tapTarget     — interactive elements smaller than 44×44 px on
//                      a phone viewport (Apple HIG minimum tap size).
//   8. belowFold     — interactive elements whose bbox top sits below
//                      the captured viewport bottom — undiscoverable
//                      without scroll-affordance hint.
//
// The contract with the audit AI (see SKILL.md): every non-empty
// finding array MUST be addressed in the findings doc — either as an
// F-item or as an explicit "Dropped as false positive: <reason>" line.
//
// Each call writes `<png>.layout.json` next to the screenshot so the
// human/AI critique pass can read both together.

import type { Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

export type OverflowFinding = {
  selector: string
  right: number
  viewportWidth: number
  overshootPx: number
}

export type OverlapFinding = {
  a: string
  b: string
  intersectPx: { w: number; h: number }
}

export type WhitespaceFinding = {
  betweenA: string
  betweenB: string
  gapPx: number
  medianPx: number
}

export type WrapFinding = {
  selector: string
  text: string
  lines: number
}

export type EllipsisFinding = {
  selector: string
  text: string
  scrollWidth: number
  clientWidth: number
}

export type ClippingFinding = {
  selector: string
  text: string
  /** Selector of the ancestor whose overflow:hidden/clip bounds the
   * descendant text. */
  clipper: string
  overshootPx: { right: number; bottom: number }
}

export type TapTargetFinding = {
  selector: string
  width: number
  height: number
  minPx: number
}

export type BelowFoldFinding = {
  selector: string
  /** Pixels below the viewport bottom — positive means clipped. */
  belowBy: number
}

export type LayoutReport = {
  url: string
  viewport: { w: number; h: number }
  docSize: { w: number; h: number }
  horizontalOverflow: boolean
  findings: {
    overflow: OverflowFinding[]
    overlap: OverlapFinding[]
    whitespace: WhitespaceFinding[]
    wrap: WrapFinding[]
    ellipsis: EllipsisFinding[]
    clipping: ClippingFinding[]
    tapTarget: TapTargetFinding[]
    belowFold: BelowFoldFinding[]
  }
}

// Evaluated inside the browser. Returns the raw findings; the caller
// adds the URL field and writes the file.
async function evaluateLayout(page: Page): Promise<Omit<LayoutReport, 'url'>> {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const docW = document.documentElement.scrollWidth
    const docH = document.documentElement.scrollHeight

    function selectorFor(el: Element): string {
      // Compact "<tag>.<first-class>[#id]" with up to two ancestor hops.
      // Avoid full path bloat — we just need the human reader to
      // recognise the element.
      function brief(e: Element): string {
        const tag = e.tagName.toLowerCase()
        const cls =
          typeof e.className === 'string' && e.className.trim()
            ? '.' + e.className.trim().split(/\s+/)[0]
            : ''
        const id = e.id ? '#' + e.id : ''
        const testid = (e as HTMLElement).dataset?.testid
        return testid ? `${tag}[data-testid="${testid}"]` : `${tag}${id}${cls}`
      }
      const path: string[] = []
      let cur: Element | null = el
      for (let i = 0; cur && i < 3; i++) {
        path.unshift(brief(cur))
        cur = cur.parentElement
      }
      return path.join(' > ')
    }

    function isVisible(el: Element): boolean {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return false
      const cs = window.getComputedStyle(el as HTMLElement)
      if (cs.visibility === 'hidden' || cs.display === 'none') return false
      if (parseFloat(cs.opacity || '1') === 0) return false
      return true
    }

    function isOverlay(el: Element): boolean {
      // Modals / popovers / overlays intentionally float above other
      // content; we exclude them from overlap analysis. Heuristic:
      // position:fixed/absolute AND role=dialog OR aria-modal OR a
      // class hint.
      const cs = window.getComputedStyle(el as HTMLElement)
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return false
      if (el.getAttribute('role') === 'dialog') return true
      if (el.getAttribute('aria-modal') === 'true') return true
      const cls = (el.className || '').toString()
      return /overlay|modal|sheet|popover|dropdown|toast|scrim/i.test(cls)
    }

    // ── 1. Horizontal overflow ────────────────────────────────────
    const overflow: OverflowFinding[] = []
    const all = Array.from(document.querySelectorAll('*'))
    for (const el of all) {
      if (!isVisible(el)) continue
      const r = el.getBoundingClientRect()
      const overshoot = r.right - vw
      // Allow 1px subpixel rounding. Anything more is a real overflow.
      if (overshoot > 1) {
        overflow.push({
          selector: selectorFor(el),
          right: Math.round(r.right),
          viewportWidth: vw,
          overshootPx: Math.round(overshoot),
        })
      }
    }
    // Collapse to the smallest set of culprits: drop entries whose
    // ancestor is already reported (the ancestor's overflow explains
    // the descendant's). Keeps the list short.
    const culprit: OverflowFinding[] = []
    for (const f of overflow) {
      const dominated = overflow.some(
        (g) =>
          g !== f &&
          g.overshootPx >= f.overshootPx &&
          // crude ancestor check by selector containment
          f.selector.startsWith(g.selector + ' > '),
      )
      if (!dominated) culprit.push(f)
    }

    // ── 2. Overlap between non-ancestor visible elements ──────────
    // To keep the N² scan tractable, only consider elements that
    // carry semantic weight: anything with text, role=button, or a
    // data-testid attribute. Roughly mirrors what a human notices.
    const candidates: Element[] = []
    for (const el of all) {
      if (!isVisible(el)) continue
      if (isOverlay(el)) continue
      const tag = el.tagName.toLowerCase()
      const hasText =
        Array.from(el.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim() !== '',
        )
      const isInteractive =
        tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea'
      const hasTestId = (el as HTMLElement).dataset?.testid != null
      if (hasText || isInteractive || hasTestId) candidates.push(el)
    }
    function isAncestor(a: Element, b: Element): boolean {
      return a !== b && a.contains(b)
    }
    const overlap: OverlapFinding[] = []
    const seen = new Set<string>()
    for (let i = 0; i < candidates.length; i++) {
      const ra = candidates[i].getBoundingClientRect()
      for (let j = i + 1; j < candidates.length; j++) {
        const A = candidates[i]
        const B = candidates[j]
        if (isAncestor(A, B) || isAncestor(B, A)) continue
        const rb = B.getBoundingClientRect()
        const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
        const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
        // Require a real overlap (both axes > 2px) — touching edges
        // are intentional grid layouts, not overlaps.
        if (ix > 2 && iy > 2) {
          const key = `${selectorFor(A)}|${selectorFor(B)}`
          if (seen.has(key)) continue
          seen.add(key)
          overlap.push({
            a: selectorFor(A),
            b: selectorFor(B),
            intersectPx: { w: Math.round(ix), h: Math.round(iy) },
          })
        }
      }
    }

    // ── 3. Uneven vertical whitespace between top-level sections ──
    // Walk the immediate visible children of <main> (or <body> if no
    // <main>) and measure the vertical gap between each consecutive
    // pair's bounding rects. Flag any gap > 3× the median.
    const root: Element | null = document.querySelector('main') ?? document.body
    const whitespace: WhitespaceFinding[] = []
    if (root) {
      const sections = (Array.from(root.children) as Element[]).filter(
        (el) => isVisible(el) && el.getBoundingClientRect().height > 4,
      )
      const gaps: { gap: number; a: Element; b: Element }[] = []
      for (let i = 0; i + 1 < sections.length; i++) {
        const a = sections[i].getBoundingClientRect()
        const b = sections[i + 1].getBoundingClientRect()
        const gap = Math.round(b.top - a.bottom)
        if (gap > 0) gaps.push({ gap, a: sections[i], b: sections[i + 1] })
      }
      if (gaps.length >= 2) {
        const sorted = [...gaps].map((g) => g.gap).sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]
        const threshold = Math.max(median * 3, median + 32)
        for (const g of gaps) {
          if (g.gap >= threshold) {
            whitespace.push({
              betweenA: selectorFor(g.a),
              betweenB: selectorFor(g.b),
              gapPx: g.gap,
              medianPx: median,
            })
          }
        }
      }
    }

    // ── 4. Wrap detection ─────────────────────────────────────────
    // Short label-class text rendering on > 1 line is almost always
    // unintentional (mid-word break, squeezed column). Long-form text
    // (<p>, prose, > 60 chars) is allowed to wrap freely.
    const WRAP_LABEL_TAGS = new Set([
      'button', 'a', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'span', 'li', 'th', 'td', 'caption', 'summary', 'legend',
    ])
    const WRAP_ALLOW_TAGS = new Set(['p', 'pre', 'article', 'blockquote'])
    const wrap: WrapFinding[] = []
    const wrapSeen = new Set<string>()
    for (const el of all) {
      if (!isVisible(el)) continue
      const tag = el.tagName.toLowerCase()
      if (WRAP_ALLOW_TAGS.has(tag)) continue
      // The wrap signal lives at the text-node level. Walk this
      // element's immediate text children and Range-measure them.
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType !== Node.TEXT_NODE) continue
        const text = (node.textContent || '').trim()
        if (text.length === 0 || text.length > 40) continue
        // Only flag inside container types that should be single-line
        // by convention. Bare text inside a div is too noisy.
        if (!WRAP_LABEL_TAGS.has(tag) && !el.hasAttribute('role')) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        const rects = range.getClientRects()
        // Count distinct lines by collapsing rects with similar top.
        const tops = new Set<number>()
        for (const r of Array.from(rects)) {
          if (r.width < 1 || r.height < 1) continue
          tops.add(Math.round(r.top / 4))
        }
        if (tops.size <= 1) continue
        const sel = selectorFor(el)
        const key = `${sel}|${text}`
        if (wrapSeen.has(key)) continue
        wrapSeen.add(key)
        wrap.push({ selector: sel, text, lines: tops.size })
      }
    }

    // ── 5. Ellipsis truncation ────────────────────────────────────
    const ellipsis: EllipsisFinding[] = []
    for (const el of all) {
      if (!isVisible(el)) continue
      const cs = window.getComputedStyle(el as HTMLElement)
      if (cs.textOverflow !== 'ellipsis') continue
      // Only flag if the content actually overflows. Some elements
      // declare ellipsis defensively and are never truncated.
      const e = el as HTMLElement
      if (e.scrollWidth <= e.clientWidth + 1) continue
      ellipsis.push({
        selector: selectorFor(el),
        text: (el.textContent || '').trim().slice(0, 60),
        scrollWidth: e.scrollWidth,
        clientWidth: e.clientWidth,
      })
    }

    // ── 6. Clipping ───────────────────────────────────────────────
    // For each visible text-bearing element, find the nearest ancestor
    // that clips (overflow !== visible). Flag if the descendant's
    // bbox extends past that ancestor's clip bounds.
    const clipping: ClippingFinding[] = []
    const clipSeen = new Set<string>()
    function nearestClipper(el: Element): Element | null {
      let cur = el.parentElement
      while (cur) {
        const cs = window.getComputedStyle(cur)
        if (cs.overflowX === 'hidden' || cs.overflowX === 'clip'
          || cs.overflowY === 'hidden' || cs.overflowY === 'clip') {
          return cur
        }
        cur = cur.parentElement
      }
      return null
    }
    for (const el of all) {
      if (!isVisible(el)) continue
      const txt = (el.textContent || '').trim()
      if (txt.length === 0) continue
      // Only consider elements whose own content is text (not just
      // descendant text). Mirror the wrap pass.
      const ownsText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim() !== '',
      )
      if (!ownsText) continue
      const clip = nearestClipper(el)
      if (!clip) continue
      const r = el.getBoundingClientRect()
      const cr = clip.getBoundingClientRect()
      const overRight = Math.round(r.right - cr.right)
      const overBottom = Math.round(r.bottom - cr.bottom)
      // Allow 1px subpixel rounding.
      if (overRight <= 1 && overBottom <= 1) continue
      const sel = selectorFor(el)
      if (clipSeen.has(sel)) continue
      clipSeen.add(sel)
      clipping.push({
        selector: sel,
        text: txt.slice(0, 40),
        clipper: selectorFor(clip),
        overshootPx: {
          right: Math.max(0, overRight),
          bottom: Math.max(0, overBottom),
        },
      })
    }

    // ── 7. Tap-target size ────────────────────────────────────────
    // 44 px is the long-standing iOS HIG minimum, widely adopted as
    // the cross-platform "thumb-reachable" baseline. Only enforce on
    // phone-sized viewports — tablet pointing is more forgiving.
    const tapTarget: TapTargetFinding[] = []
    const tapSeen = new Set<string>()
    const TAP_MIN = 44
    if (vw <= 600) {
      for (const el of all) {
        if (!isVisible(el)) continue
        const tag = el.tagName.toLowerCase()
        const role = el.getAttribute('role')
        const interactive =
          tag === 'button' || tag === 'a' ||
          (tag === 'input' && (el as HTMLInputElement).type !== 'hidden') ||
          role === 'button' || role === 'tab' || role === 'link' ||
          role === 'checkbox' || role === 'radio' || role === 'menuitem'
        if (!interactive) continue
        // A native <input> wrapped in a <label> inherits the label's
        // tap area — measure the enclosing label instead. Common for
        // checkbox / radio rows.
        let measure: Element = el
        if (tag === 'input') {
          const lbl = el.closest('label')
          if (lbl) measure = lbl
        }
        const r = measure.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) continue
        if (r.width >= TAP_MIN && r.height >= TAP_MIN) continue
        // Dedupe by selector — repeated stepper buttons inside the same
        // page should surface once, not N times.
        const sel = selectorFor(measure)
        if (tapSeen.has(sel)) continue
        tapSeen.add(sel)
        tapTarget.push({
          selector: sel,
          width: Math.round(r.width),
          height: Math.round(r.height),
          minPx: TAP_MIN,
        })
      }
    }

    // ── 8. Below-fold interactive elements ────────────────────────
    // Anything tappable whose bbox top is below the visible viewport
    // bottom is undiscoverable without a scroll-affordance hint.
    // Includes elements that begin below the fold OR begin near the
    // bottom edge and are partially clipped.
    const belowFold: BelowFoldFinding[] = []
    for (const el of all) {
      if (!isVisible(el)) continue
      const tag = el.tagName.toLowerCase()
      const role = el.getAttribute('role')
      const interactive =
        tag === 'button' || tag === 'a' ||
        (tag === 'input' && (el as HTMLInputElement).type !== 'hidden') ||
        role === 'button' || role === 'tab' || role === 'link'
      if (!interactive) continue
      const r = el.getBoundingClientRect()
      if (r.top >= vh) {
        belowFold.push({
          selector: selectorFor(el),
          belowBy: Math.round(r.top - vh),
        })
      }
    }

    return {
      viewport: { w: vw, h: vh },
      docSize: { w: docW, h: docH },
      horizontalOverflow: docW > vw + 1,
      findings: {
        overflow: culprit,
        overlap,
        whitespace,
        wrap,
        ellipsis,
        clipping,
        tapTarget,
        belowFold,
      },
    }
  })
}

/** Capture a layout report and write it as `<pngPath>.layout.json`. */
export async function captureLayout(page: Page, pngPath: string): Promise<LayoutReport> {
  const partial = await evaluateLayout(page)
  const report: LayoutReport = { url: page.url(), ...partial }
  // The PNG path is relative to the project root (e.g.
  // "../test-results/…"); rewrite to "…/foo.png" → "…/foo.layout.json".
  const sidecar = pngPath.replace(/\.png$/, '.layout.json')
  await writeFile(sidecar, JSON.stringify(report, null, 2) + '\n', 'utf8')
  return report
}
