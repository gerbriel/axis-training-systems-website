export interface NewsletterLead {
  id: string
  firstName: string
  lastName: string
  email: string
  source: string
  createdAt: string
}

export interface NewsletterAccess {
  email: string
  firstName: string
  source: string
  signedUpAt: string
}
