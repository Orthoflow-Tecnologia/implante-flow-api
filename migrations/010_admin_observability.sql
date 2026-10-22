-- Observabilidade administrativa: logs operacionais e trilha de auditoria.
-- Sem RLS clínico — consultadas só via conexão de serviço nas rotas /v1/admin.

CREATE TABLE system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level text NOT NULL CHECK (level IN ('trace', 'debug', 'info', 'warn', 'error', 'fatal')),
  message text NOT NULL,
  source text NOT NULL DEFAULT 'api',
  request_id text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX system_logs_created_at_idx ON system_logs (created_at DESC);
CREATE INDEX system_logs_level_created_at_idx ON system_logs (level, created_at DESC);
CREATE INDEX system_logs_request_id_idx ON system_logs (request_id) WHERE request_id IS NOT NULL;

CREATE TABLE admin_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email text NOT NULL,
  actor_dentist_id uuid,
  action text NOT NULL,
  target text,
  result text NOT NULL CHECK (result IN ('success', 'denied', 'failure')),
  justification text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_events_created_at_idx ON admin_audit_events (created_at DESC);
CREATE INDEX admin_audit_events_action_created_at_idx ON admin_audit_events (action, created_at DESC);
CREATE INDEX admin_audit_events_actor_email_idx ON admin_audit_events (actor_email);
