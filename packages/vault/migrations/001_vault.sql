-- The vault's own database. The main application's database role has no access here,
-- and the vault has no access to the main database.

-- One data key per (plan, kind). Stored only wrapped by the master key, which lives
-- outside this database (VAULT_MASTER_KEY; a cloud KMS in production).
CREATE TABLE data_keys (
  id          uuid PRIMARY KEY,
  owner_ref   text NOT NULL,              -- the plan id it belongs to (an opaque id here)
  kind        text NOT NULL,
  wrapped     bytea NOT NULL,             -- iv | tag | ciphertext of the 32-byte key
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_ref, kind)
);

-- Every request to release a key, allowed or not.
CREATE TABLE access_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  client     text NOT NULL,
  key_id     uuid,
  kind       text NOT NULL,
  purpose    text NOT NULL,
  allowed    boolean NOT NULL,
  reason     text
);
CREATE INDEX access_log_client_at ON access_log (client, at DESC);

CREATE FUNCTION vault_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER access_log_append_only BEFORE UPDATE OR DELETE ON access_log FOR EACH ROW EXECUTE FUNCTION vault_reject_mutation();
CREATE TRIGGER data_keys_immutable BEFORE UPDATE OR DELETE ON data_keys FOR EACH ROW EXECUTE FUNCTION vault_reject_mutation();
