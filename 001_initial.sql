CREATE TABLE IF NOT EXISTS onyx_users (
  open_id VARCHAR(191) NOT NULL,
  display_name VARCHAR(120) NOT NULL DEFAULT 'Manus user',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_login_at DATETIME(3) NULL,
  PRIMARY KEY (open_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS onyx_sessions (
  session_hash CHAR(64) NOT NULL,
  open_id VARCHAR(191) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (session_hash),
  KEY idx_onyx_sessions_owner (open_id),
  CONSTRAINT fk_onyx_sessions_owner FOREIGN KEY (open_id)
    REFERENCES onyx_users (open_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS onyx_bots (
  id CHAR(36) NOT NULL,
  owner_open_id VARCHAR(191) NOT NULL,
  telegram_username VARCHAR(64) NULL,
  bot_label VARCHAR(120) NOT NULL,
  description VARCHAR(120) NOT NULL DEFAULT '',
  welcome_message TEXT NOT NULL,
  help_message TEXT NOT NULL,
  commands_json JSON NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  token_fingerprint CHAR(64) NOT NULL,
  token_ciphertext MEDIUMTEXT NOT NULL,
  token_iv CHAR(16) NOT NULL,
  token_tag CHAR(24) NOT NULL,
  total_messages BIGINT UNSIGNED NOT NULL DEFAULT 0,
  unique_users BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_activity_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_onyx_bot_token (token_fingerprint),
  KEY idx_onyx_bots_owner (owner_open_id),
  CONSTRAINT fk_onyx_bots_owner FOREIGN KEY (owner_open_id)
    REFERENCES onyx_users (open_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS onyx_bot_chats (
  bot_id CHAR(36) NOT NULL,
  chat_hash CHAR(64) NOT NULL,
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (bot_id, chat_hash),
  CONSTRAINT fk_onyx_bot_chats_bot FOREIGN KEY (bot_id)
    REFERENCES onyx_bots (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS onyx_bot_updates (
  bot_id CHAR(36) NOT NULL,
  update_id BIGINT UNSIGNED NOT NULL,
  state ENUM('processing', 'done', 'failed') NOT NULL DEFAULT 'processing',
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (bot_id, update_id),
  KEY idx_onyx_bot_updates_state (state, received_at),
  CONSTRAINT fk_onyx_bot_updates_bot FOREIGN KEY (bot_id)
    REFERENCES onyx_bots (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS onyx_bot_activity (
  bot_id CHAR(36) NOT NULL,
  activity_date DATE NOT NULL,
  message_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  new_users BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (bot_id, activity_date),
  CONSTRAINT fk_onyx_bot_activity_bot FOREIGN KEY (bot_id)
    REFERENCES onyx_bots (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
