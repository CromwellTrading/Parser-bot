-- SynthesisOne: persisted 5-minute payment window + confirmation grace.
-- Run after 001_license_auto_activation.sql.

alter table public.license_activation_sessions
  add column if not exists payment_started_at timestamptz,
  add column if not exists payment_deadline_at timestamptz,
  add column if not exists confirmation_deadline_at timestamptz;

alter table public.license_payments
  add column if not exists transaction_at timestamptz;

create index if not exists idx_license_activation_sessions_deadlines
  on public.license_activation_sessions (status, payment_deadline_at, confirmation_deadline_at);

create index if not exists idx_license_payments_transaction_at
  on public.license_payments (transaction_at);

comment on column public.license_activation_sessions.payment_started_at is 'Servidor: inicio exacto de la ventana de 5 minutos para realizar el pago.';
comment on column public.license_activation_sessions.payment_deadline_at is 'Servidor: fin exacto de la ventana de pago.';
comment on column public.license_activation_sessions.confirmation_deadline_at is 'Servidor: fin de la tolerancia técnica para recibir el SMS de confirmación.';
comment on column public.license_payments.transaction_at is 'Hora de la operación extraída del SMS cuando el banco la proporciona.';
