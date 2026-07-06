import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAudit } from "../_shared/audit.ts";

const UAZAPI_URL   = Deno.env.get("UAZAPI_URL")   || "https://btechsoutoshop.uazapi.com";
const UAZAPI_TOKEN = Deno.env.get("UAZAPI_TOKEN") || "";
const SUPABASE_URL = "https://pvphgusjofufwtyiyviu.supabase.co";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey,authorization,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { lead_id, phone, media_type, base64, file_name, sender_nome } = await req.json();

    if (!phone || !media_type || !base64) {
      return new Response(JSON.stringify({ ok: false, error: "missing params" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    let endpoint: string;
    let body: Record<string, string>;

    if (media_type === "ptt") {
      endpoint = "/send/ptt";
      body = { number: phone, audio: base64 };
    } else if (media_type === "image") {
      endpoint = "/send/image";
      body = { number: phone, image: base64, caption: file_name || "" };
    } else if (media_type === "video") {
      endpoint = "/send/video";
      body = { number: phone, video: base64, caption: file_name || "" };
    } else {
      endpoint = "/send/document";
      body = { number: phone, document: base64, fileName: file_name || "arquivo" };
    }

    const uaRes = await fetch(`${UAZAPI_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: UAZAPI_TOKEN },
      body: JSON.stringify(body),
    });

    if (!uaRes.ok) {
      const detail = await uaRes.text().catch(() => "");
      console.error("pn-send-media uazapi error", uaRes.status, detail);
      return new Response(JSON.stringify({ ok: false, error: "uazapi_error" }), {
        status: 500, headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // Pre-insert into pn_mensagens so message appears immediately without waiting for poll
    if (lead_id && SUPABASE_KEY) {
      const db = createClient(SUPABASE_URL, SUPABASE_KEY);
      await db.from("pn_mensagens").insert({
        lead_id,
        direction: "out",
        body: file_name || "",
        sender_nome: sender_nome || "Sistema",
        sender_tipo: "human",
        media_type: media_type === "ptt" ? "audio" : media_type,
        media_filename: file_name || "",
        created_at: new Date().toISOString(),
      });
    }

    await logAudit({
      action: "MEDIA_SENT",
      table_name: "pn_mensagens",
      record_id: lead_id ?? undefined,
      user_phone: phone,
      severity: "info",
      metadata: { media_type, file_name, sender: sender_nome },
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  } catch (e) {
    console.error("pn-send-media error", e);
    await logAudit({ action: "MEDIA_SEND_ERROR", severity: "error", metadata: { error: String(e) } });
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
