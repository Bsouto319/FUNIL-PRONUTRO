import { useState } from "react";
import { Receipt, CheckCircle, Phone, MessageCircle, AlertCircle } from "lucide-react";
import { STAGES, updateLeadPendencia } from "../lib/api";

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Hoje ${hm}`;
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `Ontem ${hm}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hm}`;
}

export default function PendenciasPage({
  leads,
  onSelect,
  onResolved,
}: {
  leads: any[];
  onSelect: (l: any) => void;
  onResolved: () => void;
}) {
  const [resolving, setResolving] = useState<string | null>(null);

  const pending = leads
    .filter(l => l.pendencia_financeira)
    .sort((a, b) => new Date(b.last_message_at ?? b.created_at).getTime() - new Date(a.last_message_at ?? a.created_at).getTime());

  async function handleResolve(lead: any) {
    setResolving(lead.id);
    await updateLeadPendencia(lead.id, false);
    onResolved();
    setResolving(null);
  }

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-yellow-500/20 border border-yellow-500/30 flex items-center justify-center">
          <Receipt size={18} className="text-yellow-400" />
        </div>
        <div>
          <h2 className="text-slate-800 font-black text-lg leading-tight">Pendências Financeiras</h2>
          <p className="text-slate-500 text-xs">Pacientes com solicitação de nota fiscal ou pagamento pendente</p>
        </div>
        <span className="ml-auto text-sm font-black px-3 py-1 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
          {pending.length} {pending.length === 1 ? "pendência" : "pendências"}
        </span>
      </div>

      {/* Empty state */}
      {!pending.length && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center">
            <CheckCircle size={28} className="text-emerald-400" />
          </div>
          <p className="text-slate-500 font-bold text-sm">Nenhuma pendência financeira</p>
          <p className="text-slate-400 text-xs">Quando alguém solicitar nota fiscal ou tiver pagamento pendente,<br />marque na conversa e aparecerá aqui.</p>
        </div>
      )}

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {pending.map(lead => {
          const name = lead.name || lead.whatsapp_name || `+${lead.phone}`;
          const stage = STAGES.find(s => s.key === lead.stage);
          const lastMsg = lead.last_message_at ?? lead.created_at;

          return (
            <div
              key={lead.id}
              className="rounded-xl border border-yellow-500/25 overflow-hidden"
              style={{ background: "rgba(234,179,8,0.05)" }}
            >
              {/* Top stripe */}
              <div className="h-1 bg-gradient-to-r from-yellow-500/60 to-orange-500/60" />

              <div className="p-4">
                {/* Name + stage */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-slate-800 font-black text-sm truncate leading-tight">{name}</p>
                    <p className="text-slate-500 text-[10px] font-mono mt-0.5">+{lead.phone}</p>
                  </div>
                  {stage && (
                    <span
                      className="shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: stage.headerBg }}
                    >
                      {stage.label}
                    </span>
                  )}
                </div>

                {/* Notes preview */}
                {lead.notes && (
                  <p className="text-[10px] text-slate-500 line-clamp-2 mb-3 italic">
                    {lead.notes}
                  </p>
                )}

                {/* Time */}
                <div className="flex items-center gap-1 mb-3">
                  <AlertCircle size={10} className="text-yellow-400 shrink-0" />
                  <span className="text-[10px] text-yellow-300/70 font-bold">{formatTime(lastMsg)}</span>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => onSelect(lead)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-600 hover:text-slate-800 text-[11px] font-bold transition"
                  >
                    <MessageCircle size={12} />
                    Ver conversa
                  </button>
                  <button
                    onClick={() => handleResolve(lead)}
                    disabled={resolving === lead.id}
                    title="Marcar como resolvido"
                    className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold transition disabled:opacity-50"
                  >
                    <CheckCircle size={12} />
                    {resolving === lead.id ? "..." : "Resolver"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
