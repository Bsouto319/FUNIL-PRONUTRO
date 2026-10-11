-- Campos de registro profissional em pn_medicos, necessários pra cadastrar
-- o médico como prescritor na Memed (POST /sinapse-prescricao/usuarios).
-- Sem CPF + CRM/UF a Memed rejeita o cadastro -- hoje pn_medicos só tinha
-- nome/especialidade/valor, suficiente pra agenda mas não pra prescrição.
ALTER TABLE pn_medicos ADD COLUMN IF NOT EXISTS cpf TEXT;
ALTER TABLE pn_medicos ADD COLUMN IF NOT EXISTS registro_profissional TEXT; -- número do CRM
ALTER TABLE pn_medicos ADD COLUMN IF NOT EXISTS uf_registro TEXT; -- UF do CRM (ex: DF)
ALTER TABLE pn_medicos ADD COLUMN IF NOT EXISTS cidade_ibge INT; -- id da cidade no cadastro da Memed
ALTER TABLE pn_medicos ADD COLUMN IF NOT EXISTS especialidade_memed_id INT; -- id da especialidade no cadastro da Memed
ALTER TABLE pn_medicos ADD COLUMN IF NOT EXISTS memed_token TEXT; -- data-token retornado no cadastro, usado no SDK do front
ALTER TABLE pn_medicos ADD COLUMN IF NOT EXISTS memed_cadastrado_em TIMESTAMPTZ;

-- Dados do paciente exigidos pela Memed pra abrir uma prescrição
-- (setPaciente: nome, cpf, data_nascimento, sexo).
ALTER TABLE pn_leads ADD COLUMN IF NOT EXISTS cpf TEXT;
ALTER TABLE pn_leads ADD COLUMN IF NOT EXISTS data_nascimento DATE;
ALTER TABLE pn_leads ADD COLUMN IF NOT EXISTS sexo TEXT; -- 'M' | 'F'
