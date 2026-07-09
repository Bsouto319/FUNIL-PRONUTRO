-- clinic_configs guarda segredos (uazapi_token) e estava sem RLS: o anon key
-- (público, embutido no bundle do frontend) conseguia ler o token do WhatsApp
-- direto via REST. Só Edge Functions (service_role, que sempre ignora RLS)
-- precisam acessar essa tabela — frontend não usa.
ALTER TABLE clinic_configs ENABLE ROW LEVEL SECURITY;

-- Sem nenhuma policy: anon e authenticated ficam totalmente bloqueados.
-- service_role (usado pelas Edge Functions) continua acessando normalmente.
