-- pn_notas_fiscais já existia (upload real via FinanceiroPage.tsx, bucket
-- notas-fiscais, linkado por lead_id). Só faltava clinic_slug pra multi-tenant
-- e RLS, pra Maria/pronutro-poll conseguir localizar e enviar quando o
-- paciente pedir a nota fiscal.
ALTER TABLE pn_notas_fiscais ADD COLUMN IF NOT EXISTS clinic_slug TEXT DEFAULT 'pronutro';
UPDATE pn_notas_fiscais SET clinic_slug = 'pronutro' WHERE clinic_slug IS NULL;
CREATE INDEX IF NOT EXISTS idx_pn_notas_fiscais_clinic ON pn_notas_fiscais(clinic_slug, data_emissao);

ALTER TABLE pn_notas_fiscais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notas_fiscais_clinic_isolation ON pn_notas_fiscais;
CREATE POLICY notas_fiscais_clinic_isolation ON pn_notas_fiscais FOR ALL
  USING (clinic_slug = get_user_clinic_slug())
  WITH CHECK (clinic_slug = get_user_clinic_slug());

-- Delay anti-ban configurável por clínica (clínicas com Maria respondendo
-- 24h/todo mundo precisam de delay maior pra não levar ban da Meta).
ALTER TABLE clinic_configs ADD COLUMN IF NOT EXISTS reply_delay_min_ms INT;
ALTER TABLE clinic_configs ADD COLUMN IF NOT EXISTS reply_delay_max_ms INT;
