-- Multi-tenant RLS
-- Cada usuário pertence a uma clínica (clinic_slug em pn_usuarios).
-- As tabelas principais filtram automaticamente via RLS — zero mudança nas queries de SELECT.

-- 1. clinic_slug nos usuários
ALTER TABLE pn_usuarios ADD COLUMN IF NOT EXISTS clinic_slug TEXT DEFAULT 'pronutro';

-- 2. clinic_slug nos médicos (cada clínica tem seus próprios médicos)
ALTER TABLE pn_medicos ADD COLUMN IF NOT EXISTS clinic_slug TEXT DEFAULT 'pronutro';

-- 3. clinic_slug no financeiro
ALTER TABLE pn_financeiro ADD COLUMN IF NOT EXISTS clinic_slug TEXT DEFAULT 'pronutro';

-- 4. clinic_slug na config (maria_global_mode por clínica)
ALTER TABLE pn_config ADD COLUMN IF NOT EXISTS clinic_slug TEXT DEFAULT 'pronutro';
UPDATE pn_config SET clinic_slug = 'pronutro' WHERE clinic_slug IS NULL;

-- 5. Função helper — retorna o slug da clínica do usuário logado
--    SECURITY DEFINER para evitar recursão no RLS
CREATE OR REPLACE FUNCTION get_user_clinic_slug()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT COALESCE(clinic_slug, 'pronutro')
  FROM pn_usuarios
  WHERE id = auth.uid()
$$;

-- 6. RLS nas tabelas core ─────────────────────────────────────────────────────

ALTER TABLE pn_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leads_clinic_isolation ON pn_leads;
CREATE POLICY leads_clinic_isolation ON pn_leads FOR ALL
  USING (clinic_slug = get_user_clinic_slug())
  WITH CHECK (clinic_slug = get_user_clinic_slug());

ALTER TABLE pn_mensagens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mensagens_clinic_isolation ON pn_mensagens;
CREATE POLICY mensagens_clinic_isolation ON pn_mensagens FOR ALL
  USING (clinic_slug = get_user_clinic_slug())
  WITH CHECK (clinic_slug = get_user_clinic_slug());

ALTER TABLE pn_agendamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agendamentos_clinic_isolation ON pn_agendamentos;
CREATE POLICY agendamentos_clinic_isolation ON pn_agendamentos FOR ALL
  USING (clinic_slug = get_user_clinic_slug())
  WITH CHECK (clinic_slug = get_user_clinic_slug());

ALTER TABLE pn_medicos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS medicos_clinic_isolation ON pn_medicos;
CREATE POLICY medicos_clinic_isolation ON pn_medicos FOR ALL
  USING (clinic_slug = get_user_clinic_slug())
  WITH CHECK (clinic_slug = get_user_clinic_slug());

ALTER TABLE pn_financeiro ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financeiro_clinic_isolation ON pn_financeiro;
CREATE POLICY financeiro_clinic_isolation ON pn_financeiro FOR ALL
  USING (clinic_slug = get_user_clinic_slug())
  WITH CHECK (clinic_slug = get_user_clinic_slug());

-- 7. Indexes extras para as novas colunas
CREATE INDEX IF NOT EXISTS idx_pn_usuarios_clinic    ON pn_usuarios(clinic_slug);
CREATE INDEX IF NOT EXISTS idx_pn_medicos_clinic     ON pn_medicos(clinic_slug);
CREATE INDEX IF NOT EXISTS idx_pn_financeiro_clinic  ON pn_financeiro(clinic_slug);
CREATE INDEX IF NOT EXISTS idx_pn_config_key_clinic  ON pn_config(key, clinic_slug);
