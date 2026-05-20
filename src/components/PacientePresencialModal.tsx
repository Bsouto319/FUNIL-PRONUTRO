import { useState, useEffect } from "react";
import { X, Check, UserCircle } from "lucide-react";
import { createLeadPresencial, createAgendamento, insertFinanceiro, fetchMedicos, fetchBancos } from "../lib/api";

interface Props {
  currentUser: any;
  onClose: () => void;
  onDone:  (lead: any) => void;
}

const inp  = "w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40";
const lbl  = "text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1";
const card = "rounded-xl border border-white/10 p-4 space-y-3";
const cardBg = { background: "rgba(255,255,255,0.03)" };

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
const ORIGENS = ["WhatsApp","Google","Instagram","Facebook","Indicação","Doctoralia","TikTok","Outro"];
const ORIGEM_EMOJI: Record<string,string> = { WhatsApp:"📱", Google:"🔍", Instagram:"📸", Facebook:"👥", Indicação:"🤝", Doctoralia:"🏥", TikTok:"🎵", Outro:"❓" };
const PAG_STATUS = [
  { key:"pago",       label:"✅ Pago",       cls:"bg-emerald-600/80 border-emerald-500" },
  { key:"pendente",   label:"⏳ Pendente",   cls:"bg-amber-600/80 border-amber-500" },
  { key:"aguardando", label:"🕐 Aguardando", cls:"bg-sky-600/80 border-sky-500" },
  { key:"isento",     label:"🎁 Isento",     cls:"bg-indigo-600/80 border-indigo-500" },
];
const PAG_METODOS = ["PIX","Cartão","Dinheiro","Transferência","Convênio"];

