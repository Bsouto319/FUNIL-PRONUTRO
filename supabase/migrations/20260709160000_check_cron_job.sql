do $$
declare
  r record;
begin
  for r in select jobname, schedule, active from cron.job where jobname = 'pronutro-noshow-friday' loop
    raise notice 'CRON JOB FOUND: name=%, schedule=%, active=%', r.jobname, r.schedule, r.active;
  end loop;
end $$;
