-- pronutro-poll processava só a ProNutro (tudo hardcoded). Pra virar multi-tenant
-- de verdade (ler token/prompt de clinic_configs por clínica), cada clínica
-- precisa do próprio cursor de mensagens e do próprio lock.
ALTER TABLE pn_poll_state ADD COLUMN IF NOT EXISTS clinic_slug TEXT;
UPDATE pn_poll_state SET clinic_slug = 'pronutro' WHERE id = 1 AND clinic_slug IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pn_poll_state_clinic_slug ON pn_poll_state(clinic_slug);
