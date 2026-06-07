import { useState, useMemo } from "react";
import { Search, Phone, FileText, Clock, UserCircle2 } from "lucide-react";
import { STAGES } from "../lib/api";

interface Props {
  leads: any[];
  currentUser: any;
  onSelect: (lead: any) => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "ontem";
  if (days < 30) return `${days} dias atrás`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function PacientesPage({ leads, onSelect }: Props) {
  const [search, setSearch] = useState("");

  const patients = useMemo(() => {
    const q = search.toLowerCase().trim();
    return leads
      .filter(l => {
        if (!q) return true;
        const name   = (l.name || l.whatsapp_name || "").toLowerCase();
        const phone  = (l.phone || "").toLowerCase();
        const cpf    = (l.cpf || "").replace(/\D/g, "");
        const email  = (l.email || "").toLowerCase();
        const notes  = (l.notes || "").toLowerCase();
        const numPart = q.replace(/^#/, "");
        const prontuario = l.numero_prontuario != null ? String(l.numero_prontuario) : "";
        return name.includes(q) || phone.includes(q) || cpf.includes(q.replace(/\D/g, "")) || email.includes(q) || notes.includes(q) || prontuario === numPart;
      })
      .sort((a, b) => {
        const aDate = a.last_message_at ?? a.created_at;
        const bDate = b.last_message_at ?? b.created_at;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      });
  }, [leads, search]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-white/8" style={{ background: "rgba(10,20,55,0.5)" }}>
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-white font-black text-lg leading-none">Pacientes</h2>
            <p className="text-white/30 text-xs mt-0.5">{leads.length} cadastrados</p>
          </div>
          <div className="flex-1 max-w-md relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome, telefone, CPF ou e-mail..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition"
            />
          </div>
          {search && (
            <p className="text-white/40 text-sm shrink-0">
              {patients.length} resultado{patients.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
        {patients.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-white/20">
            <UserCircle2 size={48} strokeWidth={1} />
            <p className="text-sm font-bold">{search ? "Nenhum paciente encontrado" : "Nenhum paciente cadastrado"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {patients.map(lead => {
              const name   = lead.name || lead.whatsapp_name || `+${lead.phone}`;
              const stage  = STAGES.find(s => s.key === lead.stage);
              const lastAt = lead.last_message_at ?? lead.created_at;
              const initials = name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();

              return (
                <button
                  key={lead.id}
                  onClick={() => onSelect(lead)}
                  className="text-left rounded-xl border border-white/8 p-4 transition-all hover:border-emerald-500/30 hover:bg-emerald-500/5 group"
                  style={{ background: "rgba(10,20,55,0.6)" }}
                >
                  {/* Avatar + nome */}
                  <div className="flex items-start gap-3 mb-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-sm shrink-0"
                      style={{ background: `linear-gradient(135deg, ${stage?.headerBg ?? "#16a34a"}cc, ${stage?.headerBg ?? "#16a34a"}66)` }}
                    >
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-black text-sm truncate group-hover:text-emerald-200 transition">{name}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Phone size={9} className="text-white/25 shrink-0" />
                        <p className="text-white/35 text-[10px] font-mono truncate">+{lead.phone}</p>
                      </div>
                    </div>
                  </div>

                  {/* Stage badge */}
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <span
                      className="text-[9px] font-black px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: `${stage?.headerBg ?? "#16a34a"}25`, color: stage?.headerBg ?? "#16a34a", border: `1px solid ${stage?.headerBg ?? "#16a34a"}40` }}
                    >
                      {stage?.label ?? lead.stage}
                    </span>
                    {lead.score != null && (
                      <span
                        className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: lead.score >= 70 ? "#22c55e22" : lead.score >= 40 ? "#f59e0b22" : "#ef444422",
                          color: lead.score >= 70 ? "#4ade80" : lead.score >= 40 ? "#fbbf24" : "#f87171",
                        }}
                      >
                        {lead.score}%
                      </span>
                    )}
                  </div>

                  {/* Info extra */}
                  <div className="space-y-1">
                    {lead.cpf && (
                      <p className="text-[10px] text-white/30 font-mono">
                        CPF: {lead.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}
                      </p>
                    )}
                    {lead.data_nascimento && (
                      <p className="text-[10px] text-white/30">
                        Nasc: {fmt(lead.data_nascimento)}
                      </p>
                    )}
                    {lead.convenio && (
                      <p className="text-[10px] text-white/30 truncate">Convênio: {lead.convenio}</p>
                    )}
                    {lead.email && (
                      <p className="text-[10px] text-white/25 truncate">{lead.email}</p>
                    )}
                  </div>

                  {/* Resumo / notas */}
                  {(lead.summary || lead.notes) && (
                    <div className="mt-2.5 pt-2.5 border-t border-white/6">
                      <div className="flex items-start gap-1.5">
                        <FileText size={9} className="text-white/20 shrink-0 mt-0.5" />
                        <p className="text-[10px] text-white/30 line-clamp-2 leading-relaxed">
                          {lead.summary || lead.notes}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Último contato */}
                  <div className="mt-2.5 flex items-center gap-1 text-white/20">
                    <Clock size={9} />
                    <span className="text-[9px]">{timeAgo(lastAt)}</span>
                    {lead.pendencia_financeira && (
                      <span className="ml-auto text-[9px] font-black text-yellow-400">💰 Pendência</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
