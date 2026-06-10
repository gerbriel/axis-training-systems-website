const base = ((import.meta as any).env?.BASE_URL ?? '/').replace(/\/$/, '')

export function href(path: string) {
  return `${base}${path}`
}

export function coachHref(slug: string) {
  return href(`/coaches/${slug}`)
}

export function applyHref(slug: string) {
  return href(`/apply/${slug}`)
}

export function adminHref(slug?: string) {
  return slug ? href(`/admin/${slug}`) : href('/admin')
}
