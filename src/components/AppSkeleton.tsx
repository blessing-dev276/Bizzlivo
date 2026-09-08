// Shimmer placeholders — a sweeping gradient over content-shaped blocks.
// Every variant tries to echo the real page layout it's standing in for
// (list rows, a form column, a detail panel, a table, a split workspace)
// so the load state reads as "this page, arriving" rather than a generic box.

function Bar({ w = '100%', h = 14, r = 6, mt = 0, mb = 0 }: { w?: number | string; h?: number; r?: number; mt?: number; mb?: number }) {
  return <span className="sk" style={{ display: 'block', width: w, height: h, borderRadius: r, marginTop: mt, marginBottom: mb }} />
}
function Block({ h, mt = 0, r = 14 }: { h: number; mt?: number; r?: number }) {
  return <span className="sk" style={{ display: 'block', height: h, borderRadius: r, marginTop: mt }} />
}

export type SkeletonVariant = 'cards' | 'list' | 'form' | 'detail' | 'table' | 'split'

// Full app shell — before the layout itself has mounted (first load, session
// resolving).
export default function AppSkeleton() {
  return (
    <div className="app-skeleton" aria-busy="true" aria-label="Loading">
      <aside className="app-skeleton-side">
        <Bar w="60%" h={26} />
        <div className="app-skeleton-navs">
          {Array.from({ length: 9 }).map((_, i) => (
            <Bar key={i} w={`${70 + ((i * 7) % 25)}%`} h={14} />
          ))}
        </div>
        <span className="sk sk-line" style={{ width: '80%', height: 40, marginTop: 'auto' }} />
      </aside>
      <main className="app-skeleton-main">
        <PageSkeleton bare variant="cards" />
      </main>
    </div>
  )
}

function PageHead() {
  return (
    <div style={{ marginBottom: 22 }}>
      <Bar w={220} h={30} mb={10} />
      <Bar w={340} h={13} />
    </div>
  )
}

// Content area only — used inside <Layout> while a lazily-loaded route (or its
// data) resolves, so the sidebar / topbar stay put. `variant` picks the shape.
export function PageSkeleton({ bare = false, variant = 'cards' }: { bare?: boolean; variant?: SkeletonVariant }) {
  return (
    <div className={bare ? 'page-skeleton' : 'page page-skeleton'} aria-busy="true" aria-label="Loading">
      {variant === 'cards' && (
        <>
          <PageHead />
          <div className="app-skeleton-cards">
            {Array.from({ length: 6 }).map((_, i) => <Block key={i} h={118} />)}
          </div>
          <Block h={260} mt={18} />
        </>
      )}

      {variant === 'list' && (
        <>
          <div className="sk-row-between" style={{ marginBottom: 20 }}>
            <Bar w={200} h={30} />
            <Bar w={130} h={36} r={8} />
          </div>
          <Bar w={280} h={34} r={8} mb={18} />
          <div className="sk-stack">
            {Array.from({ length: 6 }).map((_, i) => <Block key={i} h={72} r={10} />)}
          </div>
        </>
      )}

      {variant === 'form' && (
        <div style={{ maxWidth: 560 }}>
          <Bar w={200} h={30} mb={22} />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ marginBottom: 18 }}>
              <Bar w={`${28 + (i % 3) * 8}%`} h={12} mb={7} />
              <Block h={i === 2 ? 88 : 40} r={8} />
            </div>
          ))}
          <Bar w={150} h={38} r={8} mt={6} />
        </div>
      )}

      {variant === 'detail' && (
        <div style={{ maxWidth: 640 }}>
          <Bar w={120} h={13} mb={16} />
          <Block h={220} r={16} />
          <Bar w={180} h={16} mt={24} mb={12} />
          <div className="sk-stack">
            {Array.from({ length: 4 }).map((_, i) => <Block key={i} h={56} r={10} />)}
          </div>
        </div>
      )}

      {variant === 'table' && (
        <>
          <PageHead />
          <div className="sk-row" style={{ gap: 8, marginBottom: 16 }}>
            {Array.from({ length: 4 }).map((_, i) => <Bar key={i} w={90} h={30} r={100} />)}
          </div>
          <Block h={44} r={10} />
          <div className="sk-stack" style={{ marginTop: 8 }}>
            {Array.from({ length: 8 }).map((_, i) => <Block key={i} h={40} r={8} />)}
          </div>
        </>
      )}

      {variant === 'split' && (
        <>
          <PageHead />
          <div className="sk-split">
            <div className="sk-stack">
              <Block h={140} />
              {Array.from({ length: 3 }).map((_, i) => <Block key={i} h={64} r={10} />)}
            </div>
            <div className="sk-stack">
              {Array.from({ length: 3 }).map((_, i) => <Block key={i} h={i === 0 ? 96 : 120} />)}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Dashboard-shaped: hero banner, a stepper strip, then a wide + narrow column.
export function DashboardSkeleton() {
  return (
    <div className="page cmd-deck page-skeleton" aria-busy="true" aria-label="Loading dashboard">
      <Block h={116} r={22} />
      <Block h={104} r={16} mt={16} />
      <div className="dash-skeleton-grid">
        <div className="dash-skeleton-main">
          <Block h={150} />
          {Array.from({ length: 4 }).map((_, i) => <Bar key={i} h={44} mt={10} />)}
        </div>
        <div className="dash-skeleton-side">
          {Array.from({ length: 4 }).map((_, i) => <Block key={i} h={i === 0 ? 96 : 120} />)}
        </div>
      </div>
      <Block h={200} mt={16} />
    </div>
  )
}