export default function PacientePresencialModal({ onClose, onDone }: Props) {
  const [medicos, setMedicos] = useState<any[]>([]);
  const [bancos,  setBancos]  = useState<any[]>([]);
  const [saving,  setSaving]  = useState(false);
  const [erro,    setErro]    = useState("");

  // ── Identificação
  const [nome,    setNome]    = useState("");
  const [fone,    setFone]    = useState("");
  const [cpf,     setCpf]     = useState("");
  const [nasc,    setNasc]    = useState("");
  const [email,   setEmail]   = useState("");
  const [convenio,setConvenio]= useState("");
  const [sexo,    setSexo]    = useState("");
  const [origem,  setOrigem]  = useState("");

  // ── Endereço
  const [cep,      setCep]      = useState("");
  const [endereco, setEndereco] = useState("");
  const [numero,   setNumero]   = useState("");
  const [compl,    setCompl]    = useState("");
  const [bairro,   setBairro]   = useState("");
  const [cidade,   setCidade]   = useState("");
  const [estado,   setEstado]   = useState("");

  // ── Consulta
  const [medicoId,     setMedicoId]     = useState("");
  const [dataConsulta, setDataConsulta] = useState("");
  const [hora,         setHora]         = useState("");
  const [duracao,      setDuracao]      = useState("30");
  const [semConsulta,  setSemConsulta]  = useState(false);

  // ── Pagamento
  const [pagStatus,  setPagStatus]  = useState("pendente");
  const [pagValor,   setPagValor]   = useState("");
  const [pagData,    setPagData]    = useState("");
  const [pagMetodo,  setPagMetodo]  = useState("");
  const [pagObs,     setPagObs]     = useState("");
  const [bancoId,    setBancoId]    = useState("");

  useEffect(() => {
    Promise.all([fetchMedicos(), fetchBancos()]).then(([m, b]) => {
      setMedicos(m); setBancos(b);
      if (m[0]) { setMedicoId(m[0].id); if (m[0].valor) setPagValor(String(m[0].valor)); }
      if (b[0]) setBancoId(b[0].id);
    });
  }, []);

  async function lookupCep(raw: string) {
    const digits = raw.replace(/\D/g,"");
    if (digits.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const d = await r.json();
      if (!d.erro) { setEndereco(d.logradouro||""); setBairro(d.bairro||""); setCidade(d.localidade||""); setEstado(d.uf||""); }
    } catch {}
  }

  function fmtCpf(v: string) {
    const d = v.replace(/\D/g,"").slice(0,11);
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, (_,a,b,c,dd)=>dd?`${a}.${b}.${c}-${dd}`:c?`${a}.${b}.${c}`:b?`${a}.${b}`:a);
  }
  function fmtCep(v: string) {
    const d = v.replace(/\D/g,"").slice(0,8);
    return d.length > 5 ? `${d.slice(0,5)}-${d.slice(5)}` : d;
  }

  const medicoSel = medicos.find(m => m.id === medicoId);

  async function handleSave() {
    if (!nome.trim() || fone.replace(/\D/g,"").length < 10) {
      setErro("Nome e telefone são obrigatórios."); return;
    }
    if (!semConsulta && (!medicoId || !dataConsulta || !hora)) {
      setErro("Preencha médico, data e horário da consulta."); return;
    }
    setSaving(true); setErro("");

    const lead = await createLeadPresencial({
      name: nome, phone: fone, cpf: cpf.replace(/\D/g,""),
      email, convenio, origem,
      data_nascimento: nasc || undefined,
      sexo: sexo || undefined,
      cep: cep.replace(/\D/g,"") || undefined,
      endereco: endereco || undefined, numero: numero || undefined,
      complemento: compl || undefined, bairro: bairro || undefined,
      cidade: cidade || undefined, estado: estado || undefined,
      pagamento_status: pagStatus,
      pagamento_valor:  pagValor ? parseFloat(pagValor.replace(",",".")) : undefined,
      pagamento_metodo: pagMetodo || undefined,
      pagamento_data:   pagData || undefined,
      pagamento_obs:    pagObs || undefined,
    });
    if (!lead) { setErro("Erro ao criar paciente. Verifique o número."); setSaving(false); return; }

    const promises: Promise<any>[] = [];

    if (!semConsulta) {
      promises.push(createAgendamento({
        lead_id: lead.id, medico_id: medicoId,
        data_hora: `${dataConsulta}T${hora}:00`,
        duracao_min: parseInt(duracao),
      }));
    }

    if (pagStatus === "pago" && pagValor) {
      promises.push(insertFinanceiro({
        lead_id: lead.id, medico_id: medicoId || undefined,
        nome_paciente: nome, medico_nome: medicoSel?.nome || "",
        valor: parseFloat(pagValor.replace(",",".")),
        forma_pagamento: pagMetodo || "PIX",
        banco_id: bancoId || undefined,
        data_pagamento: pagData ? new Date(pagData).toISOString() : new Date().toISOString(),
        observacoes: pagObs || undefined,
      }));
    }

    await Promise.all(promises);
    setSaving(false);
    onDone(lead);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background:"rgba(0,0,10,0.82)", backdropFilter:"blur(8px)" }}>
      <div className="w-full max-w-xl rounded-2xl border border-white/10 flex flex-col"
        style={{ background:"rgba(10,18,48,0.98)", maxHeight:"94vh" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 shrink-0">
          <p className="text-white font-black text-base">Novo Paciente</p>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 transition">
            <X size={16}/>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4
          [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">

          {/* ── Identificação ── */}
          <div className={card} style={cardBg}>
            <p className="text-white/60 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5">
              <UserCircle size={11}/> Identificação
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Nome *</label>
                <input value={nome} onChange={e=>setNome(e.target.value)} placeholder="Nome completo" className={inp}/>
              </div>
              <div>
                <label className={lbl}>WhatsApp *</label>
                <input value={fone} onChange={e=>setFone(e.target.value)} placeholder="61 9 9999-9999" type="tel" className={inp}/>
              </div>
              <div>
                <label className={lbl}>CPF</label>
                <input value={cpf} onChange={e=>setCpf(fmtCpf(e.target.value))} placeholder="000.000.000-00" maxLength={14} className={inp+" font-mono"}/>
              </div>
              <div>
                <label className={lbl}>Data de Nascimento</label>
                <input type="date" value={nasc} onChange={e=>setNasc(e.target.value)} className={inp}/>
              </div>
              <div>
                <label className={lbl}>E-mail</label>
                <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="paciente@email.com" className={inp}/>
              </div>
              <div>
                <label className={lbl}>Convênio</label>
                <input value={convenio} onChange={e=>setConvenio(e.target.value)} placeholder="Unimed, Particular..." className={inp}/>
              </div>
            </div>

            {/* Sexo */}
            <div>
              <label className={lbl}>Sexo</label>
              <div className="flex gap-2">
                {[["M","Masculino"],["F","Feminino"],["O","Outro"]].map(([v,l])=>(
                  <button key={v} type="button" onClick={()=>setSexo(sexo===v?"":v)}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition ${sexo===v?"bg-emerald-600/80 text-white border-emerald-500":"bg-white/5 text-white/50 border-white/10 hover:bg-white/10"}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Por onde veio */}
            <div>
              <label className={lbl}>Por onde veio</label>
              <div className="grid grid-cols-4 gap-1.5">
                {ORIGENS.map(op=>(
                  <button key={op} type="button" onClick={()=>setOrigem(origem===op?"":op)}
                    className={`py-1.5 px-2 rounded-lg text-[10px] font-bold border transition ${origem===op?"bg-emerald-600/80 text-white border-emerald-500":"bg-white/5 text-white/50 border-white/10 hover:bg-white/10"}`}>
                    {ORIGEM_EMOJI[op]} {op}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Endereço ── */}
          <div className={card} style={cardBg}>
            <p className="text-white/60 text-[10px] font-black uppercase tracking-wider">📍 Endereço</p>
            <div className="grid grid-cols-6 gap-2">
              <div className="col-span-2">
                <label className={lbl}>CEP</label>
                <input value={cep} onChange={e=>{const f=fmtCep(e.target.value);setCep(f);lookupCep(f);}}
                  placeholder="00000-000" maxLength={9} className={inp+" font-mono"}/>
              </div>
              <div className="col-span-4">
                <label className={lbl}>Logradouro</label>
                <input value={endereco} onChange={e=>setEndereco(e.target.value)} placeholder="Rua, Av..." className={inp}/>
              </div>
              <div className="col-span-1">
                <label className={lbl}>Nº</label>
                <input value={numero} onChange={e=>setNumero(e.target.value)} placeholder="123" className={inp}/>
              </div>
              <div className="col-span-2">
                <label className={lbl}>Complemento</label>
                <input value={compl} onChange={e=>setCompl(e.target.value)} placeholder="Apto..." className={inp}/>
              </div>
              <div className="col-span-3">
                <label className={lbl}>Bairro</label>
                <input value={bairro} onChange={e=>setBairro(e.target.value)} placeholder="Asa Norte..." className={inp}/>
              </div>
              <div className="col-span-4">
                <label className={lbl}>Cidade</label>
                <input value={cidade} onChange={e=>setCidade(e.target.value)} placeholder="Brasília" className={inp}/>
              </div>
              <div className="col-span-2">
                <label className={lbl}>Estado</label>
                <select value={estado} onChange={e=>setEstado(e.target.value)} className={inp}>
                  <option value="">UF</option>
                  {UFS.map(uf=><option key={uf} value={uf}>{uf}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* ── Consulta ── */}
          <div className={card} style={cardBg}>
            <div className="flex items-center justify-between">
              <p className="text-white/60 text-[10px] font-black uppercase tracking-wider">🗓 Consulta</p>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={semConsulta} onChange={e=>setSemConsulta(e.target.checked)} className="w-3.5 h-3.5 rounded accent-emerald-500"/>
                <span className="text-white/30 text-[10px]">Sem consulta agora</span>
              </label>
            </div>
            {!semConsulta && (
              <div className="space-y-3">
                <div>
                  <label className={lbl}>Médico / Nutricionista *</label>
                  <select value={medicoId} onChange={e=>{const id=e.target.value;setMedicoId(id);const med=medicos.find(m=>m.id===id);if(med?.valor)setPagValor(String(med.valor));}} className={inp}>
                    {medicos.map(m=><option key={m.id} value={m.id}>{m.nome} — {m.especialidade}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className={lbl}>Data *</label>
                    <input type="date" value={dataConsulta} onChange={e=>setDataConsulta(e.target.value)} className={inp}/>
                  </div>
                  <div>
                    <label className={lbl}>Horário *</label>
                    <input type="time" value={hora} onChange={e=>setHora(e.target.value)} className={inp}/>
                  </div>
                  <div>
                    <label className={lbl}>Duração</label>
                    <select value={duracao} onChange={e=>setDuracao(e.target.value)} className={inp}>
                      {["15","30","45","60","90","120"].map(v=><option key={v} value={v}>{v}min</option>)}
                    </select>
                  </div>
                </div>
                {medicoSel?.aceita_convenio && (
                  <p className="text-white/30 text-[10px]">Aceita convênio</p>
                )}
              </div>
            )}
          </div>

          {/* ── Pagamento ── */}
          <div className={card} style={cardBg}>
            <p className="text-white/60 text-[10px] font-black uppercase tracking-wider">💳 Pagamento</p>

            {/* Status */}
            <div className="grid grid-cols-4 gap-1.5">
              {PAG_STATUS.map(s=>(
                <button key={s.key} type="button" onClick={()=>setPagStatus(s.key)}
                  className={`py-2 rounded-lg text-[10px] font-bold border transition ${pagStatus===s.key?`${s.cls} text-white`:"bg-white/5 text-white/50 border-white/10 hover:bg-white/10"}`}>
                  {s.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Valor (R$)</label>
                <input type="number" min="0" step="0.01" value={pagValor} onChange={e=>setPagValor(e.target.value)} placeholder="0,00" className={inp}/>
              </div>
              <div>
                <label className={lbl}>Data do pagamento</label>
                <input type="date" value={pagData} onChange={e=>setPagData(e.target.value)} className={inp}/>
              </div>
            </div>

            {/* Forma */}
            <div>
              <label className={lbl}>Forma de pagamento</label>
              <div className="grid grid-cols-5 gap-1.5">
                {PAG_METODOS.map(m=>(
                  <button key={m} type="button" onClick={()=>setPagMetodo(pagMetodo===m?"":m)}
                    className={`py-2 rounded-lg text-[10px] font-bold border transition ${pagMetodo===m?"bg-sky-600/80 text-white border-sky-500":"bg-white/5 text-white/50 border-white/10 hover:bg-white/10"}`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {bancos.length>0 && (
              <div>
                <label className={lbl}>Banco / Conta</label>
                <select value={bancoId} onChange={e=>setBancoId(e.target.value)} className={inp}>
                  <option value="">— Não informar —</option>
                  {bancos.map(b=><option key={b.id} value={b.id}>{b.nome} ({b.tipo})</option>)}
                </select>
              </div>
            )}

            <div>
              <label className={lbl}>Observações do pagamento</label>
              <input value={pagObs} onChange={e=>setPagObs(e.target.value)}
                placeholder="Ex: parcela 2/3, recibo enviado..." className={inp}/>
            </div>
          </div>

          {erro && <p className="text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">{erro}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-white/8 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 hover:text-white text-sm font-bold transition">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-black transition disabled:opacity-40 shadow-lg shadow-sky-500/20">
            {saving ? "Salvando..." : <><Check size={14}/> Salvar Paciente</>}
          </button>
        </div>
      </div>
    </div>
  );
}
