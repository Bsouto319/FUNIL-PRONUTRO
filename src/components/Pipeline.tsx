import { useState } from "react";
import { STAGES, updateLeadStage } from "../lib/api";
import { Bot, Phone, Calendar } from "lucide-react";

interface Props {
  leads: any[];
  onSelect: (lead: any) => void;
  onToggleAi: (id: string, mode: boolean) => void;
  currentUser: any;
}

export default function Pipeline({ leads, onSelect, onToggleAi, currentUser }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);

  function handleDrop(e: React.DragEvent, stage: string) {
    e.preventDefault();
    if (!dragging) return;
    updateLeadStage(dragging, stage);
    setDragging(null);
  }

  return (
    <div className="h-full flex gap-3 overflow-x-auto pb-2">
      {STAGES.map(({ key, label, headerBg }) => {
        const stageLeads = leads.filter(l => l.stage === key);
        return (
          <div
            key={key}
            className="flex-shrink-0 w-64 flex flex-col rounded-2xl overflow-hidden border border-white/10"
            style={{ background: "rgba(255,255,255,0.04)" }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => handleDrop(e, key)}
          >
            {/* Column header */}
            <div className="px-3 py-2.5 flex items-center justify-between" style={{ background: headerBg + "33", borderBottom: `1px solid ${headerBg}44` }}>
              <span className="text-white font-black text-xs tracking-wide">{label}</span>
              <span className="text-white/60 text-xs font-bold bg-white/10 px-1.5 py-0.5 rounded-full">{stageLeads.length}</span>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
              {stageLeads.map(lead => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  onSelect={onSelect}
                  onToggleAi={onToggleAi}
                  onDragStart={() => setDragging(lead.id)}
                  onDragEnd={() => setDragging(null)}
                  isDragging={dragging === lead.id}
                />
              ))}
              {stageLeads.length === 0 && (
                <div className="text-white/20 text-xs text-center py-6 select-none">Vazio</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LeadCard({ lead, onSelect, onToggleAi, onDragStart, onDragEnd, isDragging }: {
  lead: any;
  onSelect: (lead: any) => void;
  onToggleAi: (id: string, mode: boolean) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  isDragging: boolean;
}) {
  const name = lead.name || lead.phone;
  const ago  = timeAgo(lead.updated_at || lead.created_at);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(lead)}
      className={`p-3 rounded-xl border border-white/10 cursor-pointer hover:border-white/20 hover:bg-white/[0.08] transition-all select-none ${isDragging ? "opacity-40" : ""}`}
      style={{ background: "rgba(255,255,255,0.05)" }}
    >
      <div className="flex items-start gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-700 flex items-center justify-center flex-shrink-0 text-white font-black text-xs">
          {name[0]?.toUpperCase() || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-xs truncate">{name}</p>
          <p className="text-white/40 text-[10px] font-mono">{lead.phone}</p>
        </div>
        {lead.score !== null && lead.score !== undefined && (
          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${lead.score >= 7 ? "bg-emerald-500/20 text-emerald-300" : lead.score >= 4 ? "bg-amber-500/20 text-amber-300" : "bg-rose-500/20 text-rose-300"}`}>
            {lead.score}
          </span>
        )}
      </div>

      {lead.summary && (
        <p className="text-white/50 text-[10px] line-clamp-2 mb-2 leading-relaxed">{lead.summary}</p>
      )}

      {lead.medico && (
        <div className="flex items-center gap-1 mb-2">
          <span className="text-[10px] text-violet-300/70 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded-full truncate">
            👨‍⚕️ {lead.medico.nome}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-white/30 text-[9px]">{ago}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={e => { e.stopPropagation(); onToggleAi(lead.id, !lead.ai_mode); }}
            title={lead.ai_mode ? "Maria ativa — clique para desligar" : "Maria inativa"}
            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg text-[10px] font-bold border transition-all ${
              lead.ai_mode
                ? "bg-violet-500/25 text-violet-300 border-violet-500/50"
                : "bg-white/10 text-white/50 border-white/25"
            }`}
          >
            <Bot size={10} />
            <span>{lead.ai_mode ? "ON" : "OFF"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
