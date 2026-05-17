import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Upload, CheckCircle, XCircle, AlertCircle, Loader, Download } from "lucide-react";
import { importAgendamentosExcel, vincularFinanceiroLeads, type ImportRow, type ImportResult } from "../lib/api";

type Step = "upload" | "preview" | "importing" | "done";

function excelDateToStr(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (v instanceof Date) {
    const d = v.getDate().toString().padStart(2, "0");
    const m = (v.getMonth() + 1).toString().padStart(2, "0");
    const y = v.getFullYear();
    return `${d}/${m}/${y}`;
  }
  // Excel serial number
  if (typeof v === "number") {
    const date = XLSX.SSF.parse_date_code(v);
    if (date) return `${String(date.d).padStart(2,"0")}/${String(date.m).padStart(2,"0")}/${date.y}`;
  }
  return String(v);
}

function excelTimeToStr(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (v instanceof Date) {
    return `${v.getHours().toString().padStart(2,"0")}:${v.getMinutes().toString().padStart(2,"0")}`;
  }
  if (typeof v === "number") {
    const totalMin = Math.round(v * 24 * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h.toString().padStart(2,"0")}:${m.toString().padStart(2,"0")}`;
  }
  return String(v);
}

function parseRows(sheet: XLSX.WorkSheet): ImportRow[] {
  const raw = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
  const rows: ImportRow[] = [];
  // Pula cabeçalho (linha 0)
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const nome     = String(r[0] ?? "").trim();
    const telefone = String(r[1] ?? "").trim();
    const medico   = String(r[2] ?? "").trim();
    const data     = excelDateToStr(r[3]);
    const hora     = excelTimeToStr(r[4]);
    const tipo     = String(r[5] ?? "").trim();
    const valorRaw = r[6];
    const valor    = valorRaw ? parseFloat(String(valorRaw).replace(",",".")) || null : null;
    const pagamento = String(r[7] ?? "").trim();
    const parcelas  = parseInt(String(r[8] ?? "1")) || 1;
    const obs       = String(r[9] ?? "").trim();

    if (!nome && !telefone && !medico) continue; // linha vazia
    rows.push({ nome, telefone, medico, data, hora, tipo, valor, pagamento, parcelas, obs });
  }
  return rows;
}

const STATUS_STYLE: Record<ImportResult["status"], { bg: string; text: string; label: string }> = {
  vinculado:  { bg: "bg-emerald-500/15", text: "text-emerald-300", label: "✅ Vinculado" },
  novo_lead:  { bg: "bg-sky-500/15",     text: "text-sky-300",     label: "🆕 Novo lead" },
  sem_lead:   { bg: "bg-amber-500/15",   text: "text-amber-300",   label: "⚠ Sem lead" },
  erro:       { bg: "bg-rose-500/15",    text: "text-rose-300",    label: "❌ Erro" },
};

export default function ImportPage() {
  const fileRef              = useRef<HTMLInputElement>(null);
  const [step, setStep]      = useState<Step>("upload");
  const [rows, setRows]      = useState<ImportRow[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [linkMsg, setLinkMsg] = useState("");
  const [linking, setLinking] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      const wb   = XLSX.read(data, { type: "array", cellDates: true });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const parsed = parseRows(ws);
      setRows(parsed);
      setStep("preview");
    };
    reader.readAsArrayBuffer(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function runImport() {
    setStep("importing");
    const res = await importAgendamentosExcel(rows);
    setResults(res);
    setStep("done");
  }

  async function handleVincular() {
    setLinking(true);
    setLinkMsg("");
    const n = await vincularFinanceiroLeads();
    setLinkMsg(`✅ ${n} registro${n !== 1 ? "s" : ""} financeiro${n !== 1 ? "s" : ""} vinculado${n !== 1 ? "s" : ""} ao WhatsApp`);
    setLinking(false);
  }

  function downloadTemplate() {
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

  const summary = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6 p-1">
      {/* Vinculação financeiro → leads */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-white font-bold text-sm mb-1">Vincular Financeiro ao WhatsApp</p>
            <p className="text-white/40 text-xs">Tenta cruzar automaticamente os nomes da planilha financeira com os contatos do WhatsApp.</p>
            {linkMsg && <p className="text-emerald-300 text-xs font-bold mt-2">{linkMsg}</p>}
          </div>
          <button
            onClick={handleVincular}
            disabled={linking}
            className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition disabled:opacity-50"
          >
            {linking ? <Loader size={13} className="animate-spin" /> : <CheckCircle size={13} />}
            {linking ? "Vinculando..." : "Vincular Agora"}
          </button>
        </div>
      </div>

      {/* Import de agendamentos */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-white font-bold text-sm">Importar Agendamentos via Excel</p>
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition px-2 py-1 rounded-lg hover:bg-white/5"
          >
            <Download size={12} /> Baixar modelo
          </button>
        </div>

        {step === "upload" && (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
              dragOver ? "border-emerald-400 bg-emerald-500/10" : "border-white/10 hover:border-white/25 hover:bg-white/[0.03]"
            }`}
          >
            <Upload size={28} className="mx-auto mb-3 text-white/25" />
            <p className="text-white/60 font-bold text-sm">Arraste o Excel aqui ou clique para selecionar</p>
            <p className="text-white/25 text-xs mt-1">.xlsx · .xls · .csv</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-white/50 text-xs">{rows.length} linha{rows.length !== 1 ? "s" : ""} detectada{rows.length !== 1 ? "s" : ""}</p>
              <div className="flex gap-2">
                <button onClick={() => { setRows([]); setStep("upload"); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-white/40 hover:text-white/70 hover:bg-white/5 transition">
                  Cancelar
                </button>
                <button onClick={runImport}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition">
                  Importar {rows.length} registro{rows.length !== 1 ? "s" : ""}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-white/8 overflow-hidden">
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/8" style={{ background: "rgba(255,255,255,0.04)" }}>
                      {["Nome","Telefone","Médico","Data","Hora","Tipo","Valor","Pgto"].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-white/30 font-black uppercase tracking-wider text-[9px] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="px-3 py-2 text-white font-semibold whitespace-nowrap">{r.nome || "—"}</td>
                        <td className="px-3 py-2 text-white/40 font-mono">{r.telefone || "—"}</td>
                        <td className="px-3 py-2 text-violet-300/80">{r.medico || "—"}</td>
                        <td className="px-3 py-2 text-white/50 whitespace-nowrap">{r.data}</td>
                        <td className="px-3 py-2 text-white/50">{r.hora}</td>
                        <td className="px-3 py-2 text-white/40">{r.tipo || "—"}</td>
                        <td className="px-3 py-2 text-emerald-300">{r.valor ? `R$ ${r.valor}` : "—"}</td>
                        <td className="px-3 py-2 text-white/40">{r.pagamento || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Loader size={28} className="animate-spin text-emerald-400 mb-3" />
            <p className="text-white/60 font-bold text-sm">Importando e cruzando dados...</p>
            <p className="text-white/30 text-xs mt-1">Isso pode levar alguns segundos</p>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            {/* Resumo */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(["vinculado","novo_lead","sem_lead","erro"] as const).map(s => {
                const n = summary[s] || 0;
                const st = STATUS_STYLE[s];
                return (
                  <div key={s} className={`rounded-xl p-3 ${st.bg}`}>
                    <p className={`text-xl font-black ${st.text}`}>{n}</p>
                    <p className="text-white/40 text-[10px] font-bold mt-0.5">{st.label}</p>
                  </div>
                );
              })}
            </div>

            {/* Tabela de resultados */}
            <div className="rounded-xl border border-white/8 overflow-hidden">
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/8" style={{ background: "rgba(255,255,255,0.04)" }}>
                      {["Nome","Médico","Data","Resultado"].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-white/30 font-black uppercase tracking-wider text-[9px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => {
                      const st = STATUS_STYLE[r.status];
                      return (
                        <tr key={i} className="border-b border-white/5">
                          <td className="px-3 py-2 text-white font-semibold">{r.nome || "—"}</td>
                          <td className="px-3 py-2 text-violet-300/70">{r.medico || "—"}</td>
                          <td className="px-3 py-2 text-white/40 whitespace-nowrap">{r.data} {r.hora}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-black ${st.bg} ${st.text}`}>
                              {st.label}
                            </span>
                            {r.status === "erro" && (
                              <span className="ml-2 text-rose-300/60 text-[9px]">{r.msg}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <button
              onClick={() => { setStep("upload"); setRows([]); setResults([]); }}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-bold border border-white/10 transition"
            >
              Nova importação
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
