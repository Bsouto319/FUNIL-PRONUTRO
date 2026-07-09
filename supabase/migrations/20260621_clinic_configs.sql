-- Multi-tenant clinic configs
-- Cada linha = 1 cliente da Maria IA
-- Novo cliente = INSERT aqui + configurar webhook UAZAPI

CREATE TABLE IF NOT EXISTS clinic_configs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT UNIQUE NOT NULL,           -- 'pronutro', 'clinica-silva'
  clinic_name         TEXT NOT NULL,
  agent_name          TEXT NOT NULL DEFAULT 'Maria',  -- nome da IA para o cliente
  uazapi_token        TEXT NOT NULL,
  uazapi_number       TEXT NOT NULL,                  -- '556199548881' (sem +)
  address             TEXT,
  phone_display       TEXT,                           -- '(61) 99954-8881'
  working_hours_text  TEXT DEFAULT 'seg–sex 8h–18h',
  specialist_info     TEXT,                           -- bloco livre de texto: médicos, valores, etc.
  extra_instructions  TEXT,                           -- instruções adicionais injetadas no prompt
  slot_duration_min   INT DEFAULT 60,
  ai_active           BOOLEAN DEFAULT true,           -- liga/desliga Maria globalmente para o cliente
  active              BOOLEAN DEFAULT true,           -- cliente ativo no sistema
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ProNutro como primeiro cliente (slug 'pronutro')
INSERT INTO clinic_configs (
  slug, clinic_name, agent_name, uazapi_token, uazapi_number,
  address, phone_display, working_hours_text, specialist_info, ai_active
) VALUES (
  'pronutro',
  'Clínica ProNutro',
  'Maria',
  '5efd90a1-116b-4c86-b715-7bac2fab658a',
  '556199548881',
  'Ed. Centro Clínico Linea Vitta, Qd 616 SGA/SUL, Bloco C, Sala 223 — Asa Sul, Brasília',
  '(61) 99954-8881',
  'seg–sex 8h–18h, sáb 8h–12h',
  '### Dr. Augusto Margon — R$ 930 — Particular
Nutrologia + Psiquiatria + Medicina Intensivista.
Foco: qualidade de vida, extensão da expectativa de vida, tratamento integrado nutricional, hormonal e psiquiátrico.
Atende de 1 ano até idosos. Atua em: emagrecimento, ganho de peso, ansiedade, insônia, compulsão alimentar, diabetes, hipertensão, nutrologia infantil, suporte oncológico.
Pagamento: Pix, dinheiro ou cartão até 3x sem juros. Entrada de R$ 490 para confirmar.
Cancelamento/remarcação: avisar com 12h de antecedência.

### Dr. Celso Melo — R$ 650 — Particular
Nutrologia + Cirurgia Proctológica. Atendimento humanizado e individualizado.

### Dr. Marcus Gesteira — R$ 560 — Aceita alguns planos
Especialista em emagrecimento, pós-graduado em Nutrologia.
Atua em: emagrecimento, reeducação alimentar, compulsão, obesidade, diabetes, hipertensão, colesterol, deficiência de vitaminas, alterações hormonais.

### Dra. Vanessa Melo — R$ 560 — Aceita alguns planos (inclui 1 retorno)
Pediatra pós-graduada em Nutrologia. Crianças e adolescentes.
Atua em: introdução alimentar, seletividade, baixo peso/sobrepeso, vitaminas, crescimento.

### Dra. Kelly Felippes — R$ 500 — Particular
Saúde feminina: hormônios, fertilidade, menopausa.

### Gisele Falcão — Enfermeira Estética — Avaliação R$ 250 (entrada R$ 100, abatida no tratamento)
Botox Feminino R$ 1.350 | Masculino R$ 1.550.
Bioestimuladores de colágeno, preenchimentos, laser facial/corporal, skinbooster, enzimas emagrecedoras, estrias e flacidez.',
  true
) ON CONFLICT (slug) DO NOTHING;

-- Adiciona clinic_slug às tabelas existentes (retroativo = 'pronutro')
ALTER TABLE pn_leads       ADD COLUMN IF NOT EXISTS clinic_slug TEXT DEFAULT 'pronutro';
ALTER TABLE pn_mensagens   ADD COLUMN IF NOT EXISTS clinic_slug TEXT DEFAULT 'pronutro';
ALTER TABLE pn_agendamentos ADD COLUMN IF NOT EXISTS clinic_slug TEXT DEFAULT 'pronutro';

-- Indexes para queries multi-tenant rápidas
CREATE INDEX IF NOT EXISTS idx_pn_leads_clinic_slug        ON pn_leads(clinic_slug);
CREATE INDEX IF NOT EXISTS idx_pn_leads_clinic_phone       ON pn_leads(clinic_slug, phone);
CREATE INDEX IF NOT EXISTS idx_pn_mensagens_clinic_lead    ON pn_mensagens(clinic_slug, lead_id);
CREATE INDEX IF NOT EXISTS idx_pn_agendamentos_clinic      ON pn_agendamentos(clinic_slug);

-- Trigger updated_at para clinic_configs
CREATE OR REPLACE FUNCTION update_clinic_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clinic_configs_updated_at ON clinic_configs;
CREATE TRIGGER trg_clinic_configs_updated_at
  BEFORE UPDATE ON clinic_configs
  FOR EACH ROW EXECUTE FUNCTION update_clinic_configs_updated_at();
