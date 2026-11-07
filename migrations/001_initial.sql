CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name varchar(120) NOT NULL,
  email varchar(254) NOT NULL CHECK (email = lower(email)),
  student_id varchar(80),
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  email_verified_at timestamptz,
  affiliation_verified_at timestamptz,
  suspended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);
CREATE TABLE email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email varchar(254) NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('registration', 'email_change')),
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verifications_user_idx ON email_verifications(user_id, created_at DESC);
CREATE UNIQUE INDEX email_verifications_active_idx ON email_verifications(user_id, purpose) WHERE consumed_at IS NULL;
CREATE TABLE password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX password_resets_active_idx ON password_resets(user_id) WHERE consumed_at IS NULL;
CREATE TABLE sessions (sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp(6) NOT NULL);
CREATE INDEX sessions_expire_idx ON sessions(expire);
CREATE TABLE categories (id smallserial PRIMARY KEY, name varchar(80) NOT NULL UNIQUE);
INSERT INTO categories(name) VALUES ('Textbooks'), ('Electronics'), ('Clothing'), ('Bicycles'),
  ('Furniture'), ('Hostel Essentials'), ('Sports Equipment'), ('Stationery'), ('Other');
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES users(id),
  category_id smallint NOT NULL REFERENCES categories(id),
  title varchar(160) NOT NULL,
  description text NOT NULL,
  condition text NOT NULL CHECK (condition IN ('New', 'Like New', 'Good', 'Fair', 'Used')),
  selling_type text NOT NULL CHECK (selling_type IN ('fixed', 'auction')),
  price numeric(12,2) NOT NULL CHECK (price > 0),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'sold', 'removed', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_browse_idx ON products(status, created_at DESC);
CREATE INDEX products_category_price_idx ON products(category_id, price);
CREATE INDEX products_seller_idx ON products(seller_id);
CREATE INDEX products_search_idx ON products USING gin(to_tsvector('english', title || ' ' || description));
CREATE TABLE product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  public_id text NOT NULL UNIQUE,
  secure_url text NOT NULL CHECK (secure_url LIKE 'https://%'),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
  UNIQUE(product_id, position)
);
CREATE TABLE auctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL UNIQUE REFERENCES products(id),
  starting_price numeric(12,2) NOT NULL CHECK (starting_price > 0),
  minimum_increment numeric(12,2) NOT NULL CHECK (minimum_increment > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  highest_bid_id uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auctions_due_idx ON auctions(ends_at) WHERE status = 'open';
CREATE TABLE bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id uuid NOT NULL REFERENCES auctions(id),
  bidder_id uuid NOT NULL REFERENCES users(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(auction_id, id)
);
ALTER TABLE auctions ADD CONSTRAINT auctions_highest_bid_fk
  FOREIGN KEY (id, highest_bid_id) REFERENCES bids(auction_id, id);
CREATE INDEX bids_history_idx ON bids(auction_id, created_at DESC);
CREATE INDEX bids_bidder_idx ON bids(bidder_id);
CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  auction_id uuid UNIQUE REFERENCES auctions(id),
  buyer_id uuid NOT NULL REFERENCES users(id),
  seller_id uuid NOT NULL REFERENCES users(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reserved', 'completed', 'cancelled', 'disputed')),
  seller_handover_at timestamptz,
  buyer_received_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_id <> seller_id),
  CHECK (status <> 'completed' OR (seller_handover_at IS NOT NULL AND buyer_received_at IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX transactions_product_active_idx ON transactions(product_id) WHERE status <> 'cancelled';
CREATE INDEX transactions_buyer_idx ON transactions(buyer_id, created_at DESC);
CREATE INDEX transactions_seller_idx ON transactions(seller_id, created_at DESC);
CREATE TABLE favorites (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, product_id)
);
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id),
  author_id uuid NOT NULL REFERENCES users(id),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment varchar(2000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(transaction_id, author_id)
);
CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  reporter_id uuid NOT NULL REFERENCES users(id),
  reason varchar(2000) NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX reports_status_idx ON reports(status, created_at DESC);
CREATE TABLE admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  target_id uuid,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox(available_at) WHERE processed_at IS NULL;
