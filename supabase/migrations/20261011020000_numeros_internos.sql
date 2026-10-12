-- Números de WhatsApp internos (equipe), que NUNCA devem virar lead nem
-- receber resposta da Maria IA quando mandam mensagem pro número principal
-- da clínica. Checado antes de qualquer outra coisa no pronutro-poll.
CREATE TABLE IF NOT EXISTS pn_numeros_internos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  clinic_slug TEXT NOT NULL DEFAULT 'pronutro',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pn_numeros_internos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS numeros_internos_clinic_isolation ON pn_numeros_internos;
CREATE POLICY numeros_internos_clinic_isolation ON pn_numeros_internos FOR ALL
  USING (clinic_slug = get_user_clinic_slug())
  WITH CHECK (clinic_slug = get_user_clinic_slug());

INSERT INTO pn_numeros_internos (telefone, nome, clinic_slug) VALUES
  ('5561981554906', 'Monica', 'pronutro'),
  ('5561981002269', 'Ingrid', 'pronutro')
ON CONFLICT (telefone) DO NOTHING;
