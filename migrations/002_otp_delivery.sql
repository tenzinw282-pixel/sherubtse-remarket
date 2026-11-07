ALTER TABLE email_verifications ADD COLUMN delivered_at timestamptz;
CREATE INDEX email_verifications_rate_idx ON email_verifications(user_id, created_at DESC);
