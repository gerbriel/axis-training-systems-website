-- Newsletter / lead-magnet subscriber table
-- Run once in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS newsletter_leads (
  id         UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT    NOT NULL,
  last_name  TEXT    NOT NULL,
  email      TEXT    NOT NULL,
  source     TEXT    NOT NULL DEFAULT 'guides_page',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint prevents duplicate signups
ALTER TABLE newsletter_leads
  DROP CONSTRAINT IF EXISTS newsletter_leads_email_key;
ALTER TABLE newsletter_leads
  ADD  CONSTRAINT newsletter_leads_email_key UNIQUE (email);

-- Index for admin queries
CREATE INDEX IF NOT EXISTS idx_newsletter_leads_created_at
  ON newsletter_leads (created_at DESC);

-- RLS: only authenticated admins can read
ALTER TABLE newsletter_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can select newsletter_leads" ON newsletter_leads;
CREATE POLICY "Admins can select newsletter_leads"
  ON newsletter_leads FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Anyone can insert newsletter_leads" ON newsletter_leads;
CREATE POLICY "Anyone can insert newsletter_leads"
  ON newsletter_leads FOR INSERT
  WITH CHECK (true);
