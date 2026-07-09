create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('pronutro-noshow-friday') where exists (
  select 1 from cron.job where jobname = 'pronutro-noshow-friday'
);

-- Toda quinta-feira as 18h de Brasilia (21h UTC, sem horario de verao)
select cron.schedule(
  'pronutro-noshow-friday',
  '0 21 * * 4',
  $$
  select net.http_post(
    url := 'https://pvphgusjofufwtyiyviu.supabase.co/functions/v1/pronutro-noshow-friday',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);
