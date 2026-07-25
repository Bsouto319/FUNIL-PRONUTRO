import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// pronutro-ai-fix DESATIVADO — alertas movidos para pronutro-monitor
Deno.serve(async (_req: Request) => {
  return new Response(JSON.stringify({ ok: true, disabled: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
