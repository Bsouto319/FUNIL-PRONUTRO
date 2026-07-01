import { useState, useMemo } from "react";
import { Search, Phone, Clock, UserCircle2, ArrowDownAZ, ArrowDownWideNarrow, X } from "lucide-react";
import { STAGES } from "../lib/api";

interface Props {
  leads: any[];
  currentUser: any;
  onSelect: (lead: any) => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "ontem";
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export default function PacientesPage({ leads, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<"alpha" | "recent">("alpha");

  const patients = useMemo(() => {
    const q = search.toLowerCase().trim();
    const numQ = q.replace(/\D/g, "");

    const filtered = leads.filter(l => {
      if (!q) return true;
      const name    = (l.name || l.whatsapp_name || "").toLowerCase();
      const phone   = (l.phone || "");
      const cpf     = (l.cpf || "").replace(/\D/g, "");
      const email   = (l.email || "").toLowerCase();
      const notas   = (l.notas || "").toLowerCase();
      const prontuario = l.numero_prontuario != null ? String(l.numero_prontuario) : "";
      return (
        name.includes(q) ||
        phone.includes(numQ || q) ||
        (numQ && cpf.includes(numQ)) ||
        email.includes(q) ||
        notas.includes(q) ||
        prontuario === q.replace(/^#/, "")
      );
    });

    if (sortMode === "alpha") {
      return filtered.sort((a, b) => {
        const na = (a.name || a.whatsapp_name || a.phone || "").toLowerCase();
        const nb = (b.name || b.whatsapp_name || b.phone || "").toLowerCase();
        return na.localeCompare(nb, "pt-BR");
      });
    }
    return filtered.sort((a, b) => {
      const da = a.last_message_at ?? a.created_at ?? "";
      const db2 = b.last_message_at ?? b.created_at ?? "";
      return new Date(db2).getTime() - new Date(da).getTime();
    });
  }, [leads, search, sortMode]);

  // Group by first letter when alphabetical and no search
  const grouped = useMemo(() => {
    if (sortMode !== "alpha" || search.trim()) return null;
    const map = new Map<string, any[]>();
    for (const p of patients) {
      const name = p.name || p.whatsapp_name || p.phone || "";
      const letter = name[0]?.toUpperCase() || "#";
      const key = /[A-Z]/.test(letter) ? letter : "#";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [patients, sortMode, search]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-white/8" style={{ background: "rgba(10,20,55,0.5)" }}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="shrink-0">
            <h2 className="text-white font-black text-lg leading-none">Pacientes</h2>
            <p className="text-white/30 text-xs mt-0.5">{leads.length} cadastrados</p>
          </div>

          {/* Busca */}
          <div className="flex-1 min-w-[200px] max-w-lg relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Nome, telefone, CPF, e-mail ou #prontuário..."
              className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Sort toggle */}
          <button
            onClick={() => setSortMode(m => m === "alpha" ? "recent" : "alpha")}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs font-bold transition shrink-0"
            title={sortMode === "alpha" ? "Ordenado: A-Z" : "Ordenado: Recentes"}
          >
            {sortMode === "alpha" ? <ArrowDownAZ size={14} /> : <ArrowDownWideNarrow size={14} />}
            {sortMode === "alpha" ? "A–Z" : "Recentes"}
          </button>

          {search && (
            <p className="text-white/40 text-sm shrink-0 ml-1">
              {patients.length} resultado{patients.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto px-4 py-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
        {patients.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-white/20">
            <UserCircle2 size={48} strokeWidth={1} />
            <p className="text-sm font-bold">{search ? "Nenhum paciente encontrado" : "Nenhum paciente cadastrado"}</p>
          </div>
        ) : grouped ? (
          // Agrupado por letra (modo alfabético sem busca)
          <div className="space-y-4">
            {Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([letter, group]) => (
              <div key={letter}>
                <div className="sticky top-0 z-10 py-1 mb-1" style={{ background: "rgba(10,20,55,0.95)" }}>
                  <span className="text-[11px] font-black text-white/30 tracking-widest uppercase">{letter}</span>
                </div>
                <div className="space-y-0.5">
                  {group.map(lead => <PatientRow key={lead.id} lead={lead} onSelect={onSelect} />)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Lista simples (busca ou modo recentes)
          <div className="space-y-0.5">
            {patients.map(lead => <PatientRow key={lead.id} lead={lead} onSelect={onSelect} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function PatientRow({ lead, onSelect }: { lead: any; onSelect: (l: any) => void }) {
  const name    = lead.name || lead.whatsapp_name || `+${lead.phone}`;
  const stage   = STAGES.find(s => s.key === lead.stage);
  const lastAt  = lead.last_message_at ?? lead.created_at;
  const initials = name.split(" ").filter(Boolean).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase() || "?";

  return (
    <button
      onClick={() => onSelect(lead)}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all hover:bg-white/5 group"
    >
      {/* Avatar */}
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-white font-black text-xs shrink-0"
        style={{ background: `linear-gradient(135deg, ${stage?.headerBg ?? "#16a34a"}cc, ${stage?.headerBg ?? "#16a34a"}55)` }}
      >
        {initials}
      </div>

      {/* Info principal */}
      <div className="flex-1 min-w-0">
        <p className="text-white font-bold text-sm truncate group-hover:text-emerald-200 transition leading-tight">
          {name}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <Phone size={9} className="text-white/20 shrink-0" />
          <span className="text-[10px] text-white/30 font-mono truncate">+{lead.phone}</span>
          {lead.cpf && (
            <>
              <span className="text-white/15 text-[9px]">·</span>
              <span className="text-[10px] text-white/25">
                {lead.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Stage + tempo */}
      <div className="flex items-center gap-2 shrink-0">
        {stage && (
          <span
            className="hidden sm:inline text-[9px] font-black px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{
              backgroundColor: `${stage.headerBg}20`,
              color: stage.headerBg,
              border: `1px solid ${stage.headerBg}35`,
            }}
          >
            {stage.label}
          </span>
        )}
        <div className="flex items-center gap-1 text-white/25 min-w-[36px] justify-end">
          <Clock size={9} />
          <span className="text-[9px] whitespace-nowrap">{timeAgo(lastAt)}</span>
        </div>
      </div>
    </button>
  );
}
