select cron.unschedule('pronutro-arquivar-agendados') where exists (
  select 1 from cron.job where jobname = 'pronutro-arquivar-agendados'
);

-- Todo dia as 5h da manha de Brasilia (8h UTC) -- horario morto, antes da
-- equipe comecar a usar o sistema.
select cron.schedule(
  'pronutro-arquivar-agendados',
  '0 8 * * *',
  $$
  select net.http_post(
    url := 'https://pvphgusjofufwtyiyviu.supabase.co/functions/v1/pronutro-arquivar-agendados',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);
