ALTER TABLE users ADD COLUMN bio varchar(1000) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN avatar_url text;
ALTER TABLE users ADD COLUMN avatar_public_id text;
ALTER TABLE products ADD COLUMN moderation_status text NOT NULL DEFAULT 'pending'
  CHECK (moderation_status IN ('pending','approved','rejected'));
ALTER TABLE products ADD COLUMN moderation_reason varchar(2000) NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN reviewed_by uuid REFERENCES users(id);
ALTER TABLE products ADD COLUMN reviewed_at timestamptz;
ALTER TABLE products ADD COLUMN featured boolean NOT NULL DEFAULT false;
CREATE INDEX products_public_idx ON products(moderation_status,status,created_at DESC);
CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES users(id),
  title varchar(160) NOT NULL,
  body varchar(4000) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE categories ADD COLUMN active boolean NOT NULL DEFAULT true;
