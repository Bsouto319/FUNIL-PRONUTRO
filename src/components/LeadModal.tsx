import { useEffect, useState, useRef } from "react";
import { X, Send, Trash2, Calendar, ChevronDown, FileText, Upload, Download, AlertCircle } from "lucide-react";
import {
  fetchMessages, sendMessage, updateLeadStage, updateLeadNotes, deleteLead,
  fetchMedicos, fetchSlotsDisponiveis, createAgendamento, STAGES,
  fetchNotasFiscais, uploadNotaFiscal, getNotaFiscalUrl, deleteNotaFiscal,
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
  const [tab, setTab]             = useState<"chat" | "agendar" | "notas">("chat");
  const [medicos, setMedicos]     = useState<any[]>([]);
  const [medicoId, setMedicoId]   = useState("");
  const [data, setData]           = useState("");
  const [slots, setSlots]         = useState<string[]>([]);
  const [slot, setSlot]           = useState("");
  const [agendando, setAgendando] = useState(false);
  const [agendadoOk, setAgendadoOk] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  useEffect(() => {
    fetchMessages(lead.id).then(setMessages);
    fetchMedicos().then(setMedicos);
    fetchNotasFiscais({ leadId: lead.id }).then(setNfs);
    const channel = supabase
      .channel(`pn_msg_${lead.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pn_mensagens", filter: `lead_id=eq.${lead.id}` },
        payload => setMessages(prev => [...prev, payload.new]))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [lead.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    await sendMessage(lead.id, lead.phone, text.trim(), currentUser.nome);
    setText("");
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

  async function loadSlots() {
    if (!medicoId || !data) return;
    const s = await fetchSlotsDisponiveis(medicoId, data);
    setSlots(s);
    setSlot("");
  }
  useEffect(() => { loadSlots(); }, [medicoId, data]);

  async function handleAgendar() {
    if (!medicoId || !data || !slot) return;
    setAgendando(true);
    const ag = await createAgendamento({ lead_id: lead.id, medico_id: medicoId, data_hora: `${data}T${slot}:00` });
    if (ag) {
      await updateLeadStage(lead.id, "agendado");
      setStage("agendado");
      setAgendadoOk(true);
      setTimeout(() => setAgendadoOk(false), 3000);
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
        <div className="flex gap-1 px-5 pt-3 flex-shrink-0">
          {(["chat", "agendar", "notas"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${tab === t ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60"}`}>
              {t === "chat" ? "💬 Chat" : t === "agendar" ? "📅 Agendar" : (
                <>
                  <FileText size={11} />
                  Notas Fiscais
                  {nfs.length > 0 && <span className="text-[9px] bg-emerald-500/30 text-emerald-300 px-1.5 py-0.5 rounded-full font-black">{nfs.length}</span>}
                </>
              )}
            </button>
          ))}
        </div>

        {/* ── CHAT TAB ── */}
        {tab === "chat" && (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2 min-h-0">
              {messages.length === 0 && (
                <p className="text-white/20 text-xs text-center py-8">Sem mensagens ainda</p>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${m.direction === "out" ? "bg-emerald-600/80 text-white rounded-br-sm" : "bg-white/10 text-white/90 rounded-bl-sm"}`}>
                    {m.direction === "out" && m.sender_nome && (
                      <p className="text-emerald-200/70 text-[10px] font-bold mb-0.5">{m.sender_nome}</p>
                    )}
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className={`text-[9px] mt-0.5 ${m.direction === "out" ? "text-emerald-200/50 text-right" : "text-white/30"}`}>
                      {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={handleSend} className="flex gap-2 px-5 py-3 border-t border-white/10 flex-shrink-0">
              <input value={text} onChange={e => setText(e.target.value)} placeholder="Mensagem..."
                className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition" />
              <button type="submit" disabled={sending || !text.trim()}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition disabled:opacity-40">
                <Send size={14} />
              </button>
            </form>
          </>
        )}

        {/* ── AGENDAR TAB ── */}
        {tab === "agendar" && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
            {agendadoOk && (
              <div className="text-emerald-300 text-sm font-bold text-center bg-emerald-500/10 border border-emerald-500/30 rounded-xl py-3">
                ✅ Consulta agendada! Lead movido para Agendado.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-white/60 text-xs font-bold mb-1.5">Médico</label>
                <select value={medicoId} onChange={e => setMedicoId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50">
                  <option value="">Selecione...</option>
                  {medicos.map(m => <option key={m.id} value={m.id}>{m.nome} — {m.especialidade}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-white/60 text-xs font-bold mb-1.5">Data</label>
                <input type="date" value={data} min={new Date().toISOString().slice(0, 10)} onChange={e => setData(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
              </div>
            </div>
            {medicoSel && (
              <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-3 text-xs">
                <p className="text-violet-300 font-bold">{medicoSel.nome}</p>
                <p className="text-white/50">{medicoSel.especialidade} · R$ {medicoSel.valor_particular}</p>
              </div>
            )}
            {slots.length > 0 ? (
              <div>
                <label className="block text-white/60 text-xs font-bold mb-2">Horário disponível</label>
                <div className="grid grid-cols-5 gap-2">
                  {slots.map(s => (
                    <button key={s} onClick={() => setSlot(s)}
                      className={`py-2 rounded-lg text-xs font-bold border transition ${slot === s ? "bg-emerald-600 text-white border-emerald-500" : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10"}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (medicoId && data) ? (
              <p className="text-white/30 text-xs text-center py-4">Nenhum horário disponível nesta data</p>
            ) : null}
            {slot && medicoId && data && (
              <button onClick={handleAgendar} disabled={agendando}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm transition disabled:opacity-50">
                {agendando ? "Agendando..." : `Confirmar — ${data.split("-").reverse().join("/")} às ${slot}`}
              </button>
            )}
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
