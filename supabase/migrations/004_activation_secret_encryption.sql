-- SynthesisOne: encrypted storage of the temporary activation secret.
-- Run after 001_license_auto_activation.sql, 002_activation_payment_window.sql,
-- and 003_token_blacklist.sql.
--
-- The value is encrypted by the Node backend and is only decrypted for
-- authenticated admin-panel diagnostics. Existing sessions created before
-- this migration will have NULL here and their secret cannot be recovered.

alter table public.license_activation_sessions
  add column if not exists activation_secret_encrypted text;

comment on column public.license_activation_sessions.activation_secret_encrypted is
  'Temporary activation secret encrypted at rest for authenticated admin diagnostics; never expose through public onboarding routes.';
