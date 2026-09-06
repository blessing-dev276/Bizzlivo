// Small stroke icons for the admin dashboard. All inherit currentColor,
// 24x24 viewBox, no fill.
type P = { className?: string }
const s = (className?: string) => ({ viewBox: '0 0 24 24', className, 'aria-hidden': true } as const)

export const IcUsers = ({ className }: P) => (
  <svg {...s(className)}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
)
export const IcPulse = ({ className }: P) => (
  <svg {...s(className)}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
)
export const IcBook = ({ className }: P) => (
  <svg {...s(className)}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
)
export const IcExam = ({ className }: P) => (
  <svg {...s(className)}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M9 15l2 2 4-4" /></svg>
)
export const IcCheck = ({ className }: P) => (
  <svg {...s(className)}><polyline points="20 6 9 17 4 12" /></svg>
)
export const IcArrowRight = ({ className }: P) => (
  <svg {...s(className)}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
)
export const IcInvite = ({ className }: P) => (
  <svg {...s(className)}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
)
export const IcUpload = ({ className }: P) => (
  <svg {...s(className)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
)
export const IcFilePlus = ({ className }: P) => (
  <svg {...s(className)}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="12" x2="12" y2="18" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
)
export const IcClipboard = ({ className }: P) => (
  <svg {...s(className)}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></svg>
)
export const IcCalendar = ({ className }: P) => (
  <svg {...s(className)}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
)
export const IcChart = ({ className }: P) => (
  <svg {...s(className)}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
)
export const IcReport = ({ className }: P) => (
  <svg {...s(className)}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
)
export const IcSpark = ({ className }: P) => (
  <svg {...s(className)}><path d="M12 3l1.9 5.5L19 10l-5.1 1.5L12 17l-1.9-5.5L5 10l5.1-1.5z" /></svg>
)
export const IcTeam = ({ className }: P) => (
  <svg {...s(className)}><circle cx="12" cy="5" r="2.6" /><circle cx="5" cy="19" r="2.6" /><circle cx="19" cy="19" r="2.6" /><path d="M12 7.6v4M12 11.6 6.6 17M12 11.6 17.4 17" /></svg>
)
export const IcClock = ({ className }: P) => (
  <svg {...s(className)}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 16 14" /></svg>
)
