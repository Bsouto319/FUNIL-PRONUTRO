-- Campos pra lançamentos capturados automaticamente via foto de comprovante
-- mandada pela equipe no WhatsApp (ver pn_numeros_internos).
ALTER TABLE pn_financeiro ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT 'manual';
ALTER TABLE pn_financeiro ADD COLUMN IF NOT EXISTS revisado BOOLEAN DEFAULT true; -- lançamento manual já nasce revisado
ALTER TABLE pn_financeiro ADD COLUMN IF NOT EXISTS comprovante_url TEXT;
ALTER TABLE pn_financeiro ADD COLUMN IF NOT EXISTS id_transacao_externa TEXT; -- NSU/Stone ID do comprovante, pra bater com o extrato depois
ALTER TABLE pn_financeiro ADD COLUMN IF NOT EXISTS whatsapp_msg_id TEXT UNIQUE; -- idempotência: não duplica se reprocessar a mesma mensagem
