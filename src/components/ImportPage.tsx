import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Upload, CheckCircle, XCircle, AlertCircle, Loader, Download } from "lucide-react";
import { importAgendamentosExcel, vincularFinanceiroLeads, type ImportRow, type ImportResult } from "../lib/api";
import { supabase } from "../lib/supabase";

type Step    = "upload" | "preview" | "importing" | "done";
type Section = "agendamentos" | "pacientes";

// ── helpers ────────────────────────────────────────────────────────────────
function excelDateToStr(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (v instanceof Date) {
    return `${String(v.getDate()).padStart(2,"0")}/${String(v.getMonth()+1).padStart(2,"0")}/${v.getFullYear()}`;
  }
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${String(d.d).padStart(2,"0")}/${String(d.m).padStart(2,"0")}/${d.y}`;
  }
  return String(v);
}

function excelTimeToStr(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (v instanceof Date) return `${String(v.getHours()).padStart(2,"0")}:${String(v.getMinutes()).padStart(2,"0")}`;
  if (typeof v === "number") {
    const min = Math.round(v * 24 * 60);
    return `${String(Math.floor(min/60)).padStart(2,"0")}:${String(min%60).padStart(2,"0")}`;
  }
  return String(v);
}

function str(v: any) { return String(v ?? "").trim(); }

// ── parse agendamentos ─────────────────────────────────────────────────────
function parseAgendRows(ws: XLSX.WorkSheet): ImportRow[] {
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });
  return raw.slice(1).map(r => ({
    nome:      str(r[0]),
    telefone:  str(r[1]),
    medico:    str(r[2]),
    data:      excelDateToStr(r[3]),
    hora:      excelTimeToStr(r[4]),
    tipo:      str(r[5]),
    valor:     r[6] ? parseFloat(str(r[6]).replace(",",".")) || null : null,
    pagamento: str(r[7]),
    parcelas:  parseInt(str(r[8])) || 1,
    obs:       str(r[9]),
  })).filter(r => r.nome || r.telefone || r.medico);
}

// ── parse pacientes ────────────────────────────────────────────────────────
interface PatRow {
  cpf: string; nome: string; data_nascimento: string; telefone: string;
  email: string; cep: string; endereco: string; numero: string;
  bairro: string; cidade: string; estado: string; convenio: string;
  medico: string; observacoes: string;
}
interface PatResult { cpf: string; nome: string; status: "criado"|"atualizado"|"erro"; msg?: string; }

function parsePatRows(ws: XLSX.WorkSheet): PatRow[] {
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });
  return raw.slice(1).map(r => ({
    cpf:            str(r[0]),
    nome:           str(r[1]),
    data_nascimento:excelDateToStr(r[2]),
    telefone:       str(r[3]),
    email:          str(r[4]),
    cep:            str(r[5]),
    endereco:       str(r[6]),
    numero:         str(r[7]),
    bairro:         str(r[8]),
    cidade:         str(r[9]),
    estado:         str(r[10]),
    convenio:       str(r[11]),
    medico:         str(r[12]),
    observacoes:    str(r[13]),
  })).filter(r => r.cpf.replace(/\D/g,"").length >= 11);
}

// parse dd/mm/yyyy → yyyy-mm-dd for DB
function brDateToIso(s: string): string | null {
  if (!s) return null;
  const [d, m, y] = s.split("/");
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
}

// ── patient upsert ─────────────────────────────────────────────────────────
async function upsertPacientes(rows: PatRow[]): Promise<PatResult[]> {
  const results: PatResult[] = [];
  for (const r of rows) {
    const cpf = r.cpf.replace(/\D/g, "");
    const phone = r.telefone.replace(/\D/g, "");
    try {
      const { data: existing } = await supabase
        .from("pn_leads").select("id").eq("cpf", cpf).maybeSingle();

      const payload: Record<string, any> = {
        name:            r.nome || null,
        cpf:             cpf || null,
        data_nascimento: brDateToIso(r.data_nascimento),
        email:           r.email || null,
        cep:             r.cep.replace(/\D/g,"") || null,
        endereco:        r.endereco || null,
        numero:          r.numero || null,
        bairro:          r.bairro || null,
        cidade:          r.cidade || null,
        estado:          r.estado || null,
        convenio:        r.convenio || null,
        updated_at:      new Date().toISOString(),
      };
      if (phone) payload.phone = phone;
      if (r.observacoes) payload.notes = r.observacoes;

      if (existing?.id) {
        const { error } = await supabase.from("pn_leads").update(payload).eq("id", existing.id);
        results.push({ cpf, nome: r.nome, status: error ? "erro" : "atualizado", msg: error?.message });
      } else {
        const { error } = await supabase.from("pn_leads").insert({
          ...payload,
          phone:      phone || `sem_tel_${Date.now()}`,
          stage:      "em_atendimento",
          ai_mode:    false,
          created_at: new Date().toISOString(),
        });
        results.push({ cpf, nome: r.nome, status: error ? "erro" : "criado", msg: error?.message });
      }
    } catch (e: any) {
      results.push({ cpf, nome: r.nome, status: "erro", msg: e?.message });
    }
  }
  return results;
}

// ── component ──────────────────────────────────────────────────────────────
const PAT_RESULT_STYLE: Record<PatResult["status"], { bg: string; text: string; label: string }> = {
  criado:      { bg: "bg-sky-500/15",     text: "text-sky-300",     label: "🆕 Criado"     },
  atualizado:  { bg: "bg-emerald-500/15", text: "text-emerald-300", label: "✅ Atualizado" },
  erro:        { bg: "bg-rose-500/15",    text: "text-rose-300",    label: "❌ Erro"        },
};

const AG_RESULT_STYLE: Record<ImportResult["status"], { bg: string; text: string; label: string }> = {
  vinculado: { bg: "bg-emerald-500/15", text: "text-emerald-300", label: "✅ Vinculado" },
  novo_lead: { bg: "bg-sky-500/15",     text: "text-sky-300",     label: "🆕 Novo lead" },
  sem_lead:  { bg: "bg-amber-500/15",   text: "text-amber-300",   label: "⚠ Sem lead"  },
  erro:      { bg: "bg-rose-500/15",    text: "text-rose-300",    label: "❌ Erro"       },
};

export default function ImportPage() {
  const [section, setSection] = useState<Section>("pacientes");

  // ── agendamentos state ──
  const agFileRef              = useRef<HTMLInputElement>(null);
  const [agStep, setAgStep]    = useState<Step>("upload");
  const [agRows, setAgRows]    = useState<ImportRow[]>([]);
  const [agResults, setAgResults] = useState<ImportResult[]>([]);
  const [agDragOver, setAgDragOver] = useState(false);
  const [linkMsg, setLinkMsg]  = useState("");
  const [linking, setLinking]  = useState(false);

  // ── pacientes state ──
  const patFileRef               = useRef<HTMLInputElement>(null);
  const [patStep, setPatStep]    = useState<Step>("upload");
  const [patRows, setPatRows]    = useState<PatRow[]>([]);
  const [patResults, setPatResults] = useState<PatResult[]>([]);
  const [patDragOver, setPatDragOver] = useState(false);

  // ── agendamentos handlers ──
  function handleAgFile(file: File) {
    const reader = new FileReader();
    reader.onload = e => {
      const wb = XLSX.read(e.target?.result, { type: "array", cellDates: true });
      setAgRows(parseAgendRows(wb.Sheets[wb.SheetNames[0]]));
      setAgStep("preview");
    };
    reader.readAsArrayBuffer(file);
  }
  async function runAgImport() {
    setAgStep("importing");
    setAgResults(await importAgendamentosExcel(agRows));
    setAgStep("done");
  }
  async function handleVincular() {
    setLinking(true); setLinkMsg("");
    const n = await vincularFinanceiroLeads();
    setLinkMsg(`✅ ${n} registro${n!==1?"s":""} vinculado${n!==1?"s":""}`);
    setLinking(false);
  }
  function downloadAgTemplate() {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Nome","Telefone","Médico","Data","Hora","Tipo","Valor","Pagamento","Parcelas","Observações"],
      ["João Silva","61999998888","Augusto","15/01/2026","09:00","Consulta","980","Pix","1",""],
      ["Maria Costa","61988887777","Vanessa","20/01/2026","14:00","Retorno","","","","Plano Unimed"],
    ]);
    ws["!cols"] = Array(10).fill({ wch: 18 });
    XLSX.utils.book_append_sheet(wb, ws, "Agendamentos");
    XLSX.writeFile(wb, "modelo_agendamentos_pronutro.xlsx");
  }

  // ── pacientes handlers ──
  function handlePatFile(file: File) {
    const reader = new FileReader();
    reader.onload = e => {
      const wb = XLSX.read(e.target?.result, { type: "array", cellDates: true });
      setPatRows(parsePatRows(wb.Sheets[wb.SheetNames[0]]));
      setPatStep("preview");
    };
    reader.readAsArrayBuffer(file);
  }
  async function runPatImport() {
    setPatStep("importing");
    setPatResults(await upsertPacientes(patRows));
    setPatStep("done");
  }
  function downloadPatTemplate() {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["CPF","Nome Completo","Data Nascimento","Telefone","E-mail","CEP","Endereço","Número","Bairro","Cidade","Estado","Convênio","Médico Responsável","Observações"],
      ["000.000.000-00","Maria da Silva","01/01/1985","61999998888","maria@email.com","70000-000","Rua das Flores","123","Asa Norte","Brasília","DF","Unimed","Dra. Ana",""],
    ]);
    ws["!cols"] = Array(14).fill({ wch: 18 });
    XLSX.utils.book_append_sheet(wb, ws, "Pacientes");
    XLSX.writeFile(wb, "modelo_pacientes_pronutro.xlsx");
  }

  const agSummary = agResults.reduce((a, r) => { a[r.status]=(a[r.status]||0)+1; return a; }, {} as Record<string,number>);
  const patSummary = patResults.reduce((a, r) => { a[r.status]=(a[r.status]||0)+1; return a; }, {} as Record<string,number>);

  return (
    <div className="space-y-5 p-1">

      {/* Section tabs */}
      <div className="flex gap-2">
        {([["pacientes","👥 Importar Pacientes"],["agendamentos","📅 Importar Agendamentos"]] as [Section,string][]).map(([s,l]) => (
          <button key={s} onClick={() => setSection(s)}
            className={`px-4 py-2 rounded-xl text-xs font-black border transition ${section===s ? "bg-white/15 text-white border-white/20" : "text-white/40 border-white/8 hover:text-white/60 hover:bg-white/5"}`}>
            {l}
          </button>
        ))}
      </div>

      {/* ══ PACIENTES ══ */}
      {section === "pacientes" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
            <p className="text-sky-300 font-bold text-sm mb-1">Importação por CPF — upsert automático</p>
            <p className="text-white/40 text-xs">Se o CPF já existir no sistema, os dados são <strong className="text-white/60">atualizados</strong>. Se não existir, o paciente é <strong className="text-white/60">criado</strong>. O CPF é a chave única — nunca gera duplicatas.</p>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-white/60 text-xs font-bold">Planilha: CPF · Nome · Nascimento · Telefone · E-mail · Endereço · Convênio · Médico · Obs</p>
            <button onClick={downloadPatTemplate}
              className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition px-2 py-1 rounded-lg hover:bg-white/5">
              <Download size={12} /> Baixar modelo
            </button>
          </div>

          {patStep === "upload" && (
            <div
              onDragOver={e => { e.preventDefault(); setPatDragOver(true); }}
              onDragLeave={() => setPatDragOver(false)}
              onDrop={e => { e.preventDefault(); setPatDragOver(false); const f=e.dataTransfer.files[0]; if(f) handlePatFile(f); }}
              onClick={() => patFileRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${patDragOver ? "border-sky-400 bg-sky-500/10" : "border-white/10 hover:border-white/25 hover:bg-white/[0.03]"}`}>
              <Upload size={28} className="mx-auto mb-3 text-white/25" />
              <p className="text-white/60 font-bold text-sm">Arraste o Excel aqui ou clique para selecionar</p>
              <p className="text-white/25 text-xs mt-1">.xlsx · .xls · .csv</p>
              <input ref={patFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => { const f=e.target.files?.[0]; if(f) handlePatFile(f); }} />
            </div>
          )}

          {patStep === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-white/50 text-xs">{patRows.length} paciente{patRows.length!==1?"s":""} detectado{patRows.length!==1?"s":""}</p>
                <div className="flex gap-2">
                  <button onClick={() => { setPatRows([]); setPatStep("upload"); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-white/40 hover:text-white/70 hover:bg-white/5 transition">Cancelar</button>
                  <button onClick={runPatImport}
                    className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-black transition">
                    Importar {patRows.length} paciente{patRows.length!==1?"s":""}
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/8" style={{ background:"rgba(255,255,255,0.04)" }}>
                        {["CPF","Nome","Nascimento","Telefone","E-mail","Cidade","Convênio"].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-white/30 font-black uppercase tracking-wider text-[9px] whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {patRows.map((r,i) => (
                        <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                          <td className="px-3 py-2 text-white/50 font-mono whitespace-nowrap">{r.cpf}</td>
                          <td className="px-3 py-2 text-white font-semibold whitespace-nowrap">{r.nome||"—"}</td>
                          <td className="px-3 py-2 text-white/40 whitespace-nowrap">{r.data_nascimento||"—"}</td>
                          <td className="px-3 py-2 text-white/40 font-mono">{r.telefone||"—"}</td>
                          <td className="px-3 py-2 text-white/40 truncate max-w-[120px]">{r.email||"—"}</td>
                          <td className="px-3 py-2 text-white/40">{r.cidade||"—"}</td>
                          <td className="px-3 py-2 text-violet-300/70">{r.convenio||"—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {patStep === "importing" && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Loader size={28} className="animate-spin text-sky-400 mb-3" />
              <p className="text-white/60 font-bold text-sm">Importando pacientes...</p>
              <p className="text-white/30 text-xs mt-1">Verificando CPFs e aplicando upsert</p>
            </div>
          )}

          {patStep === "done" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {(["criado","atualizado","erro"] as PatResult["status"][]).map(s => {
                  const n = patSummary[s] || 0;
                  const st = PAT_RESULT_STYLE[s];
                  return (
                    <div key={s} className={`rounded-xl p-3 ${st.bg}`}>
                      <p className={`text-2xl font-black ${st.text}`}>{n}</p>
                      <p className="text-white/40 text-[10px] font-bold mt-0.5">{st.label}</p>
                    </div>
                  );
                })}
              </div>
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="overflow-x-auto max-h-80">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/8" style={{ background:"rgba(255,255,255,0.04)" }}>
                        {["CPF","Nome","Resultado"].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-white/30 font-black uppercase tracking-wider text-[9px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {patResults.map((r,i) => {
                        const st = PAT_RESULT_STYLE[r.status];
                        return (
                          <tr key={i} className="border-b border-white/5">
                            <td className="px-3 py-2 text-white/40 font-mono">{r.cpf}</td>
                            <td className="px-3 py-2 text-white font-semibold">{r.nome||"—"}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-black ${st.bg} ${st.text}`}>{st.label}</span>
                              {r.status==="erro" && <span className="ml-2 text-rose-300/60 text-[9px]">{r.msg}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <button onClick={() => { setPatStep("upload"); setPatRows([]); setPatResults([]); }}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-bold border border-white/10 transition">
                Nova importação
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══ AGENDAMENTOS ══ */}
      {section === "agendamentos" && (
        <div className="space-y-6">
          {/* Vinculação */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-white font-bold text-sm mb-1">Vincular Financeiro ao WhatsApp</p>
                <p className="text-white/40 text-xs">Cruza automaticamente os nomes da planilha financeira com os contatos do WhatsApp.</p>
                {linkMsg && <p className="text-emerald-300 text-xs font-bold mt-2">{linkMsg}</p>}
              </div>
              <button onClick={handleVincular} disabled={linking}
                className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition disabled:opacity-50">
                {linking ? <Loader size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                {linking ? "Vinculando..." : "Vincular Agora"}
              </button>
            </div>
          </div>

          {/* Import agendamentos */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-white font-bold text-sm">Importar Agendamentos via Excel</p>
              <button onClick={downloadAgTemplate}
                className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition px-2 py-1 rounded-lg hover:bg-white/5">
                <Download size={12} /> Baixar modelo
              </button>
            </div>

            {agStep === "upload" && (
              <div
                onDragOver={e => { e.preventDefault(); setAgDragOver(true); }}
                onDragLeave={() => setAgDragOver(false)}
                onDrop={e => { e.preventDefault(); setAgDragOver(false); const f=e.dataTransfer.files[0]; if(f) handleAgFile(f); }}
                onClick={() => agFileRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${agDragOver ? "border-emerald-400 bg-emerald-500/10" : "border-white/10 hover:border-white/25 hover:bg-white/[0.03]"}`}>
                <Upload size={28} className="mx-auto mb-3 text-white/25" />
                <p className="text-white/60 font-bold text-sm">Arraste o Excel aqui ou clique para selecionar</p>
                <p className="text-white/25 text-xs mt-1">.xlsx · .xls · .csv</p>
                <input ref={agFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={e => { const f=e.target.files?.[0]; if(f) handleAgFile(f); }} />
              </div>
            )}

            {agStep === "preview" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-white/50 text-xs">{agRows.length} linha{agRows.length!==1?"s":""} detectada{agRows.length!==1?"s":""}</p>
                  <div className="flex gap-2">
                    <button onClick={() => { setAgRows([]); setAgStep("upload"); }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-white/40 hover:text-white/70 hover:bg-white/5 transition">Cancelar</button>
                    <button onClick={runAgImport}
                      className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition">
                      Importar {agRows.length} registro{agRows.length!==1?"s":""}
                    </button>
                  </div>
                </div>
                <div className="rounded-xl border border-white/8 overflow-hidden">
                  <div className="overflow-x-auto max-h-72">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/8" style={{ background:"rgba(255,255,255,0.04)" }}>
                          {["Nome","Telefone","Médico","Data","Hora","Tipo","Valor","Pgto"].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-white/30 font-black uppercase tracking-wider text-[9px] whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {agRows.map((r,i) => (
                          <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                            <td className="px-3 py-2 text-white font-semibold whitespace-nowrap">{r.nome||"—"}</td>
                            <td className="px-3 py-2 text-white/40 font-mono">{r.telefone||"—"}</td>
                            <td className="px-3 py-2 text-violet-300/80">{r.medico||"—"}</td>
                            <td className="px-3 py-2 text-white/50 whitespace-nowrap">{r.data}</td>
                            <td className="px-3 py-2 text-white/50">{r.hora}</td>
                            <td className="px-3 py-2 text-white/40">{r.tipo||"—"}</td>
                            <td className="px-3 py-2 text-emerald-300">{r.valor?`R$ ${r.valor}`:"—"}</td>
                            <td className="px-3 py-2 text-white/40">{r.pagamento||"—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {agStep === "importing" && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Loader size={28} className="animate-spin text-emerald-400 mb-3" />
                <p className="text-white/60 font-bold text-sm">Importando e cruzando dados...</p>
              </div>
            )}

            {agStep === "done" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(["vinculado","novo_lead","sem_lead","erro"] as ImportResult["status"][]).map(s => {
                    const n = agSummary[s]||0;
                    const st = AG_RESULT_STYLE[s];
                    return (
                      <div key={s} className={`rounded-xl p-3 ${st.bg}`}>
                        <p className={`text-xl font-black ${st.text}`}>{n}</p>
                        <p className="text-white/40 text-[10px] font-bold mt-0.5">{st.label}</p>
                      </div>
                    );
                  })}
                </div>
                <div className="rounded-xl border border-white/8 overflow-hidden">
                  <div className="overflow-x-auto max-h-80">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/8" style={{ background:"rgba(255,255,255,0.04)" }}>
                          {["Nome","Médico","Data","Resultado"].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-white/30 font-black uppercase tracking-wider text-[9px]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {agResults.map((r,i) => {
                          const st = AG_RESULT_STYLE[r.status];
                          return (
                            <tr key={i} className="border-b border-white/5">
                              <td className="px-3 py-2 text-white font-semibold">{r.nome||"—"}</td>
                              <td className="px-3 py-2 text-violet-300/70">{r.medico||"—"}</td>
                              <td className="px-3 py-2 text-white/40 whitespace-nowrap">{r.data} {r.hora}</td>
                              <td className="px-3 py-2">
                                <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-black ${st.bg} ${st.text}`}>{st.label}</span>
                                {r.status==="erro" && <span className="ml-2 text-rose-300/60 text-[9px]">{r.msg}</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <button onClick={() => { setAgStep("upload"); setAgRows([]); setAgResults([]); }}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-bold border border-white/10 transition">
                  Nova importação
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
