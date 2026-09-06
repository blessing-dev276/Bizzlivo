import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

interface Props {
  url: string
  heightPx?: number
  // Fires once, when the reader has scrolled to the last page (or the whole
  // document fits on screen without scrolling).
  onReachedEnd?: () => void
}

// Renders a PDF inline (no new tab, no browser PDF plugin) into a scroll
// container we control, so "scrolled to the bottom" is actually detectable.
export default function PdfViewer({ url, heightPx = 460, onReachedEnd }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const reachedRef = useRef(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState<string | null>(null)

  function checkEnd() {
    const el = scrollRef.current
    if (!el || reachedRef.current) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 28) {
      reachedRef.current = true
      onReachedEnd?.()
    }
  }

  useEffect(() => {
    let cancelled = false
    let doc: PDFDocumentProxy | null = null
    reachedRef.current = false
    setStatus('loading')
    setErrMsg(null)

    async function render() {
      try {
        doc = await pdfjsLib.getDocument({ url }).promise
        const host = pagesRef.current
        if (cancelled || !host) return
        host.replaceChildren()

        const containerWidth = scrollRef.current?.clientWidth ?? 640
        const dpr = window.devicePixelRatio || 1

        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n)
          if (cancelled) return
          const base = page.getViewport({ scale: 1 })
          const scale = Math.min(2, Math.max(0.4, (containerWidth - 24) / base.width))
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.className = 'pdfv-page'
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          canvas.style.width = `${Math.floor(viewport.width)}px`
          canvas.style.height = `${Math.floor(viewport.height)}px`
          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          ctx.scale(dpr, dpr)
          host.appendChild(canvas)
          await page.render({ canvasContext: ctx, viewport }).promise
        }

        if (cancelled) return
        setStatus('ready')
        requestAnimationFrame(checkEnd)
      } catch (e) {
        if (cancelled) return
        setErrMsg(e instanceof Error ? e.message : 'Could not load this PDF.')
        setStatus('error')
      }
    }

    render()
    return () => {
      cancelled = true
      doc?.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  return (
    <div className="pdfv">
      {status === 'loading' && <div className="pdfv-note">Loading PDF…</div>}
      {status === 'error' && <div className="pdfv-note pdfv-error">{errMsg}</div>}
      <div
        ref={scrollRef}
        className="pdfv-scroll"
        style={{ height: heightPx, display: status === 'ready' ? 'block' : 'none' }}
        onScroll={checkEnd}
      >
        <div ref={pagesRef} className="pdfv-pages" />
      </div>
    </div>
  )
}
