import { useEffect, useState, useRef, useCallback } from "react";
import { X, Send, Trash2, Calendar, ChevronDown, FileText, Upload, Download, AlertCircle, Copy, CheckCheck, UserCircle, Save, Paperclip, Mic, Square, Zap, CornerUpLeft, Plus, Search } from "lucide-react";
import {
  fetchMessages, sendMessage, updateLeadStage, updateLeadNotes, deleteLead,
  fetchMedicos, fetchSlotsDisponiveis, createAgendamento, STAGES,
  fetchNotasFiscais, uploadNotaFiscal, getNotaFiscalUrl, deleteNotaFiscal,
  updateLeadProfile, updateLeadPendencia, sendMediaWhatsApp, sendPttWhatsApp,
  fetchQuickReplies, createQuickReply, deleteQuickReply,
} from "../lib/api";
import { supabase } from "../lib/supabase";

interface Props {
  lead: any;
  currentUser: any;
  onClose: () => void;
  onUpdated: () => void;
  onGoFinanceiro?: (patientName: string) => void;
  onGoAgenda?: () => void;
}

function fmtFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function LeadModal({ lead, currentUser, onClose, onUpdated, onGoFinanceiro, onGoAgenda }: Props) {
  const [messages, setMessages]   = useState<any[]>([]);
  const [text, setText]           = useState("");
  const [sending, setSending]     = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
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
  const [agendIndicacao, setAgendIndicacao] = useState("");
  const [agendTipo,      setAgendTipo]      = useState("");
  const [horaManual, setHoraManual] = useState("");
  const [agendadoErr, setAgendadoErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sendError, setSendError]         = useState(false);
  const [pendencia, setPendencia]         = useState(!!lead.pendencia_financeira);
  const [recording, setRecording]         = useState(false);
  const [recordSecs, setRecordSecs]       = useState(0);
  const [audioBlob, setAudioBlob]         = useState<Blob | null>(null);
  const [selectedFile, setSelectedFile]   = useState<File | null>(null);
  const [sendingMedia, setSendingMedia]   = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef     = useRef<HTMLInputElement>(null);
  const [quickReplies, setQuickReplies]   = useState<any[]>([]);
  const [showQR, setShowQR]               = useState(false);
  const [qrSearch, setQrSearch]           = useState("");
  const [showNewQR, setShowNewQR]         = useState(false);
  const [newQRTitle, setNewQRTitle]       = useState("");
  const [newQRBody, setNewQRBody]         = useState("");
  const [savingQR, setSavingQR]           = useState(false);
  const [forwardText, setForwardText]     = useState<string | null>(null);
  const [copied, setCopied]               = useState(false);

  // Perfil / pagamento
  const [perfNome,      setPerfNome]      = useState(lead.name || "");
  const [perfEmail,     setPerfEmail]     = useState(lead.email || "");
  const [perfOrigem,    setPerfOrigem]    = useState(lead.origem || "");
  const [perfCpf,       setPerfCpf]       = useState(lead.cpf ? lead.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : "");
  const [perfNasc,      setPerfNasc]      = useState(lead.data_nascimento || "");
  const [perfSexo,      setPerfSexo]      = useState(lead.sexo || "");
  const [perfConvenio,  setPerfConvenio]  = useState(lead.convenio || "");
  const [perfCep,       setPerfCep]       = useState(lead.cep ? lead.cep.replace(/(\d{5})(\d{3})/, "$1-$2") : "");
  const [perfEndereco,  setPerfEndereco]  = useState(lead.endereco || "");
  const [perfNumero,    setPerfNumero]    = useState(lead.numero || "");
  const [perfCompl,     setPerfCompl]     = useState(lead.complemento || "");
  const [perfBairro,    setPerfBairro]    = useState(lead.bairro || "");
  const [perfCidade,    setPerfCidade]    = useState(lead.cidade || "");
  const [perfEstado,    setPerfEstado]    = useState(lead.estado || "");
  const [perfPagStatus,    setPerfPagStatus]    = useState(lead.pagamento_status || "pendente");
  const [perfPagValor,     setPerfPagValor]     = useState(lead.pagamento_valor != null ? String(lead.pagamento_valor) : "");
  const [perfPagMetodo,    setPerfPagMetodo]    = useState(lead.pagamento_metodo || "");
  const [perfPagData,      setPerfPagData]      = useState(lead.pagamento_data || "");
  const [perfPagObs,       setPerfPagObs]       = useState(lead.pagamento_obs || "");
  const [perfDataVenda,    setPerfDataVenda]    = useState(lead.data_venda || "");
  const [perfBandeira,     setPerfBandeira]     = useState(lead.bandeira_cartao || "");
  const [perfTaxaCartao,   setPerfTaxaCartao]   = useState(lead.taxa_cartao != null ? String(lead.taxa_cartao) : "");
  const [perfTaxasDiversas,setPerfTaxasDiversas] = useState(lead.taxas_diversas != null ? String(lead.taxas_diversas) : "");
  const [perfParcelas,     setPerfParcelas]     = useState(lead.num_parcelas ? String(lead.num_parcelas) : "1");
  const [savingPerf,       setSavingPerf]       = useState(false);
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
  const [sendingNfId, setSendingNfId]     = useState<string | null>(null);
  const nfFileRef = useRef<HTMLInputElement>(null);

  const refreshMessages = useCallback(async () => {
    const msgs = await fetchMessages(lead.id);
    setMessages(msgs);
  }, [lead.id]);

  // Auto-trigger análise ao abrir o chat (apenas se última mensagem for do paciente)
  useEffect(() => {
    fetchQuickReplies().then(setQuickReplies);
  }, []);

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

  async function handleSaveQR() {
    if (!newQRTitle.trim() || !newQRBody.trim()) return;
    setSavingQR(true);
    await createQuickReply(newQRTitle.trim(), newQRBody.trim());
    const updated = await fetchQuickReplies();
    setQuickReplies(updated);
    setNewQRTitle(""); setNewQRBody(""); setShowNewQR(false);
    setSavingQR(false);
  }

  async function handleDeleteQR(id: string) {
    await deleteQuickReply(id);
    setQuickReplies(prev => prev.filter(q => q.id !== id));
  }

  function useQuickReply(body: string) {
    setText(body);
    setShowQR(false);
    setQrSearch("");
  }

  function handleForward(body: string) {
    setText(`> ${body}\n\n`);
    setForwardText(null);
  }

  function fmtSecs(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        setAudioBlob(new Blob(chunksRef.current, { type: mimeType }));
        stream.getTracks().forEach(t => t.stop());
        clearInterval(timerRef.current!);
      };
      mediaRecorderRef.current = mr;
      mr.start(100);
      setRecording(true);
      setRecordSecs(0);
      timerRef.current = setInterval(() => setRecordSecs(s => s + 1), 1000);
    } catch { alert("Microfone não disponível ou sem permissão."); }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  async function handleSendMedia() {
    if (!selectedFile && !audioBlob) return;
    setSendingMedia(true);
    if (audioBlob) {
      await sendPttWhatsApp(lead.phone, audioBlob);
      setAudioBlob(null);
      setRecordSecs(0);
    } else if (selectedFile) {
      await sendMediaWhatsApp(lead.phone, selectedFile);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    setSendingMedia(false);
    setTimeout(() => fetchMessages(lead.id).then(setMessages), 2000);
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
    const horario = horaManual;
    if (!medicoId || !data || !horario) return;
    setAgendando(true);
    setAgendadoErr("");
    const ag = await createAgendamento({
      lead_id: lead.id,
      medico_id: medicoId,
      data_hora: `${data}T${horario}:00`,
      indicacao: agendIndicacao || undefined,
      tipo_procedimento: agendTipo || undefined,
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

  async function handleNfSendWhatsApp(nf: any) {
    setSendingNfId(nf.id);
    try {
      const url = await getNotaFiscalUrl(nf.file_path);
      if (!url) throw new Error("link");
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("fetch");
      const blob = await resp.blob();
      const file = new File([blob], nf.file_name, { type: blob.type || "application/octet-stream" });
      const ok = await sendMediaWhatsApp(lead.phone, file);
      if (!ok) throw new Error("send");
    } catch {
      alert("Erro ao enviar NF pelo WhatsApp.");
    } finally {
      setSendingNfId(null);
    }
  }

  async function handleSaveProfile() {
    setSavingPerf(true);
    const ok = await updateLeadProfile(lead.id, {
      name:              perfNome || undefined,
      email:             perfEmail || undefined,
      cpf:               perfCpf.replace(/\D/g, "") || undefined,
      data_nascimento:   perfNasc || undefined,
      sexo:              perfSexo || undefined,
      origem:            perfOrigem || undefined,
      convenio:          perfConvenio || undefined,
      endereco:          perfEndereco || undefined,
      numero:            perfNumero || undefined,
      complemento:       perfCompl || undefined,
      bairro:            perfBairro || undefined,
      cidade:            perfCidade || undefined,
      estado:            perfEstado || undefined,
      cep:               perfCep.replace(/\D/g, "") || undefined,
      pagamento_status:  perfPagStatus || undefined,
      pagamento_valor:   perfPagValor ? parseFloat(perfPagValor.replace(",", ".")) : null,
      pagamento_metodo:  perfPagMetodo || undefined,
      pagamento_data:    perfPagData || undefined,
      pagamento_obs:     perfPagObs || undefined,
      data_venda:        perfDataVenda || undefined,
      bandeira_cartao:   perfBandeira || undefined,
      taxa_cartao:       perfTaxaCartao ? parseFloat(perfTaxaCartao.replace(",", ".")) : null,
      taxas_diversas:    perfTaxasDiversas ? parseFloat(perfTaxasDiversas.replace(",", ".")) : null,
      num_parcelas:      parseInt(perfParcelas) || 1,
    });
    setSavingPerf(false);
    if (ok) {
      onUpdated();
      const temPagamento = perfPagValor && parseFloat(perfPagValor) > 0 && perfPagStatus === "pago";
      if (temPagamento && onGoFinanceiro) {
        onGoFinanceiro(perfNome || lead.name || "");
      } else {
        setPerfSaved(true);
        setTimeout(() => setPerfSaved(false), 900);
      }
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
            <div className="flex items-center gap-2">
              <p className="text-white font-black">{name}</p>
              {lead.numero_prontuario && (
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  #{String(lead.numero_prontuario).padStart(3, "0")}
                </span>
              )}
            </div>
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
          <button onClick={() => onGoAgenda ? onGoAgenda() : setTab("agendar")}
            className="px-4 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap text-white/40 hover:text-white/60 hover:bg-emerald-500/10">
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
            {/* Respostas Rápidas — painel expansível */}
            <div className="flex-shrink-0 border-b border-white/8">
              <button
                onClick={() => { setShowQR(v => !v); setShowNewQR(false); setQrSearch(""); }}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-left transition ${showQR ? "bg-emerald-600/10" : "hover:bg-white/3"}`}
              >
                <Zap size={12} className={showQR ? "text-emerald-400" : "text-white/30"} />
                <span className={`text-[11px] font-black ${showQR ? "text-emerald-300" : "text-white/35"}`}>Respostas Rápidas</span>
                <span className="text-[10px] text-white/20 ml-1">{quickReplies.length} salvas</span>
                <span className={`ml-auto text-white/20 text-[10px] transition-transform ${showQR ? "rotate-180" : ""}`}>▼</span>
              </button>

              {showQR && (
                <div className="px-3 pb-3 space-y-2" style={{ background: "rgba(5,150,105,0.04)" }}>
                  {/* Busca */}
                  <div className="relative">
                    <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none" />
                    <input value={qrSearch} onChange={e => setQrSearch(e.target.value)} placeholder="Buscar resposta..."
                      className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
                  </div>

                  {/* Lista */}
                  <div className="space-y-2 max-h-52 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
                    {quickReplies.filter(q =>
                      !qrSearch || q.title.toLowerCase().includes(qrSearch.toLowerCase()) || q.body.toLowerCase().includes(qrSearch.toLowerCase())
                    ).map(q => (
                      <div key={q.id} className="group flex items-start gap-2.5 px-3 py-3 rounded-xl bg-white/4 hover:bg-white/7 border border-white/8 hover:border-emerald-500/30 transition cursor-pointer"
                        onClick={() => useQuickReply(q.body)}>
                        <Zap size={13} className="shrink-0 text-emerald-400/70 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-black text-emerald-300 mb-1">{q.title}</p>
                          <p className="text-[11px] text-white/50 leading-relaxed line-clamp-2">{q.body}</p>
                        </div>
                        <button type="button" onClick={e => { e.stopPropagation(); handleDeleteQR(q.id); }}
                          className="shrink-0 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-rose-500/20 text-rose-400 transition">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                    {!quickReplies.length && (
                      <p className="text-center text-white/20 text-xs py-4">Nenhuma resposta salva ainda</p>
                    )}
                  </div>

                  {/* Nova resposta */}
                  {!showNewQR ? (
                    <button onClick={() => setShowNewQR(true)}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-emerald-500/30 text-emerald-400/70 hover:text-emerald-300 hover:border-emerald-500/50 text-[11px] font-bold transition">
                      <Plus size={11} /> Nova resposta rápida
                    </button>
                  ) : (
                    <div className="space-y-1.5 p-2 rounded-lg bg-white/5 border border-emerald-500/20">
                      <input value={newQRTitle} onChange={e => setNewQRTitle(e.target.value)} placeholder="Título (ex: Confirmação de consulta)"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
                      <textarea value={newQRBody} onChange={e => setNewQRBody(e.target.value)} placeholder="Texto da mensagem..." rows={3}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 resize-none" />
                      <div className="flex gap-1.5">
                        <button onClick={handleSaveQR} disabled={savingQR || !newQRTitle.trim() || !newQRBody.trim()}
                          className="flex-1 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white text-[11px] font-black transition disabled:opacity-40">
                          {savingQR ? "Salvando..." : "Salvar"}
                        </button>
                        <button onClick={() => { setShowNewQR(false); setNewQRTitle(""); setNewQRBody(""); }}
                          className="px-3 py-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white text-[11px] transition">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
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
                    <div className={`group flex items-end gap-1 ${isOut ? "justify-end" : "justify-start"}`}>
                      {/* Botão encaminhar — lado esquerdo para mensagens de saída */}
                      {isOut && m.body && (
                        <button type="button" onClick={() => handleForward(m.body)}
                          title="Encaminhar / Citar"
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-white/10 text-white/30 hover:text-white/70 transition shrink-0 self-center">
                          <CornerUpLeft size={12} />
                        </button>
                      )}
                      <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-[13px] leading-[1.65] ${bubble}`}>
                        {isOut && m.sender_nome && (
                          <p className={`text-[10px] font-black mb-1 ${isMaria ? "text-violet-300" : "text-emerald-300"}`}>
                            {isMaria ? "🤖 Maria IA" : `💬 ${m.sender_nome}`}
                          </p>
                        )}
                        {m.media_type === "image" && m.media_url ? (
                          <a href={m.media_url} target="_blank" rel="noreferrer">
                            <img src={m.media_url} alt={m.media_filename || "imagem"} className="rounded-lg max-w-full max-h-60 object-cover mb-2 cursor-zoom-in" />
                          </a>
                        ) : m.media_type === "audio" && m.media_url ? (
                          <audio controls src={m.media_url} className="w-full max-w-[220px] mb-2" />
                        ) : m.media_type === "video" && m.media_url ? (
                          <video controls src={m.media_url} className="rounded-lg max-w-full max-h-60 mb-2" />
                        ) : m.media_type === "document" && m.media_url ? (
                          <a href={m.media_url} target="_blank" rel="noreferrer"
                            className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 transition mb-2">
                            <FileText size={14} className="shrink-0 text-sky-300" />
                            <span className="text-xs truncate max-w-[160px]">{m.media_filename || m.body || "Documento"}</span>
                            <Download size={12} className="shrink-0 text-white/40 ml-auto" />
                          </a>
                        ) : m.media_type === "sticker" && m.media_url ? (
                          <img src={m.media_url} alt="sticker" className="w-20 h-20 object-contain mb-2" />
                        ) : null}
                        {m.body && !["image","video","sticker"].includes(m.media_type) && (
                          <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        )}
                        {m.body && m.media_type === "image" && m.body !== "[image]" && (
                          <p className="whitespace-pre-wrap break-words text-white/70 italic text-[12px] mt-1">{m.body}</p>
                        )}
                        <p className={`text-[10px] mt-1 ${timeClr}`}>{timeStr}</p>
                      </div>
                      {/* Botão encaminhar — lado direito para mensagens recebidas */}
                      {!isOut && m.body && (
                        <button type="button" onClick={() => handleForward(m.body)}
                          title="Encaminhar / Citar"
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-white/10 text-white/30 hover:text-white/70 transition shrink-0 self-center">
                          <CornerUpLeft size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={handleSend} className="flex flex-col gap-1.5 px-5 py-3 border-t border-white/10 flex-shrink-0">
              <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" className="hidden"
                onChange={e => { if (e.target.files?.[0]) { setSelectedFile(e.target.files[0]); setAudioBlob(null); } }} />

              {sendError && (
                <p className="text-xs text-red-400 font-bold flex items-center gap-1">
                  <AlertCircle size={12} /> Falha ao enviar — verifique a conexão com WhatsApp
                </p>
              )}

              {/* Emoji picker */}
              {showEmoji && (
                <div className="flex flex-wrap gap-1 p-2 rounded-xl bg-white/5 border border-white/10">
                  {["😊","😄","👍","🙏","❤️","✅","🎉","💪","🔥","⭐","😍","🤗","💬","📅","🩺","💊","🥗","🌿","🏥","👨‍⚕️","🧘","💧","🍎","😴","🌟","🤩","😅","😬","🤔","👋"].map(em => (
                    <button key={em} type="button" onClick={() => setText(t => t + em)}
                      className="text-lg hover:scale-125 transition-transform leading-none w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/10">
                      {em}
                    </button>
                  ))}
                </div>
              )}

              {/* Arquivo selecionado */}
              {selectedFile && !recording && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-500/10 border border-sky-500/20">
                  <Paperclip size={12} className="text-sky-400 shrink-0" />
                  <span className="flex-1 text-xs text-sky-300 truncate">{selectedFile.name} ({fmtFileSize(selectedFile.size)})</span>
                  <button type="button" onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    className="text-white/30 hover:text-white transition text-sm">✕</button>
                </div>
              )}

              {/* Áudio pronto */}
              {audioBlob && !recording && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <Mic size={12} className="text-emerald-400 shrink-0" />
                  <span className="text-xs text-emerald-300">Áudio gravado — {fmtSecs(recordSecs)}</span>
                  <button type="button" onClick={() => { setAudioBlob(null); setRecordSecs(0); }}
                    className="ml-auto text-white/30 hover:text-white transition text-sm">✕</button>
                </div>
              )}

              {/* Gravando */}
              {recording && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                  <span className="text-xs text-red-400 font-bold">Gravando... {fmtSecs(recordSecs)}</span>
                  <button type="button" onClick={stopRecording}
                    className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-lg bg-red-500/20 hover:bg-red-500/40 text-red-400 text-xs font-bold transition">
                    <Square size={10} /> Parar
                  </button>
                </div>
              )}

              {/* Linha de input */}
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setShowEmoji(v => !v)}
                  className={`px-2.5 py-2 rounded-xl border text-base transition shrink-0 ${showEmoji ? "bg-amber-500/20 border-amber-500/40 text-amber-300" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                  title="Emojis">😊</button>

                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="p-2 rounded-xl border bg-white/5 border-white/10 text-white/40 hover:text-white/70 transition shrink-0"
                  title="Enviar arquivo ou imagem">
                  <Paperclip size={14} />
                </button>

                <button type="button"
                  onClick={recording ? stopRecording : startRecording}
                  disabled={!!selectedFile || !!audioBlob}
                  className={`p-2 rounded-xl border transition shrink-0 disabled:opacity-30 ${recording ? "bg-red-500/20 border-red-500/40 text-red-400 animate-pulse" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                  title={recording ? "Parar gravação" : "Gravar áudio"}>
                  <Mic size={14} />
                </button>

                {!audioBlob && !selectedFile && !recording && (
                  <input value={text} onChange={e => setText(e.target.value)} placeholder="Mensagem..."
                    className={`flex-1 px-3 py-2 rounded-xl bg-white/5 border text-white text-sm placeholder-white/30 focus:outline-none focus:ring-2 transition ${sendError ? "border-red-500/50 focus:ring-red-500/30" : "border-white/10 focus:ring-emerald-500/50"}`} />
                )}
                {(audioBlob || selectedFile || recording) && <div className="flex-1" />}

                {(audioBlob || selectedFile) ? (
                  <button type="button" onClick={handleSendMedia} disabled={sendingMedia}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition disabled:opacity-40 shrink-0">
                    {sendingMedia ? "..." : <Send size={14} />}
                  </button>
                ) : (
                  <button type="submit" disabled={sending || !text.trim() || recording}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition disabled:opacity-40 shrink-0">
                    <Send size={14} />
                  </button>
                )}
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

            {/* Indicação */}
            <div>
              <label className="block text-white/60 text-xs font-bold mb-1.5">📣 Indicação / Captação</label>
              <input value={agendIndicacao} onChange={e => setAgendIndicacao(e.target.value)}
                placeholder="Ex: Dra. Vanessa, Instagram, Doctoralia..."
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
            </div>

            {/* Tipo de procedimento */}
            <div>
              <label className="block text-white/60 text-xs font-bold mb-1.5">🔬 Tipo de procedimento</label>
              <input value={agendTipo} onChange={e => setAgendTipo(e.target.value)}
                placeholder="Ex: Consulta inicial, Retorno, Avaliação corporal..."
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
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
                : `✅ Confirmar — ${data.split("-").reverse().join("/")} às ${horaManual}`}
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
                Identificação
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
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">CPF</label>
                  <input value={perfCpf}
                    onChange={e => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 11);
                      const fmt = v.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, (_, a, b, c, d) => d ? `${a}.${b}.${c}-${d}` : c ? `${a}.${b}.${c}` : b ? `${a}.${b}` : a);
                      setPerfCpf(fmt);
                    }}
                    placeholder="000.000.000-00" maxLength={14}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-mono placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Data de Nascimento</label>
                  <input type="date" value={perfNasc} onChange={e => setPerfNasc(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">E-mail</label>
                  <input type="email" value={perfEmail} onChange={e => setPerfEmail(e.target.value)} placeholder="paciente@email.com"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Convênio</label>
                  <input value={perfConvenio} onChange={e => setPerfConvenio(e.target.value)} placeholder="Unimed, Particular..."
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
              </div>
              <div>
                <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1.5">Sexo</label>
                <div className="flex gap-2">
                  {[["M","Masculino"],["F","Feminino"],["O","Outro"]].map(([v,l]) => (
                    <button key={v} type="button" onClick={() => setPerfSexo(perfSexo === v ? "" : v)}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition ${perfSexo === v ? "bg-emerald-600/80 text-white border-emerald-500" : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1.5">Por onde veio</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {["WhatsApp", "Google", "Instagram", "Facebook", "Indicação", "Doctoralia", "TikTok", "Outro"].map(op => (
                    <button key={op} type="button" onClick={() => setPerfOrigem(perfOrigem === op ? "" : op)}
                      className={`py-1.5 px-2 rounded-lg text-[10px] font-bold border transition ${perfOrigem === op ? "bg-emerald-600/80 text-white border-emerald-500" : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"}`}>
                      {op === "WhatsApp" ? "📱" : op === "Google" ? "🔍" : op === "Instagram" ? "📸" : op === "Facebook" ? "👥" : op === "Indicação" ? "🤝" : op === "Doctoralia" ? "🏥" : op === "TikTok" ? "🎵" : "❓"} {op}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Endereço */}
            <div className="rounded-xl border border-white/10 p-4 space-y-3" style={{ background: "rgba(255,255,255,0.03)" }}>
              <p className="text-white/60 text-[10px] font-black uppercase tracking-wider">📍 Endereço</p>
              <div className="grid grid-cols-6 gap-2">
                <div className="col-span-2">
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">CEP</label>
                  <input value={perfCep}
                    onChange={async e => {
                      const raw = e.target.value.replace(/\D/g, "").slice(0, 8);
                      const fmt = raw.length > 5 ? `${raw.slice(0,5)}-${raw.slice(5)}` : raw;
                      setPerfCep(fmt);
                      if (raw.length === 8) {
                        try {
                          const r = await fetch(`https://viacep.com.br/ws/${raw}/json/`);
                          const d = await r.json();
                          if (!d.erro) { setPerfEndereco(d.logradouro || ""); setPerfBairro(d.bairro || ""); setPerfCidade(d.localidade || ""); setPerfEstado(d.uf || ""); }
                        } catch {}
                      }
                    }}
                    placeholder="00000-000" maxLength={9}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-mono placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div className="col-span-4">
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Logradouro</label>
                  <input value={perfEndereco} onChange={e => setPerfEndereco(e.target.value)} placeholder="Rua, Av..."
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div className="col-span-1">
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Nº</label>
                  <input value={perfNumero} onChange={e => setPerfNumero(e.target.value)} placeholder="123"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div className="col-span-2">
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Complemento</label>
                  <input value={perfCompl} onChange={e => setPerfCompl(e.target.value)} placeholder="Apto..."
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div className="col-span-3">
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Bairro</label>
                  <input value={perfBairro} onChange={e => setPerfBairro(e.target.value)} placeholder="Asa Norte..."
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div className="col-span-4">
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Cidade</label>
                  <input value={perfCidade} onChange={e => setPerfCidade(e.target.value)} placeholder="Brasília"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div className="col-span-2">
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Estado</label>
                  <select value={perfEstado} onChange={e => setPerfEstado(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40">
                    <option value="">UF</option>
                    {["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map(uf => (
                      <option key={uf} value={uf}>{uf}</option>
                    ))}
                  </select>
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

              {/* Datas */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Data da venda</label>
                  <input type="date" value={perfDataVenda} onChange={e => setPerfDataVenda(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Data do pagamento</label>
                  <input type="date" value={perfPagData} onChange={e => setPerfPagData(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
              </div>

              {/* Valor */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Valor (R$)</label>
                  <input type="number" min="0" step="0.01" value={perfPagValor} onChange={e => setPerfPagValor(e.target.value)} placeholder="0,00"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Taxa cartão (%)</label>
                  <input type="number" min="0" step="0.01" max="100" value={perfTaxaCartao} onChange={e => setPerfTaxaCartao(e.target.value)} placeholder="0,00"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Taxas diversas (R$)</label>
                  <input type="number" min="0" step="0.01" value={perfTaxasDiversas} onChange={e => setPerfTaxasDiversas(e.target.value)} placeholder="0,00"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
              </div>
              {/* Valor Líquido calculado */}
              {perfPagValor && (Number(perfTaxaCartao) > 0 || Number(perfTaxasDiversas) > 0) && (() => {
                const bruto    = parseFloat(perfPagValor) || 0;
                const taxaCard = bruto * (parseFloat(perfTaxaCartao) || 0) / 100;
                const taxaDiv  = parseFloat(perfTaxasDiversas) || 0;
                const liquido  = bruto - taxaCard - taxaDiv;
                return (
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20">
                    <span className="text-white/40 text-[10px] font-bold uppercase tracking-wide">Valor Líquido</span>
                    <span className="text-emerald-300 font-black text-sm">
                      {liquido.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </span>
                  </div>
                );
              })()}

              {/* Método */}
              <div>
                <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1.5">Forma de pagamento</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {["PIX", "Cartão Déb.", "Cartão Créd.", "Dinheiro", "Transferência", "Convênio"].map(m => (
                    <button key={m} onClick={() => { setPerfPagMetodo(perfPagMetodo === m ? "" : m); if (m !== "Cartão Créd.") setPerfParcelas("1"); }}
                      className={`py-2 rounded-lg text-[10px] font-bold border transition ${perfPagMetodo === m ? "bg-sky-600/80 text-white border-sky-500" : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bandeira do cartão */}
              {(perfPagMetodo === "Cartão Déb." || perfPagMetodo === "Cartão Créd.") && (
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1.5">Bandeira</label>
                  <div className="grid grid-cols-6 gap-1.5">
                    {["Visa", "Master", "Elo", "Amex", "Hipercard", "Outra"].map(b => (
                      <button key={b} onClick={() => setPerfBandeira(perfBandeira === b ? "" : b)}
                        className={`py-2 rounded-lg text-[10px] font-bold border transition ${perfBandeira === b ? "bg-violet-600/80 text-white border-violet-500" : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"}`}>
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Parcelas — só cartão crédito */}
              {perfPagMetodo === "Cartão Créd." && (
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1.5">Parcelas</label>
                  <div className="grid grid-cols-6 gap-1.5">
                    {["1","2","3","4","5","6","7","8","9","10","11","12"].map(p => (
                      <button key={p} onClick={() => setPerfParcelas(p)}
                        className={`py-2 rounded-lg text-[10px] font-bold border transition ${perfParcelas === p ? "bg-emerald-600/80 text-white border-emerald-500" : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"}`}>
                        {p}x
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Tabela de parcelas calculada */}
              {perfPagMetodo === "Cartão Créd." && parseInt(perfParcelas) > 1 && perfPagValor && perfPagData && (() => {
                const total    = parseFloat(perfPagValor) || 0;
                const n        = parseInt(perfParcelas);
                const base     = Math.floor((total / n) * 100) / 100;
                const ultima   = Math.round((total - base * (n - 1)) * 100) / 100;
                const primeira = new Date(perfPagData + "T12:00:00");
                return (
                  <div className="rounded-xl border border-emerald-500/20 overflow-hidden">
                    <div className="px-3 py-2 flex items-center justify-between" style={{ background: "rgba(5,150,105,0.08)" }}>
                      <span className="text-emerald-300 text-[10px] font-black uppercase tracking-wider">
                        {n}x de {base.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </span>
                      <span className="text-white/40 text-[10px]">Total {total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
                    </div>
                    <div className="divide-y divide-white/5">
                      {Array.from({ length: n }, (_, i) => {
                        const d = new Date(primeira);
                        d.setMonth(d.getMonth() + i);
                        const valor = i === n - 1 ? ultima : base;
                        return (
                          <div key={i} className="flex items-center justify-between px-3 py-1.5">
                            <span className="text-white/50 text-[10px]">{i + 1}ª parcela · {d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
                            <span className="text-emerald-300 text-[10px] font-black">{valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

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
                      <button onClick={() => handleNfSendWhatsApp(nf)} disabled={sendingNfId === nf.id}
                        title="Enviar NF pelo WhatsApp do paciente"
                        className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-white/30 hover:text-emerald-400 transition disabled:opacity-40">
                        {sendingNfId === nf.id ? <span className="text-[9px] text-emerald-400">...</span> : <span className="text-[11px]">📲</span>}
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

        {/* Notes + actions footer */}
        <div className="px-5 py-3 border-t border-white/10 flex-shrink-0 flex gap-2">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} onBlur={handleNotesBlur}
            placeholder="Observações internas..." rows={2}
            className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none" />
          <div className="flex flex-col gap-1 self-start">
            {/* Botão deletar */}
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)} className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 transition">
                <Trash2 size={14} />
              </button>
            ) : (
              <>
                <button onClick={handleDelete} className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold">Deletar</button>
                <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 rounded-lg bg-white/10 text-white/50 text-[10px]">Cancelar</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
