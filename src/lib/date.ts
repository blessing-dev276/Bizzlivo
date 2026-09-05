// Calendar-day string in the viewer's local timezone — Date#toISOString()
// uses UTC, which can land on the wrong day near midnight local time.
export function localDateString(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
