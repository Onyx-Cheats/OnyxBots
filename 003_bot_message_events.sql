CREATE TABLE IF NOT EXISTS onyx_bot_message_events (
  bot_id CHAR(36) NOT NULL,
  update_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM('message', 'start') NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (bot_id, update_id),
  KEY idx_onyx_message_events_recent (bot_id, occurred_at),
  KEY idx_onyx_message_events_kind (bot_id, event_type, occurred_at),
  CONSTRAINT fk_onyx_message_events_bot FOREIGN KEY (bot_id)
    REFERENCES onyx_bots (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
