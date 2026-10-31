CREATE TABLE IF NOT EXISTS onyx_bot_access_keys (
  bot_id CHAR(36) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (bot_id),
  UNIQUE KEY uq_onyx_bot_access_key_hash (key_hash),
  CONSTRAINT fk_onyx_bot_access_keys_bot FOREIGN KEY (bot_id)
    REFERENCES onyx_bots (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
