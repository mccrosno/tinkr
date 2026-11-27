// How past chats are dated: "5 min ago" labels, and the Today / Yesterday / Earlier
// groups of the chat list.

/** "now", "3 min ago", "Yesterday", "12 Nov": short enough for a narrow panel. */
export function timeAgo(ms: number, now = Date.now()) {
  const minutes = Math.round((now - ms) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  const d = new Date(ms)
  const otherYear = d.getFullYear() !== new Date(now).getFullYear()
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(otherYear ? { year: 'numeric' } : {}) })
}

export type DayGroup = 'Today' | 'Yesterday' | 'Earlier'

/** The calendar day (local time) a time falls on, compared with now. */
export function dayGroup(ms: number, now = Date.now()): DayGroup {
  const today = new Date(now)
  // Built from date parts, so a 23 or 25 hour day (daylight saving) still counts as one day.
  const midnight = (daysBack: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBack).getTime()
  if (ms >= midnight(0)) return 'Today'
  return ms >= midnight(1) ? 'Yesterday' : 'Earlier'
}

/** Chats (newest first) split into the groups that have any, in order. */
export function groupByDay<T extends { lastModified: number }>(chats: T[], now = Date.now()) {
  const order: DayGroup[] = ['Today', 'Yesterday', 'Earlier']
  return order
    .map((label) => ({ label, chats: chats.filter((c) => dayGroup(c.lastModified, now) === label) }))
    .filter((g) => g.chats.length)
}
