import { useCallback, useEffect, useState } from "react";
import { Search, Plus, X, FileText, ClipboardList, Printer, Send, ChevronRight, ChevronDown, ChevronUp, Check } from "lucide-react";
import {
  fetchLeads, fetchMedicos,
  fetchProntuarios, upsertProntuario,
  fetchDocumentos, insertDocumento, marcarDocumentoEnviado,
} from "../lib/api";

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function docLabel(tipo: string) {
  return tipo === "receita" ? "Receita Médica" : tipo === "atestado" ? "Atestado Médico" : "Encaminhamento";
}

// ── print helpers ─────────────────────────────────────────────────────────────

function printReceita(doc: any, p: any) {
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Receita</title>
<style>
  body{font-family:Arial,sans-serif;max-width:680px;margin:40px auto;padding:24px;color:#111}
  h1{font-size:20px;text-align:center;letter-spacing:2px;margin:0}
  .sub{text-align:center;font-size:11px;color:#666;margin-bottom:8px}
  hr.thick{border:none;border-top:2px solid #000;margin:12px 0}
  hr.thin{border:none;border-top:1px solid #ccc;margin:12px 0}
  .info{display:flex;gap:24px;font-size:12px;margin:10px 0}
  .info span{color:#555} .info strong{color:#111}
  .content{min-height:200px;font-size:13px;line-height:1.7;white-space:pre-wrap;margin:16px 0;padding:12px;border:1px solid #ddd;border-radius:4px}
  .ass{margin-top:60px;text-align:center}
  .ass-line{border-top:1px solid #000;display:inline-block;width:320px;padding-top:6px;font-size:12px}
  .footer{margin-top:40px;font-size:10px;color:#aaa;text-align:center}
  @media print{body{margin:0}}
</style></head><body>
<h1>PRONUTRO CLÍNICA</h1>
<p class="sub">Nutrição Esportiva e Clínica · Brasília-DF</p>
<hr class="thick">
<h2 style="text-align:center;font-size:15px;letter-spacing:1px;margin:10px 0">RECEITA MÉDICA</h2>
<hr class="thin">
<div class="info">
  <div><span>Paciente: </span><strong>${doc.nome_paciente || p.name || "—"}</strong></div>
  <div><span>Data: </span><strong>${fmtDate(doc.created_at)}</strong></div>
</div>
<div class="content">${doc.conteudo}</div>
<hr class="thick">
<div class="ass">
  <p style="margin:0;font-size:12px">${doc.medico_nome ? "Dr(a). " + doc.medico_nome : ""}</p>
  <span class="ass-line">CRN / Assinatura</span>
</div>
<p class="footer">Emitido em ${new Date().toLocaleDateString("pt-BR")} · ProNutro Clínica · Brasília-DF</p>
</body></html>`;
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

function printAtestado(doc: any, p: any) {
  const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Atestado</title>
<style>
  body{font-family:Arial,sans-serif;max-width:680px;margin:40px auto;padding:24px;color:#111}
  h1{font-size:20px;text-align:center;letter-spacing:2px;margin:0}
  .sub{text-align:center;font-size:11px;color:#666;margin-bottom:8px}
  hr.thick{border:none;border-top:2px solid #000;margin:12px 0}
  hr.thin{border:none;border-top:1px solid #ccc;margin:12px 0}
  .corpo{font-size:13px;line-height:1.9;margin:24px 0;text-align:justify}
  .obs{font-size:12px;color:#444;margin-top:12px;padding:10px;border-left:3px solid #ccc;white-space:pre-wrap}
  .ass{margin-top:60px;text-align:center}
  .ass-line{border-top:1px solid #000;display:inline-block;width:320px;padding-top:6px;font-size:12px}
  .footer{margin-top:40px;font-size:10px;color:#aaa;text-align:center}
  @media print{body{margin:0}}
</style></head><body>
<h1>PRONUTRO CLÍNICA</h1>
<p class="sub">Nutrição Esportiva e Clínica · Brasília-DF</p>
<hr class="thick">
<h2 style="text-align:center;font-size:15px;letter-spacing:1px;margin:10px 0">ATESTADO MÉDICO</h2>
<hr class="thin">
<div class="corpo">
  Atesto para os devidos fins que o(a) paciente <strong>${doc.nome_paciente || p.name || "—"}</strong>,
  esteve sob meus cuidados profissionais${doc.dias_afastamento ? `, necessitando de afastamento de <strong>${doc.dias_afastamento} dia(s)</strong> a partir de ${fmtDate(doc.created_at)}` : ""}${doc.cid ? `, por motivo de diagnóstico CID: <strong>${doc.cid}</strong>` : ""}.
</div>
${doc.conteudo ? `<div class="obs">${doc.conteudo}</div>` : ""}
<p style="margin-top:24px;font-size:12px;text-align:right">Brasília-DF, ${hoje}</p>
<hr class="thick">
<div class="ass">
  <p style="margin:0;font-size:12px">${doc.medico_nome ? "Dr(a). " + doc.medico_nome : ""}</p>
  <span class="ass-line">CRN / Assinatura</span>
</div>
<p class="footer">Emitido em ${new Date().toLocaleDateString("pt-BR")} · ProNutro Clínica · Brasília-DF</p>
</body></html>`;
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

// ── sub-components ────────────────────────────────────────────────────────────

function DocCard({ doc, lead, onSend }: { doc: any; lead: any; onSend: (doc: any) => void }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-white/10" style={{ background: "rgba(255,255,255,0.04)" }}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-black ${doc.tipo === "receita" ? "bg-sky-500/20 text-sky-300" : doc.tipo === "atestado" ? "bg-amber-500/20 text-amber-300" : "bg-violet-500/20 text-violet-300"}`}>
        {doc.tipo === "receita" ? "Rx" : doc.tipo === "atestado" ? "At" : "En"}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white/80 text-xs font-bold">{docLabel(doc.tipo)}</p>
        <p className="text-white/30 text-[10px]">{fmtDate(doc.created_at)} · {doc.medico_nome || "—"}</p>
        {doc.dias_afastamento && <p className="text-amber-300 text-[10px] font-semibold mt-0.5">{doc.dias_afastamento} dias afastamento · CID: {doc.cid || "—"}</p>}
        <p className="text-white/40 text-[10px] mt-1 line-clamp-2 font-mono leading-relaxed">{doc.conteudo}</p>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button
          onClick={() => doc.tipo === "receita" ? printReceita(doc, lead) : printAtestado(doc, lead)}
          className="p-1.5 rounded-lg hover:bg-sky-500/20 text-white/30 hover:text-sky-400 transition" title="Imprimir / PDF">
          <Printer size={12} />
        </button>
        <button
          onClick={() => onSend(doc)}
          className={`p-1.5 rounded-lg transition ${doc.enviado_whatsapp ? "text-emerald-400 hover:bg-emerald-500/20" : "text-white/30 hover:text-emerald-400 hover:bg-emerald-500/20"}`}
          title={doc.enviado_whatsapp ? `Enviado para ${doc.phone_enviado}` : "Enviar por WhatsApp"}>
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

const EMPTY_PRONT = {
  data_consulta: new Date().toISOString().slice(0, 10),
  medico_id: "", queixa_principal: "", historia_clinica: "",
  exame_fisico: "", diagnostico: "", plano_tratamento: "", observacoes: "",
};

const EMPTY_DOC = {
  tipo: "receita" as "receita" | "atestado" | "encaminhamento",
  conteudo: "", cid: "", dias_afastamento: "",
};

export default function ProntuarioPage() {
  const [leads, setLeads]                   = useState<any[]>([]);
  const [medicos, setMedicos]               = useState<any[]>([]);
  const [searchLead, setSearchLead]         = useState("");
  const [selectedLead, setSelectedLead]     = useState<any>(null);
  const [prontuarios, setProntuarios]       = useState<any[]>([]);
  const [openPront, setOpenPront]           = useState<string | null>(null);
  const [prontDocs, setProntDocs]           = useState<Record<string, any[]>>({});
  const [loadingLeads, setLoadingLeads]     = useState(false);
  const [loadingPront, setLoadingPront]     = useState(false);

  // Prontuario form
  const [showProntForm, setShowProntForm]   = useState(false);
  const [editingPront, setEditingPront]     = useState<any>(null);
  const [prontForm, setProntForm]           = useState({ ...EMPTY_PRONT });
  const [savingPront, setSavingPront]       = useState(false);

  // Documento form
  const [showDocForm, setShowDocForm]       = useState<string | null>(null); // prontuario_id
  const [docForm, setDocForm]               = useState({ ...EMPTY_DOC });
  const [savingDoc, setSavingDoc]           = useState(false);

  // WhatsApp send modal
  const [sendingDoc, setSendingDoc]         = useState<any | null>(null);
  const [sendPhone, setSendPhone]           = useState("");
  const [sentWA, setSentWA]                 = useState(false);

  const loadLeads = useCallback(async (q = "") => {
    setLoadingLeads(true);
    const all = await fetchLeads(q);
    setLeads(all);
    setLoadingLeads(false);
  }, []);

  useEffect(() => {
    loadLeads();
    fetchMedicos().then(setMedicos);
  }, []);

  const loadProntuarios = useCallback(async (leadId: string) => {
    setLoadingPront(true);
    const data = await fetchProntuarios(leadId);
    setProntuarios(data);
    setLoadingPront(false);
  }, []);

  async function selectLead(lead: any) {
    setSelectedLead(lead);
    setOpenPront(null);
    setProntDocs({});
    setShowProntForm(false);
    setShowDocForm(null);
    setSendPhone(lead.phone || "");
    await loadProntuarios(lead.id);
  }

  async function togglePront(id: string) {
    if (openPront === id) { setOpenPront(null); return; }
    setOpenPront(id);
    if (!prontDocs[id]) {
      const docs = await fetchDocumentos(id);
      setProntDocs(prev => ({ ...prev, [id]: docs }));
    }
  }

  async function handleSavePront(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLead) return;
    setSavingPront(true);
    const med = medicos.find(m => m.id === prontForm.medico_id);
    const result = await upsertProntuario({
      ...(editingPront ? { id: editingPront.id } : {}),
      lead_id:           selectedLead.id,
      medico_id:         prontForm.medico_id || undefined,
      nome_paciente:     selectedLead.name,
      telefone_paciente: selectedLead.phone,
      data_consulta:     prontForm.data_consulta,
      queixa_principal:  prontForm.queixa_principal || undefined,
      historia_clinica:  prontForm.historia_clinica || undefined,
      exame_fisico:      prontForm.exame_fisico || undefined,
      diagnostico:       prontForm.diagnostico || undefined,
      plano_tratamento:  prontForm.plano_tratamento || undefined,
      observacoes:       prontForm.observacoes || undefined,
    });
    setSavingPront(false);
    if (result) {
      setShowProntForm(false);
      setEditingPront(null);
      setProntForm({ ...EMPTY_PRONT });
      await loadProntuarios(selectedLead.id);
      setOpenPront(result.id);
    }
  }

  function startEditPront(p: any) {
    setEditingPront(p);
    setProntForm({
      data_consulta:    p.data_consulta,
      medico_id:        p.medico_id || "",
      queixa_principal: p.queixa_principal || "",
      historia_clinica: p.historia_clinica || "",
      exame_fisico:     p.exame_fisico || "",
      diagnostico:      p.diagnostico || "",
      plano_tratamento: p.plano_tratamento || "",
      observacoes:      p.observacoes || "",
    });
    setShowProntForm(true);
    setShowDocForm(null);
  }

  async function handleSaveDoc(e: React.FormEvent) {
    e.preventDefault();
    if (!showDocForm) return;
    setSavingDoc(true);
    const pront = prontuarios.find(p => p.id === showDocForm);
    const med = medicos.find(m => m.id === prontForm.medico_id) || pront?.medico;
    const result = await insertDocumento({
      prontuario_id:   showDocForm,
      lead_id:         selectedLead?.id,
      medico_id:       pront?.medico_id,
      nome_paciente:   selectedLead?.name || pront?.nome_paciente,
      medico_nome:     med?.nome || pront?.medico?.nome || "",
      tipo:            docForm.tipo,
      conteudo:        docForm.conteudo,
      cid:             docForm.cid || undefined,
      dias_afastamento: docForm.tipo === "atestado" && docForm.dias_afastamento ? parseInt(docForm.dias_afastamento) : undefined,
    });
    setSavingDoc(false);
    if (result) {
      setShowDocForm(null);
      setDocForm({ ...EMPTY_DOC });
      // Reload docs for this prontuario
      const docs = await fetchDocumentos(showDocForm);
      setProntDocs(prev => ({ ...prev, [showDocForm]: docs }));
    }
  }

  async function handleSendWA() {
    if (!sendingDoc) return;
    const p = sendPhone.replace(/\D/g, "");
    if (p.length < 10) return alert("Informe o número com DDD e código do país.\nEx: 5561999998888");
    const tipo = docLabel(sendingDoc.tipo);
    const data = fmtDate(sendingDoc.created_at);
    let text = `*${tipo.toUpperCase()} - ProNutro Clínica*\n\n` +
      `Paciente: ${sendingDoc.nome_paciente || "—"}\n` +
      `Profissional: ${sendingDoc.medico_nome ? "Dr(a). " + sendingDoc.medico_nome : "—"}\n` +
      `Data: ${data}\n\n`;
    if (sendingDoc.tipo === "atestado" && sendingDoc.dias_afastamento) {
      text += `Afastamento: ${sendingDoc.dias_afastamento} dia(s)`;
      if (sendingDoc.cid) text += ` · CID: ${sendingDoc.cid}`;
      text += "\n\n";
    }
    text += `*Conteúdo:*\n${sendingDoc.conteudo}\n\n_ProNutro Clínica · Brasília-DF_`;

    // Abre WhatsApp Web com texto pronto — sempre funciona
    window.open(`https://wa.me/${p}?text=${encodeURIComponent(text)}`, "_blank");

    // Marca como enviado no banco
    await marcarDocumentoEnviado(sendingDoc.id, p);
    const docs = await fetchDocumentos(sendingDoc.prontuario_id);
    setProntDocs(prev => ({ ...prev, [sendingDoc.prontuario_id]: docs }));
    setSentWA(true);
    setTimeout(() => { setSendingDoc(null); setSentWA(false); }, 1500);
  }

  const filtered = leads.filter(l =>
    !searchLead ||
    (l.name || "").toLowerCase().includes(searchLead.toLowerCase()) ||
    (l.phone || "").includes(searchLead.replace(/\D/g, ""))
  );

  return (
    <div className="h-full flex overflow-hidden">

      {/* ── Coluna esquerda: pacientes ─────────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 flex flex-col border-r border-white/10" style={{ background: "rgba(10,20,55,0.6)" }}>
        <div className="px-3 py-3 border-b border-white/10">
          <p className="text-white font-black text-xs mb-2 flex items-center gap-1.5">
            <ClipboardList size={13} className="text-emerald-400" /> Pacientes
          </p>
          <div className="relative">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            <input
              value={searchLead}
              onChange={e => setSearchLead(e.target.value)}
              placeholder="Buscar paciente..."
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
          {loadingLeads ? (
            <p className="text-white/20 text-xs text-center py-8">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-white/20 text-xs text-center py-8">Nenhum paciente</p>
          ) : (
            filtered.map(l => (
              <button
                key={l.id}
                onClick={() => selectLead(l)}
                className={`w-full text-left px-3 py-2.5 border-b border-white/5 transition flex items-center gap-2 ${selectedLead?.id === l.id ? "bg-emerald-500/15 border-l-2 border-l-emerald-400" : "hover:bg-white/5"}`}
              >
                <div className="w-6 h-6 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0 text-emerald-300 font-black text-[10px]">
                  {(l.name || "?")[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-white/80 text-xs font-semibold truncate">{l.name || "—"}</p>
                  <p className="text-white/30 text-[10px]">{l.phone}</p>
                </div>
                <ChevronRight size={10} className="text-white/20 shrink-0 ml-auto" />
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Área principal ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {!selectedLead ? (
          <div className="flex-1 flex flex-col items-center justify-center text-white/20">
            <ClipboardList size={40} className="mb-3 opacity-30" />
            <p className="text-sm font-bold">Selecione um paciente</p>
            <p className="text-xs mt-1">para ver e criar prontuários</p>
          </div>
        ) : (
          <>
            {/* Header do paciente */}
            <div className="flex-shrink-0 px-5 py-3 border-b border-white/10 flex items-center gap-3" style={{ background: "rgba(10,20,55,0.4)" }}>
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-300 font-black text-sm">
                {(selectedLead.name || "?")[0].toUpperCase()}
              </div>
              <div>
                <p className="text-white font-black text-sm">{selectedLead.name}</p>
                <p className="text-white/30 text-[10px]">+{selectedLead.phone}</p>
              </div>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => { setShowDocForm(null); setEditingPront(null); setProntForm({ ...EMPTY_PRONT }); setShowProntForm(v => !v); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition shadow-lg shadow-emerald-500/30"
                >
                  <Plus size={13} /> Nova Consulta
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">

              {/* Form: novo prontuário */}
              {showProntForm && (
                <form onSubmit={handleSavePront} className="rounded-2xl border border-emerald-500/25 p-4 space-y-3" style={{ background: "rgba(16,100,50,0.06)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-emerald-300 font-black text-sm">{editingPront ? "Editar Prontuário" : "Nova Consulta"}</p>
                    <button type="button" onClick={() => { setShowProntForm(false); setEditingPront(null); }} className="p-1 rounded-lg hover:bg-white/10">
                      <X size={13} className="text-white/40" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-white/40 text-[10px] font-bold block mb-1">DATA DA CONSULTA</label>
                      <input type="date" required value={prontForm.data_consulta}
                        onChange={e => setProntForm(f => ({ ...f, data_consulta: e.target.value }))}
                        style={{ colorScheme: "dark" }}
                        className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                    </div>
                    <div>
                      <label className="text-white/40 text-[10px] font-bold block mb-1">MÉDICO / NUTRICIONISTA</label>
                      <select value={prontForm.medico_id} onChange={e => setProntForm(f => ({ ...f, medico_id: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40">
                        <option value="">Selecionar...</option>
                        {medicos.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                      </select>
                    </div>
                  </div>

                  {[
                    { key: "queixa_principal", label: "QUEIXA PRINCIPAL", rows: 2 },
                    { key: "historia_clinica", label: "HISTÓRIA CLÍNICA", rows: 3 },
                    { key: "exame_fisico",     label: "EXAME FÍSICO / ANTROPOMETRIA", rows: 3 },
                    { key: "diagnostico",      label: "DIAGNÓSTICO / AVALIAÇÃO NUTRICIONAL", rows: 2 },
                    { key: "plano_tratamento", label: "PLANO ALIMENTAR / TRATAMENTO", rows: 4 },
                    { key: "observacoes",      label: "OBSERVAÇÕES", rows: 2 },
                  ].map(({ key, label, rows }) => (
                    <div key={key}>
                      <label className="text-white/40 text-[10px] font-bold block mb-1">{label}</label>
                      <textarea
                        value={(prontForm as any)[key]}
                        onChange={e => setProntForm(f => ({ ...f, [key]: e.target.value }))}
                        rows={rows}
                        className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 resize-none"
                      />
                    </div>
                  ))}

                  <div className="flex justify-end gap-2 pt-1">
                    <button type="button" onClick={() => { setShowProntForm(false); setEditingPront(null); }}
                      className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 text-xs font-bold transition">
                      Cancelar
                    </button>
                    <button type="submit" disabled={savingPront}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition disabled:opacity-60">
                      {savingPront ? "Salvando..." : editingPront ? "Salvar alterações" : "Registrar consulta"}
                    </button>
                  </div>
                </form>
              )}

              {/* Lista de prontuários */}
              {loadingPront ? (
                <p className="text-white/20 text-xs text-center py-8">Carregando prontuários...</p>
              ) : prontuarios.length === 0 && !showProntForm ? (
                <div className="text-center py-12">
                  <ClipboardList size={32} className="mx-auto text-white/15 mb-3" />
                  <p className="text-white/30 text-sm font-bold">Sem prontuários</p>
                  <p className="text-white/20 text-xs mt-1">Clique em "Nova Consulta" para registrar</p>
                </div>
              ) : (
                prontuarios.map(p => {
                  const isOpen = openPront === p.id;
                  const docs = prontDocs[p.id] || [];
                  return (
                    <div key={p.id} className="rounded-2xl border border-white/10 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
                      {/* Header do prontuário */}
                      <button
                        onClick={() => togglePront(p.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition"
                      >
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
                          <ClipboardList size={14} className="text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white/80 text-xs font-bold">{fmtDate(p.data_consulta)}</p>
                          <p className="text-white/35 text-[10px]">
                            {p.medico?.nome || "Sem profissional"}
                            {p.queixa_principal ? ` · ${p.queixa_principal.slice(0, 50)}${p.queixa_principal.length > 50 ? "…" : ""}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {docs.length > 0 && (
                            <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">
                              {docs.length} doc{docs.length > 1 ? "s" : ""}
                            </span>
                          )}
                          {isOpen ? <ChevronUp size={13} className="text-white/30" /> : <ChevronDown size={13} className="text-white/30" />}
                        </div>
                      </button>

                      {/* Conteúdo expandido */}
                      {isOpen && (
                        <div className="px-4 pb-4 space-y-4 border-t border-white/5">
                          {/* Campos do prontuário */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                            {[
                              { label: "Queixa Principal",  val: p.queixa_principal },
                              { label: "História Clínica",  val: p.historia_clinica },
                              { label: "Exame Físico",      val: p.exame_fisico },
                              { label: "Diagnóstico",       val: p.diagnostico },
                              { label: "Plano de Tratamento", val: p.plano_tratamento },
                              { label: "Observações",       val: p.observacoes },
                            ].filter(f => f.val).map(({ label, val }) => (
                              <div key={label} className="rounded-xl border border-white/5 p-3" style={{ background: "rgba(255,255,255,0.03)" }}>
                                <p className="text-white/30 text-[10px] font-bold mb-1 uppercase tracking-wide">{label}</p>
                                <p className="text-white/70 text-xs leading-relaxed whitespace-pre-wrap">{val}</p>
                              </div>
                            ))}
                          </div>

                          {/* Documentos do prontuário */}
                          {docs.length > 0 && (
                            <div>
                              <p className="text-white/30 text-[10px] font-bold mb-2 uppercase tracking-wide">Documentos emitidos</p>
                              <div className="space-y-2">
                                {docs.map(doc => (
                                  <DocCard key={doc.id} doc={doc} lead={selectedLead} onSend={d => { setSendingDoc(d); setSendPhone(selectedLead.phone || ""); setSentWA(false); }} />
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Ações */}
                          <div className="flex gap-2 flex-wrap pt-1">
                            <button
                              onClick={() => { setShowDocForm(showDocForm === p.id ? null : p.id); setDocForm({ ...EMPTY_DOC, tipo: "receita" }); setShowProntForm(false); }}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600/80 hover:bg-sky-600 text-white text-xs font-black transition shadow-lg shadow-sky-500/20"
                            >
                              <FileText size={12} /> Receita Médica
                            </button>
                            <button
                              onClick={() => { setShowDocForm(showDocForm === p.id ? null : p.id); setDocForm({ ...EMPTY_DOC, tipo: "atestado" }); setShowProntForm(false); }}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-600/80 hover:bg-amber-600 text-white text-xs font-black transition shadow-lg shadow-amber-500/20"
                            >
                              <FileText size={12} /> Atestado
                            </button>
                            <button
                              onClick={() => startEditPront(p)}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 text-xs font-bold transition"
                            >
                              Editar
                            </button>
                          </div>

                          {/* Form: novo documento */}
                          {showDocForm === p.id && (
                            <form onSubmit={handleSaveDoc} className="rounded-xl border border-sky-500/20 p-4 space-y-3" style={{ background: "rgba(14,100,180,0.06)" }}>
                              <div className="flex items-center justify-between">
                                <p className="text-sky-300 font-black text-xs">{docForm.tipo === "receita" ? "Nova Receita Médica" : docForm.tipo === "atestado" ? "Novo Atestado" : "Novo Encaminhamento"}</p>
                                <button type="button" onClick={() => setShowDocForm(null)}>
                                  <X size={12} className="text-white/30 hover:text-white/60" />
                                </button>
                              </div>

                              <div className="flex gap-2">
                                {(["receita","atestado","encaminhamento"] as const).map(t => (
                                  <button type="button" key={t} onClick={() => setDocForm(f => ({ ...f, tipo: t }))}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${docForm.tipo === t ? "bg-sky-600 border-sky-500 text-white" : "bg-white/5 border-white/10 text-white/40 hover:text-white"}`}>
                                    {docLabel(t)}
                                  </button>
                                ))}
                              </div>

                              {docForm.tipo === "atestado" && (
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="text-white/40 text-[10px] font-bold block mb-1">DIAS DE AFASTAMENTO</label>
                                    <input type="number" min="1" value={docForm.dias_afastamento}
                                      onChange={e => setDocForm(f => ({ ...f, dias_afastamento: e.target.value }))}
                                      placeholder="Ex: 2"
                                      className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-sky-500/40" />
                                  </div>
                                  <div>
                                    <label className="text-white/40 text-[10px] font-bold block mb-1">CID (opcional)</label>
                                    <input value={docForm.cid} onChange={e => setDocForm(f => ({ ...f, cid: e.target.value }))}
                                      placeholder="Ex: Z71.3"
                                      className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-sky-500/40" />
                                  </div>
                                </div>
                              )}

                              <div>
                                <label className="text-white/40 text-[10px] font-bold block mb-1">
                                  {docForm.tipo === "receita" ? "PRESCRIÇÃO / ORIENTAÇÕES" : docForm.tipo === "atestado" ? "OBSERVAÇÕES / JUSTIFICATIVA" : "ENCAMINHAMENTO PARA"}
                                </label>
                                <textarea
                                  required
                                  value={docForm.conteudo}
                                  onChange={e => setDocForm(f => ({ ...f, conteudo: e.target.value }))}
                                  rows={5}
                                  placeholder={docForm.tipo === "receita"
                                    ? "Ex:\n1. Proteína whey 30g pós-treino\n2. Creatina 5g/dia\n3. Vitamina D 2000UI/dia"
                                    : docForm.tipo === "atestado"
                                    ? "Descreva o motivo do afastamento..."
                                    : "Encaminhar para especialidade / exames..."}
                                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-sky-500/40 resize-none font-mono"
                                />
                              </div>

                              <div className="flex justify-end gap-2">
                                <button type="button" onClick={() => setShowDocForm(null)}
                                  className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/40 text-xs font-bold transition">
                                  Cancelar
                                </button>
                                <button type="submit" disabled={savingDoc}
                                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-black transition disabled:opacity-60">
                                  {savingDoc ? "Salvando..." : "Emitir documento"}
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Modal: Enviar doc por WhatsApp ────────────────────────────────────── */}
      {sendingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 shadow-2xl" style={{ background: "rgba(10,20,60,0.98)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <p className="text-white font-black text-sm flex items-center gap-2">
                <Send size={14} className="text-emerald-400" /> Enviar por WhatsApp
              </p>
              <button onClick={() => setSendingDoc(null)} className="p-1.5 rounded-lg hover:bg-white/10">
                <X size={14} className="text-white/40" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl border border-white/10 p-3" style={{ background: "rgba(255,255,255,0.04)" }}>
                <p className="text-white/50 text-xs">{docLabel(sendingDoc.tipo)} · {fmtDate(sendingDoc.created_at)}</p>
                <p className="text-white/80 text-xs font-semibold mt-0.5">{sendingDoc.nome_paciente || "—"}</p>
              </div>
              <div>
                <label className="text-white/40 text-[10px] font-bold block mb-1.5">NÚMERO WHATSAPP</label>
                <input
                  value={sendPhone} onChange={e => setSendPhone(e.target.value)}
                  placeholder="5561999998888"
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-mono placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
              {sentWA ? (
                <div className="flex items-center justify-center gap-2 py-3 text-emerald-400 font-black text-sm">
                  <Check size={18} /> Enviado com sucesso!
                </div>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setSendingDoc(null)}
                    className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 text-xs font-bold transition">
                    Cancelar
                  </button>
                  <button onClick={handleSendWA}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition">
                    <Send size={12} /> Abrir WhatsApp
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
