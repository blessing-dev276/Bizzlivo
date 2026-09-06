import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NetworkNode } from '../../lib/network'
import { initialsOf } from '../../lib/network'
import { useRegisterTreeControls } from './treeControls'

const NODE_W = 176
const NODE_H = 68
const H_GAP = 22
const V_GAP = 66

interface Placed {
  node: NetworkNode
  x: number // top-left
  y: number
  cx: number // centre x
}

interface Layout {
  placed: Placed[]
  edges: { id: string; x1: number; y1: number; x2: number; y2: number }[]
  width: number
  height: number
}

function computeLayout(root: NetworkNode, collapsed: Set<string>): Layout {
  const placed: Placed[] = []
  const edges: Layout['edges'] = []

  function subtreeWidth(node: NetworkNode): number {
    const kids = collapsed.has(node.person.id) ? [] : node.children
    if (kids.length === 0) return NODE_W
    return kids.reduce((sum, k) => sum + subtreeWidth(k), 0) + H_GAP * (kids.length - 1)
  }

  function place(node: NetworkNode, left: number, depth: number): number {
    const y = depth * (NODE_H + V_GAP)
    const kids = collapsed.has(node.person.id) ? [] : node.children
    let cx: number

    if (kids.length === 0) {
      cx = left + NODE_W / 2
    } else {
      let cursor = left
      const childCentres: number[] = []
      for (const k of kids) {
        const w = subtreeWidth(k)
        const childCx = place(k, cursor, depth + 1)
        childCentres.push(childCx)
        cursor += w + H_GAP
      }
      cx = (childCentres[0] + childCentres[childCentres.length - 1]) / 2
      for (const childCx of childCentres) {
        edges.push({
          id: `${node.person.id}-${childCx}`,
          x1: cx,
          y1: y + NODE_H,
          x2: childCx,
          y2: y + NODE_H + V_GAP,
        })
      }
    }

    placed.push({ node, x: cx - NODE_W / 2, y, cx })
    return cx
  }

  place(root, 0, 0)

  const minX = Math.min(...placed.map((p) => p.x))
  const maxX = Math.max(...placed.map((p) => p.x + NODE_W))
  const maxY = Math.max(...placed.map((p) => p.y + NODE_H))
  // shift so nothing is negative
  const dx = -minX + 20
  for (const p of placed) {
    p.x += dx
    p.cx += dx
  }
  for (const e of edges) {
    e.x1 += dx
    e.x2 += dx
  }
  return { placed, edges, width: maxX - minX + 40, height: maxY + 20 }
}

interface Props {
  root: NetworkNode
  collapsed: Set<string>
  onToggleCollapse: (id: string) => void
  onSelect: (node: NetworkNode) => void
  focusId: string | null
  selfId: string
}

export default function NetworkTree({
  root,
  collapsed,
  onToggleCollapse,
  onSelect,
  focusId,
  selfId,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchDist = useRef<number | null>(null)

  const layout = useMemo(() => computeLayout(root, collapsed), [root, collapsed])

  const fit = useCallback(() => {
    const vp = viewportRef.current
    if (!vp) return
    const pad = 32
    const k = Math.min(
      1,
      (vp.clientWidth - pad) / layout.width,
      (vp.clientHeight - pad) / layout.height,
    )
    setTransform({
      x: (vp.clientWidth - layout.width * k) / 2,
      y: 24,
      k: Math.max(0.25, k),
    })
  }, [layout.width, layout.height])

  const centreOn = useCallback(
    (id: string) => {
      const vp = viewportRef.current
      const p = layout.placed.find((pl) => pl.node.person.id === id)
      if (!vp || !p) return
      setTransform((t) => ({
        ...t,
        x: vp.clientWidth / 2 - (p.x + NODE_W / 2) * t.k,
        y: vp.clientHeight / 2 - (p.y + NODE_H / 2) * t.k,
      }))
    },
    [layout.placed],
  )

  const zoomBy = useCallback((factor: number) => {
    setTransform((t) => ({ ...t, k: Math.min(2, Math.max(0.25, t.k * factor)) }))
  }, [])

  // fit once on first layout
  const didFit = useRef(false)
  useEffect(() => {
    if (didFit.current) return
    didFit.current = true
    fit()
  }, [fit])

  useEffect(() => {
    if (focusId) centreOn(focusId)
  }, [focusId, centreOn])

  const handle = useMemo(() => ({ fit, centreOn, zoomBy }), [fit, centreOn, zoomBy])
  useRegisterTreeControls(handle)

  function onPointerDown(e: React.PointerEvent) {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) {
      drag.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: transform.x,
        origY: transform.y,
      }
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchDist.current != null) {
        zoomBy(dist / pinchDist.current)
      }
      pinchDist.current = dist
      return
    }

    if (drag.current) {
      setTransform((t) => ({
        ...t,
        x: drag.current!.origX + (e.clientX - drag.current!.startX),
        y: drag.current!.origY + (e.clientY - drag.current!.startY),
      }))
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchDist.current = null
    if (pointers.current.size === 0) drag.current = null
  }

  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey && Math.abs(e.deltaY) < 30 && e.deltaX !== 0) return
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 1.1 : 0.9)
  }

  return (
    <div
      ref={viewportRef}
      className="net-viewport"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <div
        className="net-canvas"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
          width: layout.width,
          height: layout.height,
        }}
      >
        <svg className="net-edges" width={layout.width} height={layout.height}>
          {layout.edges.map((e) => {
            const midY = (e.y1 + e.y2) / 2
            return (
              <path
                key={e.id}
                d={`M ${e.x1} ${e.y1} V ${midY} H ${e.x2} V ${e.y2}`}
                className="net-edge"
                fill="none"
              />
            )
          })}
        </svg>

        {layout.placed.map(({ node, x, y }) => {
          const p = node.person
          const isSelf = p.id === selfId
          const hasKids = node.children.length > 0
          const isCollapsed = collapsed.has(p.id)
          return (
            <div
              key={p.id}
              className={`net-node${isSelf ? ' self' : ''}${p.active ? '' : ' removed'}${
                focusId === p.id ? ' focus' : ''
              }`}
              style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
              onClick={() => onSelect(node)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelect(node)
              }}
            >
              <span className="net-node-avatar" aria-hidden>
                {p.avatarUrl ? <img src={p.avatarUrl} alt="" /> : initialsOf(p.fullName)}
              </span>
              <span className="net-node-main">
                <span className="net-node-name">
                  {isSelf ? 'You' : p.fullName}
                </span>
                <span className="net-node-sub">
                  {p.rankName ?? (isSelf ? 'Your position' : 'Member')}
                  <span
                    className={`net-dot ${p.active ? 'ok' : 'off'}`}
                    title={p.active ? 'Active' : 'Removed'}
                  />
                </span>
              </span>
              {hasKids && (
                <button
                  type="button"
                  className="net-node-toggle"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleCollapse(p.id)
                  }}
                  aria-label={isCollapsed ? 'Expand branch' : 'Collapse branch'}
                >
                  {isCollapsed ? `+${node.totalCount}` : '−'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
