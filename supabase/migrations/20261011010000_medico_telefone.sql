-- Telefone do médico, pra mandar a receita gerada direto pro WhatsApp dele
-- assinar (fluxo simples: ele imprime/assina na propria assinatura do
-- MedX ou a caneta, fotografa e manda de volta -- sem depender de
-- extrair certificado nenhum).
ALTER TABLE pn_medicos ADD COLUMN IF NOT EXISTS telefone TEXT;
