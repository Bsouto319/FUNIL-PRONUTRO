-- Backfill medico_preferido pra leads "em atendimento" (inclui aguardando/negociacao/
-- conversando/novo_lead, que sao a mesma fase na pratica) que ainda nao tem medico
-- marcado -- infere pelo agendamento/financeiro/prontuario mais recente do lead.
-- Quem nao tiver nenhum registro ligado a medico fica null de proposito (cai em "Outros"
-- no kanban).
with candidate as (
  select id from pn_leads
  where stage in ('em_atendimento','aguardando','negociacao','conversando','novo_lead')
    and (medico_preferido is null or medico_preferido = '')
),
inferred as (
  select l.id as lead_id,
    coalesce(
      (select m.nome from pn_agendamentos a join pn_medicos m on m.id = a.medico_id
         where a.lead_id = l.id order by a.data_hora desc limit 1),
      (select m.nome from pn_financeiro f join pn_medicos m on m.id = f.medico_id
         where f.lead_id = l.id order by f.created_at desc limit 1),
      (select m.nome from pn_prontuarios p join pn_medicos m on m.id = p.medico_id
         where p.lead_id = l.id order by p.created_at desc limit 1)
    ) as nome_medico
  from pn_leads l
  where l.id in (select id from candidate)
)
update pn_leads l
set medico_preferido = i.nome_medico, updated_at = now()
from inferred i
where l.id = i.lead_id and i.nome_medico is not null;
