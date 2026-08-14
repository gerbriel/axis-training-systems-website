const base = ((import.meta as any).env?.BASE_URL ?? '/').replace(/\/$/, '')

export function href(path: string) {
  return `${base}${path}`
}

// Encoded, like bookCoachHref already was. A slug is a database value on the
// testimonial and content paths, not only a constant off the static roster, and
// an unencoded one carrying `?`, `#` or `..` builds a different URL than the
// one intended. Real slugs are [a-z-], which encodeURIComponent leaves alone.
export function coachHref(slug: string) {
  return href(`/coaches/${encodeURIComponent(slug)}`)
}

export function applyHref(slug: string) {
  return href(`/apply/${encodeURIComponent(slug)}`)
}

export function adminHref(slug?: string) {
  return slug ? href(`/admin/${encodeURIComponent(slug)}`) : href('/admin')
}

export function bookHref() {
  return href('/book')
}

export function bookCoachHref(slug: string) {
  return href(`/book?coach=${encodeURIComponent(slug)}`)
}

export function messagesHref() {
  return href('/messages')
}
