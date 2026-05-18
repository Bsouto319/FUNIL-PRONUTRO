import { useEffect, useState, useRef, useCallback } from "react";
import { X, Send, Trash2, Calendar, ChevronDown, FileText, Upload, Download, AlertCircle, Brain, Copy, CheckCheck, UserCircle, Save } from "lucide-react";
import {
  fetchMessages, sendMessage, updateLeadStage, updateLeadNotes, deleteLead,
  fetchMedicos, fetchSlotsDisponiveis, createAgendamento, STAGES,
  fetchNotasFiscais, uploadNotaFiscal, getNotaFiscalUrl, deleteNotaFiscal,
  updateLeadProfile,
} from "../lib/api";
import { supabase } from "../lib/supabase";

interface Props {
  lead: any;
  currentUser: any;
  onClose: () => void;
  onUpdated: () => void;
}

function fmtFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function LeadModal({ lead, currentUser, onClose, onUpdated }: Props) {
  const [messages, setMessages]   = useState<any[]>([]);
  const [text, setText]           = useState("");
  const [sending, setSending]     = useState(false);
  const [notes, setNotes]         = useState(lead.notes || "");
  const [stage, setStage]         = useState(lead.stage);
  const [tab, setTab]             = useState<"chat" | "agendar" | "notas" | "perfil">("chat");
  const [medicos, setMedicos]     = useState<any[]>([]);
  const [medicoId, setMedicoId]   = useState("");
  const [data, setData]           = useState("");
  const [slots, setSlots]         = useState<string[]>([]);
  const [slot, setSlot]           = useState("");
  const [agendando, setAgendando]   = useState(false);
  const [agendadoOk, setAgendadoOk] = useState(false);
  const [origem, setOrigem]         = useState("");
  const [horaManual, setHoraManual] = useState("");
  const [agendadoErr, setAgendadoErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sendError, setSendError]         = useState(false);
  const [aiAnalysis, setAiAnalysis]       = useState<any>(null);
  const [analyzing, setAnalyzing]         = useState(false);
  const [copied, setCopied]               = useState(false);

  // Perfil / pagamento
  const [perfNome,      setPerfNome]      = useState(lead.name || "");
  const [perfEmail,     setPerfEmail]     = useState(lead.email || "");
  const [perfOrigem,    setPerfOrigem]    = useState(lead.origem || "");
  const [perfPagStatus, setPerfPagStatus] = useState(lead.pagamento_status || "pendente");
  const [perfPagValor,  setPerfPagValor]  = useState(lead.pagamento_valor != null ? String(lead.pagamento_valor) : "");
  const [perfPagMetodo, setPerfPagMetodo] = useState(lead.pagamento_metodo || "");
  const [perfPagData,   setPerfPagData]   = useState(lead.pagamento_data || "");
  const [perfPagObs,    setPerfPagObs]    = useState(lead.pagamento_obs || "");
  const [savingPerf,    setSavingPerf]    = useState(false);
  const [perfSaved,     setPerfSaved]     = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Notas Fiscais state
  const [nfs, setNfs]               = useState<any[]>([]);
  const [nfFile, setNfFile]         = useState<File | null>(null);
  const [nfNumero, setNfNumero]     = useState("");
  const [nfData, setNfData]         = useState(new Date().toISOString().slice(0, 10));
  const [nfValor, setNfValor]       = useState("");
  const [nfObs, setNfObs]           = useState("");
  const [uploadingNf, setUploadingNf] = useState(false);
  const [deletingNfId, setDeletingNfId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const nfFileRef = useRef<HTMLInputElement>(null);

  const refreshMessages = useCallback(async () => {
    const msgs = await fetchMessages(lead.id);
    setMessages(msgs);
  }, [lead.id]);

  useEffect(() => {
    refreshMessages();
    fetchMedicos().then(setMedicos);
    fetchNotasFiscais({ leadId: lead.id }).then(setNfs);

    const channel = supabase
      .channel(`pn_msg_${lead.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pn_mensagens", filter: `lead_id=eq.${lead.id}` },
        payload => {
          setMessages(prev => {
            // dedup by id — evita mensagem duplicada se o banco já foi recarregado
            if (prev.some((m: any) => m.id === (payload.new as any).id)) return prev;
            return [...prev, payload.new as any];
          });
        })
      .subscribe();

    // Polling de 8s garante que mensagens enviadas pela Monica diretamente
    // no WhatsApp (fora do sistema) apareçam, mesmo sem lead_id no webhook
    const poll = setInterval(refreshMessages, 8000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [lead.id, refreshMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setSendError(false);
    const ok = await sendMessage(lead.id, lead.phone, text.trim(), currentUser.nome);
    if (ok) {
      setText("");
    } else {
      setSendError(true);
      setTimeout(() => setSendError(false), 4000);
    }
    setSending(false);
  }

  async function handleStageChange(newStage: string) {
    setStage(newStage);
    await updateLeadStage(lead.id, newStage);
  }

  async function handleNotesBlur() {
    await updateLeadNotes(lead.id, notes);
  }

  async function handleDelete() {
    await deleteLead(lead.id);
    onUpdated();
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    setAiAnalysis(null);
    try {
      const res = await fetch("https://pvphgusjofufwtyiyviu.supabase.co/functions/v1/pn-analyze-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2cGhndXNqb2Z1Znd0eWl5dml1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI0MTM2NjMsImV4cCI6MjA1Nzk4OTY2M30.TLBbLCx08gkD_RWnMpZ4dBKxnb4wZgm6vTbAFaGRZ3A" },
        body: JSON.stringify({ lead_id: lead.id }),
      });
      const data = await res.json();
      if (data.ok) setAiAnalysis(data);
      else setAiAnalysis({ error: data.error || "Erro ao analisar" });
    } catch {
      setAiAnalysis({ error: "Falha de conexão" });
    }
    setAnalyzing(false);
  }

  async function handleCopyResponse() {
    if (!aiAnalysis?.resposta_sugerida) return;
    await navigator.clipboard.writeText(aiAnalysis.resposta_sugerida);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleApplyStage() {
    if (!aiAnalysis?.stage_sugerido) return;
    await handleStageChange(aiAnalysis.stage_sugerido);
    setAiAnalysis((prev: any) => ({ ...prev, stageApplied: true }));
  }

  async function loadSlots() {
    if (!medicoId || !data) return;
    const s = await fetchSlotsDisponiveis(medicoId, data);
    setSlots(s);
    setSlot("");
  }
  useEffect(() => { loadSlots(); }, [medicoId, data]);

  async function handleAgendar() {
    const horario = horaManual;
    if (!medicoId || !data || !horario) return;
    setAgendando(true);
    setAgendadoErr("");
    const obs = origem ? `Origem: ${origem}` : undefined;
    const ag = await createAgendamento({
      lead_id: lead.id,
      medico_id: medicoId,
      data_hora: `${data}T${horario}:00`,
      observacoes: obs,
    });
    if (ag) {
      await updateLeadStage(lead.id, "agendado");
      setStage("agendado");
      setAgendadoOk(true);
      setTimeout(() => setAgendadoOk(false), 4000);
    } else {
      setAgendadoErr("Erro ao criar agendamento. Verifique os dados e tente novamente.");
    }
    setAgendando(false);
  }

  // ── NF handlers ─────────────────────────────────────────────────────────────

  async function handleNfUpload() {
    if (!nfFile) return;
    setUploadingNf(true);
    const result = await uploadNotaFiscal({
      file:          nfFile,
      leadId:        lead.id,
      nomePaciente:  lead.name || lead.phone,
      numeroNf:      nfNumero || undefined,
      dataEmissao:   nfData   || undefined,
      valor:         nfValor  ? parseFloat(nfValor.replace(",", ".")) : undefined,
      observacoes:   nfObs    || undefined,
      uploadedBy:    currentUser.nome,
    });
    setUploadingNf(false);
    if (result) {
      setNfs(prev => [result, ...prev]);
      setNfFile(null); setNfNumero(""); setNfValor(""); setNfObs("");
      setNfData(new Date().toISOString().slice(0, 10));
      if (nfFileRef.current) nfFileRef.current.value = "";
    }
  }

  async function handleNfDownload(nf: any) {
    setDownloadingId(nf.id);
    const url = await getNotaFiscalUrl(nf.file_path);
    setDownloadingId(null);
    if (url) window.open(url, "_blank");
    else alert("Erro ao gerar link de download.");
  }

  async function handleNfDelete(nf: any) {
    if (!confirm(`Excluir a nota fiscal "${nf.file_name}"?`)) return;
    setDeletingNfId(nf.id);
    await deleteNotaFiscal(nf.id, nf.file_path);
    setNfs(prev => prev.filter(n => n.id !== nf.id));
    setDeletingNfId(null);
  }

  async function handleSaveProfile() {
    setSavingPerf(true);
    const ok = await updateLeadProfile(lead.id, {
      name:              perfNome || undefined,
      email:             perfEmail || undefined,
      origem:            perfOrigem || undefined,
      pagamento_status:  perfPagStatus || undefined,
      pagamento_valor:   perfPagValor ? parseFloat(perfPagValor.replace(",", ".")) : null,
      pagamento_metodo:  perfPagMetodo || undefined,
      pagamento_data:    perfPagData || undefined,
      pagamento_obs:     perfPagObs || undefined,
    });
    setSavingPerf(false);
    if (ok) {
      setPerfSaved(true);
      setTimeout(() => setPerfSaved(false), 2500);
    }
  }

  const name    = lead.name || lead.phone;
  const medicoSel = medicos.find(m => m.id === medicoId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-white/10 overflow-hidden" style={{ background: "rgba(10,20,60,0.95)" }}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center gap-3 border-b border-white/10 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-700 flex items-center justify-center text-white font-black">
            {name[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-black">{name}</p>
            <p className="text-white/40 text-xs font-mono">{lead.phone}</p>
          </div>
          <div className="relative">
            <select value={stage} onChange={e => handleStageChange(e.target.value)}
              className="appearance-none pl-3 pr-7 py-1.5 rounded-lg bg-white/10 border border-white/15 text-white text-xs font-bold focus:outline-none cursor-pointer">
              {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none" />
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition">
            <X size={16} className="text-white/50" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3 flex-shrink-0 overflow-x-auto">
          <button onClick={() => setTab("chat")}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${tab === "chat" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60"}`}>
            💬 Chat
          </button>
          <button onClick={() => setTab("perfil")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${tab === "perfil" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60"}`}>
            <UserCircle size={11} />
            Perfil
            {(lead.pagamento_status === "pago") && (
              <span className="text-[9px] bg-emerald-500/30 text-emerald-300 px-1.5 py-0.5 rounded-full font-black">✓ Pago</span>
            )}
          </button>
          <button onClick={() => setTab("agendar")}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${tab === "agendar" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60"}`}>
            📅 Agendar
          </button>
          <button onClick={() => setTab("notas")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${tab === "notas" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60"}`}>
            <FileText size={11} />
            Notas Fiscais
            {nfs.length > 0 && <span className="text-[9px] bg-emerald-500/30 text-emerald-300 px-1.5 py-0.5 rounded-full font-black">{nfs.length}</span>}
          </button>
        </div>

        {/* ── CHAT TAB ── */}
        {tab === "chat" && (
          <>
            {/* Copiloto IA — barra de ação */}
            <div className="flex items-center gap-2 px-5 py-2 border-b border-white/8 flex-shrink-0" style={{ background: "rgba(109,40,217,0.05)" }}>
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/80 hover:bg-violet-600 text-white text-[11px] font-black transition disabled:opacity-50"
              >
                <Brain size={11} className={analyzing ? "animate-pulse" : ""} />
                {analyzing ? "Analisando..." : "🤖 Analisar com IA"}
              </button>
              {aiAnalysis && !aiAnalysis.error && (
                <div className="flex items-center gap-1.5">
                  {aiAnalysis.urgencia === "alta" && (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-pulse">🔴 URGENTE</span>
                  )}
                  {aiAnalysis.urgencia === "media" && (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">🟡 MÉDIA</span>
                  )}
                  {aiAnalysis.urgencia === "baixa" && (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">🟢 BAIXA</span>
                  )}
                </div>
              )}
              <span className="text-white/20 text-[10px] ml-auto">Copiloto para a secretária</span>
            </div>

            {/* Painel de análise */}
            {aiAnalysis && (
              <div className="mx-4 my-2 rounded-xl border flex-shrink-0 overflow-hidden" style={{
                borderColor: aiAnalysis.error ? "rgba(239,68,68,0.3)" : "rgba(139,92,246,0.35)",
                background: aiAnalysis.error ? "rgba(239,68,68,0.06)" : "rgba(109,40,217,0.08)",
              }}>
                {aiAnalysis.error ? (
                  <p className="px-4 py-3 text-rose-300 text-xs font-bold">❌ {aiAnalysis.error}</p>
                ) : (
                  <div className="px-4 py-3 space-y-2.5">
                    <div className="flex items-start gap-2">
                      <Brain size={12} className="text-violet-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-violet-300 text-[10px] font-black uppercase tracking-wider mb-0.5">O que o paciente quer</p>
                        <p className="text-white/80 text-xs leading-relaxed">{aiAnalysis.intencao}</p>
                      </div>
                    </div>

                    {aiAnalysis.observacao && (
                      <p className="text-white/40 text-[10px] italic border-l-2 border-violet-500/30 pl-2">{aiAnalysis.observacao}</p>
                    )}

                    {/* Resposta sugerida */}
                    <div className="rounded-lg border border-white/10 p-3" style={{ background: "rgba(255,255,255,0.03)" }}>
                      <p className="text-white/40 text-[10px] font-black uppercase mb-1.5">Resposta sugerida</p>
                      <p className="text-white/80 text-xs leading-relaxed whitespace-pre-wrap">{aiAnalysis.resposta_sugerida}</p>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={handleCopyResponse}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white text-[11px] font-black transition"
                      >
                        {copied ? <CheckCheck size={11} /> : <Copy size={11} />}
                        {copied ? "Copiado!" : "Copiar resposta"}
                      </button>
                      {aiAnalysis.stage_sugerido && aiAnalysis.stage_sugerido !== stage && (
                        <button
                          onClick={handleApplyStage}
                          disabled={aiAnalysis.stageApplied}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600/80 hover:bg-sky-600 text-white text-[11px] font-black transition disabled:opacity-50"
                        >
                          {aiAnalysis.stageApplied ? "✓ Aplicado" : `Mover → ${aiAnalysis.stage_sugerido.replace(/_/g, " ")}`}
                        </button>
                      )}
                      <button onClick={() => setAiAnalysis(null)} className="ml-auto p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-white/60 transition">
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1 min-h-0">
              {messages.length === 0 && (
                <p className="text-white/20 text-xs text-center py-8">Sem mensagens ainda</p>
              )}
              {messages.map((m, i) => {
                const isMaria  = m.direction === "out" && m.sender_nome === "Maria IA";
                const isHuman  = m.direction === "out" && m.sender_nome && m.sender_nome !== "Maria IA";
                const isOut    = m.direction === "out";
                const ts       = new Date(m.created_at);
                const prevTs   = i > 0 ? new Date(messages[i - 1].created_at) : null;
                const showDate = !prevTs || ts.toDateString() !== prevTs.toDateString();
                const timeStr  = ts.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                const dateStr  = ts.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });

                // Visual: Maria=violeta, humano=verde escuro, paciente=cinza
                const bubble = isMaria
                  ? "bg-violet-700/70 text-white rounded-br-sm border border-violet-500/30"
                  : isHuman
                  ? "bg-emerald-700/70 text-white rounded-br-sm border border-emerald-500/30"
                  : "bg-white/10 text-white/90 rounded-bl-sm";
                const timeClr = isOut ? "text-white/40 text-right" : "text-white/25";

                return (
                  <div key={m.id || i}>
                    {showDate && (
                      <div className="flex items-center gap-2 my-3">
                        <div className="flex-1 h-px bg-white/8" />
                        <span className="text-white/25 text-[9px] font-bold capitalize">{dateStr}</span>
                        <div className="flex-1 h-px bg-white/8" />
                      </div>
                    )}
                    <div className={`flex ${isOut ? "justify-end" : "justify-start"} mb-1`}>
                      <div className={`max-w-[78%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${bubble}`}>
                        {isOut && m.sender_nome && (
                          <p className={`text-[9px] font-black mb-0.5 ${isMaria ? "text-violet-300" : "text-emerald-300"}`}>
                            {isMaria ? "🤖 Maria IA" : `💬 ${m.sender_nome}`}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p className={`text-[9px] mt-0.5 ${timeClr}`}>{timeStr}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={handleSend} className="flex flex-col gap-1.5 px-5 py-3 border-t border-white/10 flex-shrink-0">
              {sendError && (
                <p className="text-xs text-red-400 font-bold flex items-center gap-1">
                  <AlertCircle size={12} /> Falha ao enviar — verifique a conexão com WhatsApp
                </p>
              )}
              <div className="flex gap-2">
                <input value={text} onChange={e => setText(e.target.value)} placeholder="Mensagem..."
                  className={`flex-1 px-3 py-2 rounded-xl bg-white/5 border text-white text-sm placeholder-white/30 focus:outline-none focus:ring-2 transition ${sendError ? "border-red-500/50 focus:ring-red-500/30" : "border-white/10 focus:ring-emerald-500/50"}`} />
                <button type="submit" disabled={sending || !text.trim()}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition disabled:opacity-40">
                  <Send size={14} />
                </button>
              </div>
            </form>
          </>
        )}

        {/* ── AGENDAR TAB ── */}
        {tab === "agendar" && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
            {agendadoOk && (
              <div className="text-emerald-300 text-sm font-bold text-center bg-emerald-500/10 border border-emerald-500/30 rounded-xl py-3">
                ✅ Consulta agendada! Lead movido para Agendado. Já aparece na Agenda.
              </div>
            )}
            {agendadoErr && (
              <div className="text-rose-300 text-xs font-bold bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3">
                ❌ {agendadoErr}
              </div>
            )}

            {/* Médico + Data */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-white/60 text-xs font-bold mb-1.5">Médico *</label>
                <select value={medicoId} onChange={e => setMedicoId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50">
                  <option value="">Selecione...</option>
                  {medicos.map(m => <option key={m.id} value={m.id}>{m.nome} — {m.especialidade}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-white/60 text-xs font-bold mb-1.5">Data *</label>
                <input type="date" value={data} min={new Date().toISOString().slice(0, 10)} onChange={e => setData(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
              </div>
            </div>

            {/* Info do médico */}
            {medicoSel && (
              <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-3 text-xs">
                <p className="text-violet-300 font-bold">{medicoSel.nome}</p>
                <p className="text-white/50">{medicoSel.especialidade} · R$ {medicoSel.valor}</p>
              </div>
            )}

            {/* Slots do Google Calendar — atalhos rápidos */}
            {slots.length > 0 && (
              <div>
                <label className="block text-white/60 text-xs font-bold mb-2">
                  Horários disponíveis
                  <span className="text-white/30 font-normal ml-1.5">· clique para preencher</span>
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {slots.map(s => (
                    <button key={s} onClick={() => setHoraManual(s)}
                      className={`py-2 rounded-lg text-xs font-bold border transition ${horaManual === s ? "bg-emerald-600 text-white border-emerald-500" : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10"}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Campo de horário — SEMPRE visível */}
            <div>
              <label className="block text-white/60 text-xs font-bold mb-1.5">
                Horário escolhido *
              </label>
              <input
                type="time"
                value={horaManual}
                onChange={e => setHoraManual(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-base font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
              {!horaManual && <p className="text-white/25 text-[10px] mt-1">Selecione acima ou digite o horário</p>}
            </div>

            {/* Por onde veio */}
            <div>
              <label className="block text-white/60 text-xs font-bold mb-1.5">Por onde veio</label>
              <div className="grid grid-cols-3 gap-2">
                {["WhatsApp", "Google", "Instagram", "Facebook", "Indicação", "Doctoralia", "TikTok", "Outro"].map(op => (
                  <button key={op} onClick={() => setOrigem(origem === op ? "" : op)}
                    className={`py-2 px-3 rounded-lg text-[11px] font-bold border transition text-left ${origem === op ? "bg-emerald-600/80 text-white border-emerald-500" : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"}`}>
                    {op === "WhatsApp" ? "📱 " : op === "Google" ? "🔍 " : op === "Instagram" ? "📸 " : op === "Facebook" ? "👥 " : op === "Indicação" ? "🤝 " : op === "Doctoralia" ? "🏥 " : op === "TikTok" ? "🎵 " : "❓ "}
                    {op}
                  </button>
                ))}
              </div>
            </div>

            {/* Botão confirmar — SEMPRE visível */}
            <button
              onClick={handleAgendar}
              disabled={agendando || !medicoId || !data || !horaManual}
              className="w-full py-3.5 rounded-xl text-white font-black text-sm transition shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: (!medicoId || !data || !horaManual) ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg,#059669,#047857)" }}
            >
              {agendando
                ? "⏳ Agendando..."
                : (!medicoId || !data || !horaManual)
                ? `Preencha ${!medicoId ? "médico" : !data ? "data" : "horário"} para confirmar`
                : `✅ Confirmar — ${data.split("-").reverse().join("/")} às ${horaManual}${origem ? `  ·  ${origem}` : ""}`}
            </button>
          </div>
        )}

        {/* ── PERFIL TAB ── */}
        {tab === "perfil" && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">

            {/* Dados do paciente */}
            <div className="rounded-xl border border-white/10 p-4 space-y-3" style={{ background: "rgba(255,255,255,0.03)" }}>
              <p className="text-white/60 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5">
                <UserCircle size={11} />
                Dados do Paciente
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Nome</label>
                  <input value={perfNome} onChange={e => setPerfNome(e.target.value)} placeholder="Nome completo"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">WhatsApp</label>
                  <input value={lead.phone} readOnly
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/40 text-xs font-mono cursor-not-allowed" />
                </div>
              </div>
              <div>
                <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">E-mail</label>
                <input type="email" value={perfEmail} onChange={e => setPerfEmail(e.target.value)} placeholder="paciente@email.com"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
              </div>
              <div>
                <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1.5">Por onde veio</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {["WhatsApp", "Google", "Instagram", "Facebook", "Indicação", "Doctoralia", "TikTok", "Outro"].map(op => (
                    <button key={op} onClick={() => setPerfOrigem(perfOrigem === op ? "" : op)}
                      className={`py-1.5 px-2 rounded-lg text-[10px] font-bold border transition ${perfOrigem === op ? "bg-emerald-600/80 text-white border-emerald-500" : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"}`}>
                      {op === "WhatsApp" ? "📱" : op === "Google" ? "🔍" : op === "Instagram" ? "📸" : op === "Facebook" ? "👥" : op === "Indicação" ? "🤝" : op === "Doctoralia" ? "🏥" : op === "TikTok" ? "🎵" : "❓"} {op}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Pagamento */}
            <div className="rounded-xl border border-white/10 p-4 space-y-3" style={{ background: "rgba(255,255,255,0.03)" }}>
              <p className="text-white/60 text-[10px] font-black uppercase tracking-wider">💳 Pagamento</p>

              {/* Status */}
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { key: "pago",      label: "✅ Pago",       cls: "bg-emerald-600/80 border-emerald-500" },
                  { key: "pendente",  label: "⏳ Pendente",   cls: "bg-amber-600/80 border-amber-500" },
                  { key: "aguardando",label: "🕐 Aguardando", cls: "bg-sky-600/80 border-sky-500" },
                  { key: "isento",    label: "🎁 Isento",     cls: "bg-indigo-600/80 border-indigo-500" },
                ].map(s => (
                  <button key={s.key} onClick={() => setPerfPagStatus(s.key)}
                    className={`py-2 rounded-lg text-[10px] font-bold border transition ${perfPagStatus === s.key ? `${s.cls} text-white` : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"}`}>
                    {s.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Valor (R$)</label>
                  <input type="number" min="0" step="0.01" value={perfPagValor} onChange={e => setPerfPagValor(e.target.value)} placeholder="0,00"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Data do pagamento</label>
                  <input type="date" value={perfPagData} onChange={e => setPerfPagData(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
              </div>

              {/* Método */}
              <div>
                <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1.5">Forma de pagamento</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {["PIX", "Cartão", "Dinheiro", "Transferência", "Convênio"].map(m => (
                    <button key={m} onClick={() => setPerfPagMetodo(perfPagMetodo === m ? "" : m)}
                      className={`py-2 rounded-lg text-[10px] font-bold border transition ${perfPagMetodo === m ? "bg-sky-600/80 text-white border-sky-500" : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Observações do pagamento</label>
                <input value={perfPagObs} onChange={e => setPerfPagObs(e.target.value)} placeholder="Ex: parcela 2/3, recibo enviado..."
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
              </div>
            </div>

            {/* Salvar */}
            <button
              onClick={handleSaveProfile}
              disabled={savingPerf}
              className={`w-full py-3 rounded-xl text-sm font-black transition flex items-center justify-center gap-2 ${
                perfSaved
                  ? "bg-emerald-600 text-white"
                  : "bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-500/20"
              } disabled:opacity-50`}
            >
              {savingPerf ? (
                <><Save size={14} className="animate-spin" /> Salvando...</>
              ) : perfSaved ? (
                <><CheckCheck size={14} /> Salvo com sucesso!</>
              ) : (
                <><Save size={14} /> Salvar Perfil</>
              )}
            </button>
          </div>
        )}

        {/* ── NOTAS FISCAIS TAB ── */}
        {tab === "notas" && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">

            {/* Upload form */}
            <div className="rounded-xl border border-white/10 p-4 space-y-3" style={{ background: "rgba(255,255,255,0.03)" }}>
              <p className="text-white/60 text-xs font-bold uppercase tracking-wide">Anexar Nova Nota Fiscal</p>

              {/* File picker */}
              <div
                onClick={() => nfFileRef.current?.click()}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed cursor-pointer transition ${nfFile ? "border-emerald-500/50 bg-emerald-500/5" : "border-white/15 hover:border-white/30"}`}
              >
                <Upload size={16} className={nfFile ? "text-emerald-400" : "text-white/30"} />
                <div>
                  <p className={`text-xs font-bold ${nfFile ? "text-emerald-300" : "text-white/40"}`}>
                    {nfFile ? nfFile.name : "Clique para selecionar PDF, XML ou imagem"}
                  </p>
                  {nfFile && <p className="text-white/30 text-[10px]">{fmtFileSize(nfFile.size)}</p>}
                </div>
                <input ref={nfFileRef} type="file" accept=".pdf,.xml,image/*" className="hidden"
                  onChange={e => setNfFile(e.target.files?.[0] || null)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Nº da Nota</label>
                  <input value={nfNumero} onChange={e => setNfNumero(e.target.value)} placeholder="12345"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Data de Emissão</label>
                  <input type="date" value={nfData} onChange={e => setNfData(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Valor (R$)</label>
                  <input type="number" min="0" step="0.01" value={nfValor} onChange={e => setNfValor(e.target.value)} placeholder="0,00"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Observações</label>
                  <input value={nfObs} onChange={e => setNfObs(e.target.value)} placeholder="Tipo de consulta..."
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
              </div>

              <button onClick={handleNfUpload} disabled={!nfFile || uploadingNf}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition disabled:opacity-40">
                {uploadingNf ? "Enviando..." : "Anexar Nota Fiscal"}
              </button>
            </div>

            {/* NF List */}
            {nfs.length === 0 ? (
              <div className="text-center py-8">
                <FileText size={28} className="text-white/15 mx-auto mb-2" />
                <p className="text-white/25 text-xs">Nenhuma nota fiscal anexada</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-wide">{nfs.length} nota{nfs.length !== 1 ? "s" : ""} fiscal{nfs.length !== 1 ? "is" : ""}</p>
                {nfs.map(nf => (
                  <div key={nf.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/10 group" style={{ background: "rgba(255,255,255,0.03)" }}>
                    <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
                      <FileText size={14} className="text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white/80 text-xs font-bold truncate">{nf.file_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {nf.numero_nf && <span className="text-white/40 text-[10px]">NF {nf.numero_nf}</span>}
                        {nf.data_emissao && <span className="text-white/30 text-[10px]">{new Date(nf.data_emissao).toLocaleDateString("pt-BR")}</span>}
                        {nf.valor && <span className="text-emerald-400 text-[10px] font-black">{Number(nf.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>}
                        <span className="text-white/20 text-[10px]">{fmtFileSize(nf.file_size || 0)}</span>
                      </div>
                      {nf.observacoes && <p className="text-white/30 text-[10px] truncate">{nf.observacoes}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => handleNfDownload(nf)} disabled={downloadingId === nf.id}
                        title="Baixar / Visualizar"
                        className="p-1.5 rounded-lg hover:bg-sky-500/20 text-white/30 hover:text-sky-400 transition disabled:opacity-40">
                        <Download size={13} />
                      </button>
                      <button onClick={() => handleNfDelete(nf)} disabled={deletingNfId === nf.id}
                        title="Excluir"
                        className="p-1.5 rounded-lg hover:bg-rose-500/20 text-white/20 hover:text-rose-400 transition disabled:opacity-40">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Notes + delete footer */}
        <div className="px-5 py-3 border-t border-white/10 flex-shrink-0 flex gap-2">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} onBlur={handleNotesBlur}
            placeholder="Observações internas..." rows={2}
            className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none" />
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 transition self-start">
              <Trash2 size={14} />
            </button>
          ) : (
            <div className="flex flex-col gap-1 self-start">
              <button onClick={handleDelete} className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold">Deletar</button>
              <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 rounded-lg bg-white/10 text-white/50 text-[10px]">Cancelar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
