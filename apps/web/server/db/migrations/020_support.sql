CREATE TABLE support_conversations (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  handler text NOT NULL DEFAULT 'operator' CHECK (handler IN ('assistant', 'operator')),
  handed_off_at timestamptz,
  assistant_run_id uuid,
  assistant_run_message_id uuid,
  assistant_run_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL,
  last_customer_message_at timestamptz,
  last_operator_message_at timestamptz,
  customer_read_at timestamptz,
  operator_read_at timestamptz,
  resolved_at timestamptz,
  resolved_by text CHECK (resolved_by ~ '^0x[0-9a-f]{40}$'),
  CHECK ((assistant_run_id IS NULL) = (assistant_run_expires_at IS NULL) AND (assistant_run_id IS NULL) = (assistant_run_message_id IS NULL)),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);
CREATE INDEX support_conversations_status_recent_idx ON support_conversations (status, last_message_at DESC, id DESC);

CREATE TABLE support_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  author_type text NOT NULL CHECK (author_type IN ('customer', 'operator', 'assistant')),
  author_operator text CHECK (author_operator ~ '^0x[0-9a-f]{40}$'),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'draft', 'discarded')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  client_message_id text NOT NULL CHECK (length(client_message_id) BETWEEN 8 AND 64),
  in_reply_to uuid REFERENCES support_messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (conversation_id, author_type, client_message_id),
  CHECK (author_type <> 'operator' OR author_operator IS NOT NULL),
  CHECK (author_type <> 'customer' OR author_operator IS NULL)
);
CREATE INDEX support_messages_conversation_recent_idx ON support_messages (conversation_id, created_at, id);
CREATE INDEX support_messages_operator_rate_idx ON support_messages (author_operator, created_at) WHERE author_type = 'operator' AND status = 'sent';
CREATE INDEX support_messages_assistant_budget_idx ON support_messages (conversation_id, created_at) WHERE author_type = 'assistant' AND status = 'sent';

CREATE TABLE support_assistant_runs (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES support_messages(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  replay boolean NOT NULL
);
CREATE INDEX support_assistant_runs_budget_idx ON support_assistant_runs (conversation_id, started_at);
CREATE INDEX support_assistant_runs_replay_idx ON support_assistant_runs (conversation_id, started_at) WHERE replay;

CREATE TABLE support_context_refs (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES support_messages(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('funding_order', 'money_action')),
  ref_id text NOT NULL CHECK (length(ref_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (conversation_id, kind, ref_id)
);

CREATE TABLE support_assistant_credentials (
  id text PRIMARY KEY CHECK (id = 'default'),
  envelope text NOT NULL,
  last4 text NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by text NOT NULL CHECK (updated_by ~ '^0x[0-9a-f]{40}$')
);

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (action IN ('settings.update', 'customer.read', 'support.credential.update', 'support.credential.delete'));
ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_shape;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_shape CHECK (
  (action = 'settings.update' AND target_kind = 'settings' AND purpose IS NULL AND after IS NOT NULL)
  OR (action = 'customer.read' AND target_kind = 'customer' AND purpose IS NOT NULL AND before IS NULL AND after IS NULL)
  OR (action IN ('support.credential.update', 'support.credential.delete') AND target_kind = 'settings' AND target_id = 'support-assistant-key' AND purpose IS NULL)
);
