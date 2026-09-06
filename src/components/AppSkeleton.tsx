// Shimmer placeholders (Fiverr-style) — a sweeping gradient over
// content-shaped blocks. All variants use the shared `.sk` class.

function Bar({ w = '100%', h = 14, r = 6, mt = 0, mb = 0 }: { w?: number | string; h?: number; r?: number; mt?: number; mb?: number }) {
  return <span className="sk" style={{ display: 'block', width: w, height: h, borderRadius: r, marginTop: mt, marginBottom: mb }} />
}

// Full app shell — used before the layout itself has mounted (first load,
// session resolving).
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
        <PageSkeleton bare />
      </main>
    </div>
  )
}

// Content area only — used inside <Layout> while a lazily-loaded route
// (or its data) resolves, so the sidebar/topbar stay put.
export function PageSkeleton({ bare = false }: { bare?: boolean }) {
  return (
    <div className={bare ? 'page-skeleton' : 'page page-skeleton'} aria-busy="true" aria-label="Loading">
      <Bar w={220} h={30} mb={22} />
      <div className="app-skeleton-cards">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="sk" style={{ height: 118, borderRadius: 14 }} />
        ))}
      </div>
      <span className="sk" style={{ display: 'block', height: 260, borderRadius: 14, marginTop: 18 }} />
    </div>
  )
}

// Dashboard-shaped: hero banner, a stepper strip, then a wide + narrow column.
export function DashboardSkeleton() {
  return (
    <div className="page cmd-deck page-skeleton" aria-busy="true" aria-label="Loading dashboard">
      <span className="sk" style={{ display: 'block', height: 116, borderRadius: 22 }} />
      <span className="sk" style={{ display: 'block', height: 104, borderRadius: 16, marginTop: 16 }} />
      <div className="dash-skeleton-grid">
        <div className="dash-skeleton-main">
          <span className="sk" style={{ display: 'block', height: 150, borderRadius: 14 }} />
          {Array.from({ length: 4 }).map((_, i) => (
            <Bar key={i} h={44} mt={10} />
          ))}
        </div>
        <div className="dash-skeleton-side">
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} className="sk" style={{ display: 'block', height: i === 0 ? 96 : 120, borderRadius: 14 }} />
          ))}
        </div>
      </div>
      <span className="sk" style={{ display: 'block', height: 200, borderRadius: 14, marginTop: 16 }} />
    </div>
  )
}
