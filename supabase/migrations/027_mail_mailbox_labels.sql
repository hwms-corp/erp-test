-- ============================================================
-- 027_mail_mailbox_labels.sql
-- 메일함 분류(받은/보낸) + Gmail 라벨 동기화 준비
-- ============================================================

ALTER TABLE mail_messages
  ADD COLUMN IF NOT EXISTS is_sent boolean NOT NULL DEFAULT false;

ALTER TABLE mail_messages
  ADD COLUMN IF NOT EXISTS gmail_label_ids text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN mail_messages.is_sent IS 'Gmail SENT 라벨 여부 (보낸메일함)';
COMMENT ON COLUMN mail_messages.gmail_label_ids IS 'Gmail labelIds 스냅샷';

CREATE INDEX IF NOT EXISTS idx_mail_messages_is_sent
  ON mail_messages (is_sent)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mail_messages_gmail_label_ids
  ON mail_messages USING GIN (gmail_label_ids);

CREATE TABLE IF NOT EXISTS gmail_labels (
  id              text PRIMARY KEY,
  mailbox         text NOT NULL DEFAULT 'me',
  name            text NOT NULL,
  label_type      text NOT NULL DEFAULT 'user', -- system | user
  message_list_visibility text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gmail_labels_mailbox ON gmail_labels (mailbox);

ALTER TABLE gmail_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gmail_labels_select_authenticated ON gmail_labels;
CREATE POLICY gmail_labels_select_authenticated
  ON gmail_labels FOR SELECT TO authenticated USING (true);
