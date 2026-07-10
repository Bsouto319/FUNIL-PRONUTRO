do $$
declare
  r record;
  cnt int := 0;
begin
  for r in
    select created_at, action, severity, metadata
    from audit_logs
    where project = 'pronutro'
      and created_at > now() - interval '48 hours'
      and (severity in ('error','critical') or metadata::text ilike '%403%' or metadata::text ilike '%uazapi%')
    order by created_at desc
    limit 15
  loop
    cnt := cnt + 1;
    raise notice 'AUDIT [%] % sev=% meta=%', r.created_at, r.action, r.severity, r.metadata;
  end loop;
  raise notice 'TOTAL MATCHES: %', cnt;
end $$;
