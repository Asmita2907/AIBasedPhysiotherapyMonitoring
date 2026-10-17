export const pct = (n: number) => `${Math.round(n * 100)}%`

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
