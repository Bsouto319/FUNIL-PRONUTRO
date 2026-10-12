-- Reclama real do Bruno: mensagem de paciente demorando a cair no Kanban.
-- pg_cron so permite 1 execucao por minuto com sintaxe cron tradicional --
-- o pior caso de atraso era de ate 60s so de espera do poll, fora o
-- processamento. pg_cron 1.4+ aceita intervalo em segundos direto como
-- schedule, entao troca pra rodar a cada 15s (pior caso de atraso cai
-- pra ~15-20s).
select cron.unschedule('pronutro-poll-00') where exists (
  select 1 from cron.job where jobname = 'pronutro-poll-00'
);

select cron.schedule(
  'pronutro-poll-00',
  '15 seconds',
  $$
  select net.http_post(
    url := 'https://pvphgusjofufwtyiyviu.supabase.co/functions/v1/pronutro-poll',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);
