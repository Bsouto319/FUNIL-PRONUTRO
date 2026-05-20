import { useState } from "react";
import { STAGES, updateLeadStage } from "../lib/api";
import { Bot } from "lucide-react";

interface Props {
  leads: any[];
  onSelect: (lead: any) => void;
  onToggleAi: (id: string, mode: boolean) => void;
  currentUser: any;
  dayFilter?: string | null;
}

function isSameDay(isoDate: string, dayStr: string): boolean {
  const d = new Date(isoDate);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}` === dayStr;
}

const PROTECTED = ["resolvido", "financeiro"];

function minutesSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

function formatTime(iso: string): string {
  const d   = new Date(iso);
  const now = new Date();
  const hm  = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Hoje ${hm}`;
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `Ontem ${hm}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hm}`;
}

const KANBAN_STAGES = STAGES.filter(s => s.kanban);

export default function Pipeline({ leads, onSelect, onToggleAi, dayFilter }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);

  function handleDrop(e: React.DragEvent, stage: string) {
    e.preventDefault();
    if (!dragging) return;
    updateLeadStage(dragging, stage);
    setDragging(null);
  }

  return (
    <div className="h-full flex gap-2.5 overflow-x-auto pb-2 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-white/5 [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full">
      {KANBAN_STAGES.map(({ key, label, headerBg }) => {
        const stageLeads = leads
          .filter(l => l.stage === key)
          .filter(l => {
            if (!dayFilter) return true;
            const ref = l.last_message_at ?? l.created_at;
            return isSameDay(ref, dayFilter);
          })
          .sort((a, b) => {
            // Em Atendimento: ordem de chegada (mais antigo primeiro = esperando mais)
            if (key === "em_atendimento") {
              return new Date(a.last_message_at ?? a.created_at).getTime() - new Date(b.last_message_at ?? b.created_at).getTime();
            }
            return new Date(b.last_message_at ?? b.created_at).getTime() - new Date(a.last_message_at ?? a.created_at).getTime();
          });

        return (
          <div
            key={key}
            className="flex-shrink-0 flex flex-col rounded-xl overflow-hidden"
            style={{ width: "calc((100vw - 96px - 20px) / 4)", minWidth: 220 }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => handleDrop(e, key)}
          >
            {/* Column header */}
            <div className="px-3 py-3 flex items-center justify-between flex-shrink-0" style={{ backgroundColor: headerBg }}>
              <span className="text-sm font-black text-white tracking-wider uppercase leading-none drop-shadow-md">{label}</span>
              <span className="text-sm font-black bg-black/30 text-white px-2.5 py-0.5 rounded-full min-w-[26px] text-center">{stageLeads.length}</span>
            </div>

            {/* Cards */}
            <div
              className="flex-1 overflow-y-auto space-y-2 p-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full"
              style={{ background: "rgba(10,20,55,0.5)" }}
            >
              {stageLeads.map(lead => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  stageKey={key}
                  stageColor={headerBg}
                  onSelect={onSelect}
                  onToggleAi={onToggleAi}
                  onDragStart={() => setDragging(lead.id)}
                  onDragEnd={() => setDragging(null)}
                  isDragging={dragging === lead.id}
                />
              ))}
              {!stageLeads.length && (
                <div className="rounded-lg border border-dashed p-5 text-center mt-1" style={{ borderColor: `${headerBg}30` }}>
                  <p className="text-xs font-medium" style={{ color: `${headerBg}60` }}>Vazio</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LeadCard({ lead, stageKey, stageColor, onSelect, onToggleAi, onDragStart, onDragEnd, isDragging }: {
  lead: any; stageKey: string; stageColor: string;
  onSelect: (l: any) => void; onToggleAi: (id: string, mode: boolean) => void;
  onDragStart: () => void; onDragEnd: () => void; isDragging: boolean;
}) {
  const name    = lead.name || lead.whatsapp_name || `+${lead.phone}`;
  const lastMsg = lead.last_message_at ?? lead.created_at;
  const isNew   = minutesSince(lead.created_at) < 60;
  const idleMin = minutesSince(lastMsg);
  const semAtend = lead.ai_mode && !PROTECTED.includes(stageKey) && idleMin >= 120;
  const mariaAtiva = lead.ai_mode && !PROTECTED.includes(stageKey) && idleMin < 120;

  // Card visual state
  const cardBg    = semAtend
    ? "rgba(220,30,30,0.08)"
    : mariaAtiva
    ? "rgba(109,40,217,0.08)"
    : "rgba(15,28,60,0.85)";
  const borderClr = semAtend
    ? "rgba(239,68,68,0.35)"
    : mariaAtiva
    ? "rgba(167,139,250,0.35)"
    : "rgba(255,255,255,0.08)";
  const leftClr   = semAtend ? "#ef4444" : mariaAtiva ? "#a78bfa" : stageColor;

  return (
    <div className={`relative rounded-lg overflow-hidden ${isDragging ? "opacity-40" : ""}`}>
      {/* Pulsing violet ring when Maria is active */}
      {mariaAtiva && (
        <div className="absolute inset-0 border border-violet-400/50 animate-ping pointer-events-none rounded-lg" style={{ animationDuration: "2.5s" }} />
      )}

      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={() => onSelect(lead)}
        className="w-full text-left rounded-lg transition-all duration-150 p-3 cursor-pointer select-none border hover:brightness-110"
        style={{ background: cardBg, borderColor: borderClr, borderLeftWidth: 3, borderLeftColor: leftClr }}
      >
        {/* Name row */}
        <div className="flex items-start justify-between gap-1 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 text-white font-black text-[9px]"
              style={{ background: `linear-gradient(135deg, ${stageColor}cc, ${stageColor}66)` }}
            >
              {name[0]?.toUpperCase() || "?"}
            </div>
            <p className="text-sm font-black text-white truncate leading-tight">{name}</p>
          </div>

          {/* Badges */}
          <div className="flex items-center gap-1 shrink-0">
            {isNew && (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: stageColor }}>
                NOVO
              </span>
            )}
            {semAtend && !isNew && (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">
                SEM RETORNO
              </span>
            )}
            {mariaAtiva && !isNew && (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-violet-500/25 text-violet-300 border border-violet-500/50 animate-pulse">
                🤖 MARIA
              </span>
            )}
          </div>
        </div>

        {/* Phone + prontuário */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <p className="text-[10px] text-white/35 font-mono">+{lead.phone}</p>
          {lead.numero_prontuario && (
            <span className="text-[9px] font-black px-1 py-0.5 rounded bg-white/10 text-white/40">
              #{String(lead.numero_prontuario).padStart(3, "0")}
            </span>
          )}
        </div>

        {/* GPT Summary */}
        {lead.summary ? (
          <p className="text-[10px] leading-relaxed line-clamp-2 mb-2 italic" style={{ color: `${stageColor}cc` }}>
            🤖 {lead.summary}
          </p>
        ) : lead.first_message ? (
          <p className="text-[10px] text-white/35 line-clamp-2 mb-2">{lead.first_message}</p>
        ) : <div className="mb-2" />}

        {/* Quem falou por último */}
        {lead.last_sender_nome && (
          <div className="flex items-center gap-1 mb-1.5">
            <span
              className="text-[9px] font-black px-1.5 py-0.5 rounded-full border truncate max-w-[120px]"
              style={
                lead.last_sender_nome === "Maria IA"
                  ? { background: "rgba(109,40,217,0.15)", color: "#c4b5fd", borderColor: "rgba(139,92,246,0.3)" }
                  : { background: "rgba(5,150,105,0.15)", color: "#6ee7b7", borderColor: "rgba(16,185,129,0.3)" }
              }
            >
              {lead.last_sender_nome === "Maria IA" ? "🤖" : "💬"} {lead.last_sender_nome}
            </span>
          </div>
        )}

        {/* Bottom row: Maria toggle | time | score */}
        <div className="flex items-center justify-between gap-1 mt-1">
          {/* Maria toggle */}
          {!PROTECTED.includes(stageKey) ? (
            <button
              onClick={e => { e.stopPropagation(); onToggleAi(lead.id, !lead.ai_mode); }}
              title={lead.ai_mode ? "Maria ativa — clique para desligar" : "Maria desligada — clique para ligar"}
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-black border transition-all ${
                lead.ai_mode
                  ? "bg-violet-500/25 text-violet-300 border-violet-500/50 shadow-sm shadow-violet-500/20"
                  : "bg-white/10 text-white/50 border-white/25"
              }`}
            >
              <Bot size={9} />
              <span>{lead.ai_mode ? "ON" : "OFF"}</span>
            </button>
          ) : (
            <span className="text-[9px] text-white/20 font-bold px-1">—</span>
          )}

          <div className="flex items-center gap-1.5">
            {/* Time */}
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${semAtend ? "text-red-300 bg-red-500/15" : "text-white/50 bg-white/5"}`}>
              {semAtend ? "⚠ " : ""}{formatTime(lastMsg)}
            </span>

            {/* Score */}
            {lead.score != null && (
              <span
                className="shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: lead.score >= 70 ? "#22c55e22" : lead.score >= 40 ? "#f59e0b22" : "#ef444422",
                  color:           lead.score >= 70 ? "#4ade80"   : lead.score >= 40 ? "#fbbf24"   : "#f87171",
                }}
              >
                {lead.score}%
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
