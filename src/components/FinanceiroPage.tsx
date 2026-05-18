import { useEffect, useRef, useState } from "react";
import { DollarSign, CreditCard, TrendingUp, Receipt, Plus, Search, Download, Trash2, X, Upload, FileSpreadsheet, CheckCircle, AlertCircle, FileText, ChevronRight, Sparkles, AlertTriangle, Filter, ChevronDown } from "lucide-react";
import { fetchFinanceiro, fetchMedicos, insertFinanceiro, deleteFinanceiro, bulkInsertFinanceiro, fetchNotasFiscais, uploadNotaFiscal, getNotaFiscalUrl, deleteNotaFiscal } from "../lib/api";

function fmt(val: number) {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

const FORMAS = ["crédito", "débito", "pix", "dinheiro"];
const FORMA_STYLE: Record<string, string> = {
  crédito:  "bg-violet-500/20 text-violet-300 border-violet-500/30",
  débito:   "bg-sky-500/20 text-sky-300 border-sky-500/30",
  pix:      "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  dinheiro: "bg-amber-500/20 text-amber-300 border-amber-500/30",
};
const EMPTY_FORM = {
  nome_paciente: "", medico_id: "", medico_nome: "",
  valor: "", forma_pagamento: "pix", bandeira: "",
  parcelas: "1", data_pagamento: new Date().toISOString().slice(0, 10), observacoes: "",
};

const DB_FIELDS = [
  { key: "nome_paciente",   label: "Paciente",          required: false },
  { key: "medico_nome",     label: "Médico",             required: false },
  { key: "valor",           label: "Valor (R$)",         required: true  },
  { key: "forma_pagamento", label: "Forma de Pagamento", required: false },
  { key: "bandeira",        label: "Bandeira",           required: false },
  { key: "parcelas",        label: "Parcelas",           required: false },
  { key: "data_pagamento",  label: "Data",               required: false },
  { key: "observacoes",     label: "Observações",        required: false },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function parseValor(raw: any): number | null {
  if (raw == null || raw === "") return null;
  // Remove currency symbols and whitespace
  let s = String(raw).replace(/[R$\s]/g, "").trim();
  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot   = s.lastIndexOf(".");

  if (lastComma > lastDot) {
    // Brazilian format: 1.835,11 — dots=thousand, comma=decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    // US format: 1,835.11 — commas=thousand, dot=decimal
    s = s.replace(/,/g, "");
  } else {
    // No separator or only one type — try removing commas
    s = s.replace(/,/g, "");
  }

  const n = parseFloat(s);
  return isNaN(n) || n === 0 ? null : Math.abs(n); // always positive
}

function parseData(raw: any): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // Already ISO yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const y  = m[3].length === 2 ? `20${m[3]}` : m[3];
    const p1 = parseInt(m[1]);
    const p2 = parseInt(m[2]);
    // If second segment > 12, it cannot be a month → format is MM/DD/YY (US)
    if (p2 > 12) {
      return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    }
    // Otherwise assume DD/MM/YY (BR)
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function normalizeForma(raw: any): string | undefined {
  if (!raw) return undefined;
  const s = norm(String(raw));
  if (s.includes("cred") || s.includes("carto") || s.includes("credit")) return "crédito";
  if (s.includes("deb"))  return "débito";
  if (s.includes("pix"))  return "pix";
  if (s.includes("din") || s.includes("cash") || s.includes("especie")) return "dinheiro";
  return String(raw).toLowerCase().trim();
}

function findMedicoId(name: string, medicos: any[]): string | undefined {
  if (!name) return undefined;
  const target = norm(name.replace(/^(dr\.|dra\.)\s*/i, ""));
  const match = medicos.find(m =>
    norm(m.nome.replace(/^(dr\.|dra\.)\s*/i, "")).includes(target) ||
    target.includes(norm(m.nome.replace(/^(dr\.|dra\.)\s*/i, "")))
  );
  return match?.id;
}

const MATCHERS: Record<string, string[]> = {
  nome_paciente:   ["paciente", "nome paciente", "cliente", "patient"],
  medico_nome:     ["medico", "doutor", "doctor"],
  valor:           ["valor bruto", "bruto", "valor pago", "valor", "preco", "price", "value", "r$", "quantia", "entrada"],
  forma_pagamento: ["forma de pag", "forma", "pagamento", "payment", "metodo"],
  bandeira:        ["bandeira", "brand", "operadora"],
  parcelas:        ["qtd de parcela", "parcela", "installment"],
  data_pagamento:  ["data da venda", "data pagamento", "data de venda", "data", "date"],
  observacoes:     ["procedimento", "descricao", "obs", "note", "complemento"],
};

const NON_DOCTOR_SHEETS = ["Extrato", "Conferencia", "Saldo Diario", "Repasse", "Tizerpatida", "Resumo"];

function findHeaderRow(rawRows: any[][]): number {
  const keywords = ["data", "paciente", "valor", "forma", "bandeira", "medico", "procedimento", "pagamento", "bruto"];
  for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
    const hits = (rawRows[i] || []).filter((cell: any) => {
      const s = norm(String(cell || ""));
      return keywords.some(k => s.includes(k));
    }).length;
    if (hits >= 2) return i;
  }
  return 0;
}

function parseDateSmart(raw: any, fmt: "auto" | "dmy" | "mdy"): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // "Saturday, November 15, 2025" or similar long format
  if (s.includes(",") && s.length > 10) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  const y  = m[3].length === 2 ? `20${m[3]}` : m[3];
  const p2 = parseInt(m[2]);
  if (fmt === "mdy" || (fmt === "auto" && p2 > 12)) {
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function autoDetectColumns(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    const hn = norm(h);
    for (const [field, keywords] of Object.entries(MATCHERS)) {
      if (!map[field] && keywords.some(k => hn.includes(norm(k)))) {
        map[field] = h;
        break;
      }
    }
  }
  return map;
}

function fmtFileSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ── PatientHistoryModal ───────────────────────────────────────────────────────

function PatientHistoryModal({ nomePaciente, todasTransacoes, medicos, currentUser, onClose }: {
  nomePaciente: string;
  todasTransacoes: any[];
  medicos: any[];
  currentUser: any;
  onClose: () => void;
}) {
  const [nfs, setNfs]               = useState<any[]>([]);
  const [nfFile, setNfFile]         = useState<File | null>(null);
  const [nfNumero, setNfNumero]     = useState("");
  const [nfData, setNfData]         = useState(new Date().toISOString().slice(0, 10));
  const [nfValor, setNfValor]       = useState("");
  const [nfObs, setNfObs]           = useState("");
  const [uploadingNf, setUploadingNf] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const nfFileRef = useRef<HTMLInputElement>(null);

  const txs = todasTransacoes
    .filter(t => (t.nome_paciente || "").toLowerCase() === nomePaciente.toLowerCase())
    .sort((a, b) => new Date(b.data_pagamento).getTime() - new Date(a.data_pagamento).getTime());

  const total        = txs.reduce((s, t) => s + Number(t.valor || 0), 0);
  const formaFav     = (() => {
    const cnt: Record<string, number> = {};
    txs.forEach(t => { if (t.forma_pagamento) cnt[t.forma_pagamento] = (cnt[t.forma_pagamento] || 0) + 1; });
    return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  })();

  useEffect(() => {
    fetchNotasFiscais({ nomePaciente }).then(setNfs);
  }, [nomePaciente]);

  async function handleNfUpload() {
    if (!nfFile) return;
    setUploadingNf(true);
    const result = await uploadNotaFiscal({
      file:          nfFile,
      nomePaciente,
      numeroNf:      nfNumero  || undefined,
      dataEmissao:   nfData    || undefined,
      valor:         nfValor   ? parseFloat(nfValor.replace(",", ".")) : undefined,
      observacoes:   nfObs     || undefined,
      uploadedBy:    currentUser?.nome,
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
    if (!confirm(`Excluir "${nf.file_name}"?`)) return;
    setDeletingId(nf.id);
    await deleteNotaFiscal(nf.id, nf.file_path);
    setNfs(prev => prev.filter(n => n.id !== nf.id));
    setDeletingId(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl border border-white/10 shadow-2xl overflow-hidden" style={{ background: "rgba(10,20,60,0.97)" }}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-black text-lg">
            {nomePaciente[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-black">{nomePaciente}</p>
            <p className="text-white/40 text-xs">{txs.length} pagamento{txs.length !== 1 ? "s" : ""} · Total {total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Gasto",    value: total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), color: "text-emerald-400" },
              { label: "Pagamentos",     value: txs.length,  color: "text-white"        },
              { label: "Forma Favorita", value: formaFav,    color: "text-violet-300"   },
            ].map(c => (
              <div key={c.label} className="rounded-xl border border-white/10 p-3 text-center" style={{ background: "rgba(255,255,255,0.04)" }}>
                <p className={`font-black text-lg leading-none ${c.color}`}>{c.value}</p>
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-wide mt-1">{c.label}</p>
              </div>
            ))}
          </div>

          {/* Transaction timeline */}
          <div>
            <p className="text-white/40 text-[10px] font-bold uppercase tracking-wide mb-2">Histórico de Pagamentos</p>
            {txs.length === 0 ? (
              <p className="text-white/20 text-xs text-center py-4">Nenhum pagamento encontrado</p>
            ) : (
              <div className="space-y-1.5">
                {txs.map(t => (
                  <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/5" style={{ background: "rgba(255,255,255,0.03)" }}>
                    <div className="text-right shrink-0 w-12">
                      <p className="text-white/40 text-[10px]">{new Date(t.data_pagamento).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</p>
                      <p className="text-white/20 text-[9px]">{new Date(t.data_pagamento).getFullYear()}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white/60 text-xs truncate">{t.medico_nome?.replace(/^(Dr\.|Dra\.) /, "") || "—"}</p>
                      {t.observacoes && <p className="text-white/30 text-[10px] truncate">{t.observacoes}</p>}
                    </div>
                    {t.forma_pagamento && (
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border shrink-0 ${FORMA_STYLE[t.forma_pagamento] || "bg-white/10 text-white/40 border-white/10"}`}>
                        {t.forma_pagamento.toUpperCase()}{t.parcelas > 1 ? ` ${t.parcelas}x` : ""}
                      </span>
                    )}
                    <p className="text-emerald-400 font-black text-xs shrink-0">{Number(t.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Nota Fiscal section */}
          <div>
            <p className="text-white/40 text-[10px] font-bold uppercase tracking-wide mb-2">Notas Fiscais</p>

            {/* Upload form */}
            <div className="rounded-xl border border-white/10 p-4 space-y-3 mb-3" style={{ background: "rgba(255,255,255,0.03)" }}>
              <div onClick={() => nfFileRef.current?.click()}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 border-dashed cursor-pointer transition ${nfFile ? "border-emerald-500/50 bg-emerald-500/5" : "border-white/15 hover:border-white/25"}`}>
                <Upload size={14} className={nfFile ? "text-emerald-400" : "text-white/30"} />
                <p className={`text-xs font-semibold ${nfFile ? "text-emerald-300" : "text-white/30"}`}>
                  {nfFile ? `${nfFile.name} · ${fmtFileSize(nfFile.size)}` : "Selecionar PDF, XML ou imagem"}
                </p>
                <input ref={nfFileRef} type="file" accept=".pdf,.xml,image/*" className="hidden"
                  onChange={e => setNfFile(e.target.files?.[0] || null)} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <input value={nfNumero} onChange={e => setNfNumero(e.target.value)} placeholder="Nº da Nota (opcional)"
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                <input type="date" value={nfData} onChange={e => setNfData(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                <input type="number" min="0" step="0.01" value={nfValor} onChange={e => setNfValor(e.target.value)} placeholder="Valor R$ (opcional)"
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                <input value={nfObs} onChange={e => setNfObs(e.target.value)} placeholder="Observações"
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
              </div>

              <button onClick={handleNfUpload} disabled={!nfFile || uploadingNf}
                className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition disabled:opacity-40">
                {uploadingNf ? "Enviando..." : "Anexar Nota Fiscal"}
              </button>
            </div>

            {/* NF list */}
            {nfs.length === 0 ? (
              <p className="text-white/20 text-xs text-center py-3">Nenhuma nota anexada</p>
            ) : (
              <div className="space-y-2">
                {nfs.map(nf => (
                  <div key={nf.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/10" style={{ background: "rgba(255,255,255,0.03)" }}>
                    <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
                      <FileText size={12} className="text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white/80 text-xs font-bold truncate">{nf.file_name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {nf.numero_nf    && <span className="text-white/40 text-[10px]">NF {nf.numero_nf}</span>}
                        {nf.data_emissao && <span className="text-white/30 text-[10px]">{new Date(nf.data_emissao).toLocaleDateString("pt-BR")}</span>}
                        {nf.valor        && <span className="text-emerald-400 text-[10px] font-black">{Number(nf.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>}
                      </div>
                    </div>
                    <button onClick={() => handleNfDownload(nf)} disabled={downloadingId === nf.id}
                      className="p-1.5 rounded-lg hover:bg-sky-500/20 text-white/30 hover:text-sky-400 transition" title="Baixar">
                      <Download size={13} />
                    </button>
                    <button onClick={() => handleNfDelete(nf)} disabled={deletingId === nf.id}
                      className="p-1.5 rounded-lg hover:bg-rose-500/20 text-white/20 hover:text-rose-400 transition" title="Excluir">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Smart search parser ───────────────────────────────────────────────────────

const MESES_PT = ["janeiro","fevereiro","março","marco","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const MESES_NUM: Record<string,number> = {
  janeiro:1,fevereiro:2,"março":3,marco:3,abril:4,maio:5,junho:6,
  julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12,
};

function parseSmartQuery(raw: string): {
  mes?: number; ano?: number; valorMin?: number; valorMax?: number;
  forma?: string; incompletos?: boolean; paciente?: string;
  descricao: string;
} {
  const q = raw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const result: ReturnType<typeof parseSmartQuery> = { descricao: "" };
  const parts: string[] = [];
  let rest = q;

  // Month
  for (const m of MESES_PT) {
    if (rest.includes(m.normalize("NFD").replace(/[̀-ͯ]/g, ""))) {
      result.mes = MESES_NUM[m] ?? MESES_NUM[m.normalize("NFD").replace(/[̀-ͯ]/g, "")];
      rest = rest.replace(m.normalize("NFD").replace(/[̀-ͯ]/g, ""), "");
      parts.push(MESES_PT[result.mes! - 1]);
      break;
    }
  }

  // Year
  const anoM = rest.match(/\b(202[0-9]|201[0-9])\b/);
  if (anoM) { result.ano = parseInt(anoM[1]); rest = rest.replace(anoM[0], ""); parts.push(anoM[0]); }

  // Valor acima / maior
  const acimaM = rest.match(/(?:acima|maior|mais|>)\s*(?:de\s*)?r?\$?\s*(\d+(?:[.,]\d+)?)/);
  if (acimaM) { result.valorMin = parseFloat(acimaM[1].replace(",",".")); rest = rest.replace(acimaM[0],""); parts.push(`acima de R$${result.valorMin}`); }

  // Valor abaixo / menor
  const abaixoM = rest.match(/(?:abaixo|menor|ate|até|<)\s*(?:de\s*)?r?\$?\s*(\d+(?:[.,]\d+)?)/);
  if (abaixoM) { result.valorMax = parseFloat(abaixoM[1].replace(",",".")); rest = rest.replace(abaixoM[0],""); parts.push(`até R$${result.valorMax}`); }

  // Valor exato "de X a Y"
  const rangeM = rest.match(/de\s*r?\$?\s*(\d+(?:[.,]\d+)?)\s*a\s*r?\$?\s*(\d+(?:[.,]\d+)?)/);
  if (rangeM) {
    result.valorMin = parseFloat(rangeM[1].replace(",",".")); result.valorMax = parseFloat(rangeM[2].replace(",","."));
    rest = rest.replace(rangeM[0],""); parts.push(`R$${result.valorMin}–R$${result.valorMax}`);
  }

  // Forma
  if (/\bpix\b/.test(rest)) { result.forma = "pix"; parts.push("pix"); rest = rest.replace("pix",""); }
  else if (/cred/.test(rest)) { result.forma = "crédito"; parts.push("crédito"); }
  else if (/deb/.test(rest)) { result.forma = "débito"; parts.push("débito"); }
  else if (/dinheiro|especie|espécie/.test(rest)) { result.forma = "dinheiro"; parts.push("dinheiro"); }

  // Incompletos
  if (/incompleto|faltando|sem paciente|sem data/.test(rest)) { result.incompletos = true; parts.push("dados incompletos"); }

  // Restante → paciente
  const leftover = rest.replace(/[^a-z\s]/g, "").trim().split(/\s+/).filter(w => w.length > 2 && !["com","que","nos","nas","dos","das","uma","para","pelo","pela"].includes(w));
  if (leftover.length) { result.paciente = leftover.join(" "); parts.push(`"${result.paciente}"`); }

  result.descricao = parts.join(" · ") || "Mostrando tudo";
  return result;
}

// ── Component ─────────────────────────────────────────────────────────────────

type PeriodoMode = "mes_atual" | "mes_anterior" | "ano_atual" | "90dias" | "mes_especifico" | "intervalo" | "tudo";

export default function FinanceiroPage() {
  const [transacoes, setTransacoes]     = useState<any[]>([]);
  const [medicos, setMedicos]           = useState<any[]>([]);
  const [medicoFiltro, setMedicoFiltro] = useState("");
  const [periodoMode, setPeriodoMode]   = useState<PeriodoMode>("mes_atual");
  const [mesAno, setMesAno]             = useState(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`; });
  const [dataInicio, setDataInicio]     = useState("");
  const [dataFim, setDataFim]           = useState("");
  const [busca, setBusca]               = useState("");
  const [valorMin, setValorMin]         = useState("");
  const [valorMax, setValorMax]         = useState("");
  const [formaFiltro, setFormaFiltro]   = useState("");
  const [somenteIncompletos, setSomenteIncompletos] = useState(false);
  const [gptQuery, setGptQuery]         = useState("");
  const [gptResult, setGptResult]       = useState<ReturnType<typeof parseSmartQuery> | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading]           = useState(true);

  // Manual entry modal
  const [showModal, setShowModal]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [form, setForm]             = useState({ ...EMPTY_FORM });

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Patient history modal
  const [paciente, setPaciente] = useState<string | null>(null);

  // Import
  const fileRef                                   = useRef<HTMLInputElement>(null);
  const [importRows, setImportRows]               = useState<any[]>([]);
  const [importHeaders, setImportHeaders]         = useState<string[]>([]);
  const [colMap, setColMap]                       = useState<Record<string, string>>({});
  const [showImport, setShowImport]               = useState(false);
  const [importing, setImporting]                 = useState(false);
  const [importResult, setImportResult]           = useState<{ ok: number; err: number } | null>(null);
  const [allSheetData, setAllSheetData]           = useState<Record<string, any[]>>({});
  const [importSheets, setImportSheets]           = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet]         = useState<string>("");
  const [dateFormat, setDateFormat]               = useState<"auto" | "dmy" | "mdy">("mdy");
  const [importAllDoctors, setImportAllDoctors]   = useState(false);

  function getPeriodoDates(): { from?: string; to?: string } {
    const now = new Date();
    if (periodoMode === "mes_atual") return {
      from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      to:   new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString(),
    };
    if (periodoMode === "mes_anterior") return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
      to:   new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString(),
    };
    if (periodoMode === "ano_atual") return {
      from: new Date(now.getFullYear(), 0, 1).toISOString(),
      to:   new Date(now.getFullYear(), 11, 31, 23, 59, 59).toISOString(),
    };
    if (periodoMode === "mes_especifico" && mesAno) {
      const [y, m] = mesAno.split("-").map(Number);
      return {
        from: new Date(y, m - 1, 1).toISOString(),
        to:   new Date(y, m, 0, 23, 59, 59).toISOString(),
      };
    }
    if (periodoMode === "intervalo") return {
      from: dataInicio ? `${dataInicio}T00:00:00` : undefined,
      to:   dataFim    ? `${dataFim}T23:59:59`    : undefined,
    };
    if (periodoMode === "tudo") return {};
    return {
      from: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      to:   now.toISOString(),
    };
  }

  async function load() {
    setLoading(true);
    const { from, to } = somenteIncompletos ? {} : getPeriodoDates();
    const [tr, med] = await Promise.all([
      fetchFinanceiro({ from, to }),
      fetchMedicos(),
    ]);
    setTransacoes(tr);
    setMedicos(med);
    setLoading(false);
  }

  useEffect(() => { load(); }, [periodoMode, mesAno, dataInicio, dataFim, somenteIncompletos]);

  const filtered = (() => {
    let result = transacoes;

    if (medicoFiltro) {
      const med = medicos.find(m => m.id === medicoFiltro);
      const baseName = med ? norm(med.nome.replace(/^(dr\.|dra\.)\s*/i, "").split(" ")[0]) : "";
      result = result.filter(t =>
        t.medico_id === medicoFiltro ||
        (baseName && norm(t.medico_nome || "").includes(baseName))
      );
    }
    if (formaFiltro) result = result.filter(t => t.forma_pagamento === formaFiltro);
    if (valorMin)    result = result.filter(t => Number(t.valor || 0) >= Number(valorMin));
    if (valorMax)    result = result.filter(t => Number(t.valor || 0) <= Number(valorMax));
    if (somenteIncompletos) result = result.filter(t => !t.nome_paciente || !t.data_pagamento || !t.forma_pagamento);

    const smart = gptResult;
    const textSearch = busca.trim();
    if (smart) {
      if (smart.mes)      result = result.filter(t => t.data_pagamento && new Date(t.data_pagamento).getMonth() + 1 === smart.mes);
      if (smart.ano)      result = result.filter(t => t.data_pagamento && new Date(t.data_pagamento).getFullYear() === smart.ano);
      if (smart.valorMin) result = result.filter(t => Number(t.valor || 0) >= smart.valorMin!);
      if (smart.valorMax) result = result.filter(t => Number(t.valor || 0) <= smart.valorMax!);
      if (smart.forma)    result = result.filter(t => t.forma_pagamento === smart.forma);
      if (smart.incompletos) result = result.filter(t => !t.nome_paciente || !t.data_pagamento || !t.forma_pagamento);
      if (smart.paciente) {
        const q = norm(smart.paciente);
        result = result.filter(t =>
          norm(t.nome_paciente || "").includes(q) || norm(t.medico_nome || "").includes(q) || norm(t.observacoes || "").includes(q)
        );
      }
    } else if (textSearch) {
      const q = norm(textSearch);
      result = result.filter(t =>
        norm(t.nome_paciente || "").includes(q) || norm(t.medico_nome || "").includes(q) || norm(t.observacoes || "").includes(q)
      );
    }

    return result.sort((a, b) => {
      const da = a.data_pagamento ? new Date(a.data_pagamento).getTime() : 0;
      const db = b.data_pagamento ? new Date(b.data_pagamento).getTime() : 0;
      return db - da;
    });
  })();

  const total       = filtered.reduce((s, t) => s + Number(t.valor || 0), 0);
  const ticketMedio = filtered.length > 0 ? total / filtered.length : 0;

  const byMedico = medicos
    .map(m => {
      const baseName = norm(m.nome.replace(/^(dr\.|dra\.)\s*/i, "").split(" ")[0]);
      return {
        id: m.id, nome: m.nome,
        total: filtered
          .filter(t => t.medico_id === m.id || (baseName && norm(t.medico_nome || "").includes(baseName)))
          .reduce((s, t) => s + Number(t.valor || 0), 0),
      };
    })
    .filter(m => m.total > 0)
    .sort((a, b) => b.total - a.total);

  const maxVal = byMedico[0]?.total || 1;

  const statCards = [
    { label: "Total do Período", value: fmt(total),       icon: DollarSign, color: "from-emerald-500 to-teal-600",  shadow: "shadow-emerald-500/30" },
    { label: "Ticket Médio",     value: fmt(ticketMedio), icon: TrendingUp, color: "from-sky-500 to-blue-600",      shadow: "shadow-sky-500/30"     },
    { label: "Pagamentos",       value: filtered.length,  icon: Receipt,    color: "from-violet-500 to-purple-600", shadow: "shadow-violet-500/30"  },
    { label: "Médicos Ativos",   value: byMedico.length,  icon: CreditCard, color: "from-amber-500 to-orange-600",  shadow: "shadow-amber-500/30"   },
  ];

  // ── Manual entry ──────────────────────────────────────────────────────────

  function handleFormChange(key: string, value: string) {
    if (key === "medico_id") {
      const med = medicos.find(m => m.id === value);
      setForm(f => ({ ...f, medico_id: value, medico_nome: med?.nome || "" }));
    } else {
      setForm(f => ({ ...f, [key]: value }));
    }
  }

  async function handleSave() {
    const valorNum = parseValor(form.valor);
    if (!valorNum || valorNum <= 0) return alert("Informe um valor válido.");
    setSaving(true);
    await insertFinanceiro({
      medico_id:       form.medico_id || undefined,
      nome_paciente:   form.nome_paciente || undefined,
      medico_nome:     form.medico_nome || undefined,
      valor:           valorNum,
      forma_pagamento: form.forma_pagamento || undefined,
      bandeira:        form.bandeira || undefined,
      parcelas:        parseInt(form.parcelas) || 1,
      data_pagamento:  form.data_pagamento ? `${form.data_pagamento}T12:00:00` : undefined,
      observacoes:     form.observacoes || undefined,
    });
    setSaving(false);
    setShowModal(false);
    setForm({ ...EMPTY_FORM });
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir este lançamento?")) return;
    setDeletingId(id);
    await deleteFinanceiro(id);
    setDeletingId(null);
    load();
  }

  // ── Export CSV ────────────────────────────────────────────────────────────

  function exportCSV() {
    const headers = ["Data", "Paciente", "Médico", "Forma", "Bandeira", "Parcelas", "Valor", "Obs"];
    const rows = filtered.map(t => [
      fmtDate(t.data_pagamento),
      t.nome_paciente || "",
      t.medico_nome   || "",
      t.forma_pagamento || "",
      t.bandeira      || "",
      t.parcelas      || 1,
      Number(t.valor).toFixed(2).replace(".", ","),
      (t.observacoes  || "").replace(/;/g, " "),
    ]);
    const csv  = [headers, ...rows].map(r => r.join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `financeiro-pronutro-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Import Excel ──────────────────────────────────────────────────────────

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });

    // Parse every sheet with smart header detection
    const allData: Record<string, any[]> = {};
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: "yyyy-mm-dd" }) as any[][];
      if (!rawRows.length) continue;
      const headerIdx  = findHeaderRow(rawRows);
      const headers    = (rawRows[headerIdx] || []).map((h: any) => String(h || "").trim()).filter(Boolean);
      if (headers.length < 2) continue;
      const data = XLSX.utils.sheet_to_json(ws, {
        header: headers, range: headerIdx + 1, raw: false, dateNF: "yyyy-mm-dd",
      }) as any[];
      if (data.length > 0) allData[sheetName] = data;
    }

    const sheets = wb.SheetNames.filter(s => allData[s]?.length);
    if (!sheets.length) { alert("Planilha vazia ou sem dados reconhecíveis."); return; }

    // Prefer doctor sheets; if multiple non-NON_DOCTOR_SHEETS found, offer "import all"
    const doctorSheets = sheets.filter(s => !NON_DOCTOR_SHEETS.includes(s));
    const defaultSheet = doctorSheets[0] || sheets[0];

    setAllSheetData(allData);
    setImportSheets(sheets);
    setSelectedSheet(defaultSheet);
    setImportAllDoctors(doctorSheets.length > 1);

    const firstRows = allData[defaultSheet] || [];
    const headers   = Object.keys(firstRows[0] || {});
    setImportHeaders(headers);
    setImportRows(firstRows);
    setColMap(autoDetectColumns(headers));
    setImportResult(null);
    setShowImport(true);
  }

  function buildPreviewRows(limit = 5) {
    return importRows.slice(0, limit).map(row => ({
      nome_paciente:   colMap.nome_paciente   ? row[colMap.nome_paciente]   : "",
      medico_nome:     colMap.medico_nome     ? row[colMap.medico_nome]     : "",
      valor:           colMap.valor           ? parseValor(row[colMap.valor]) : null,
      forma_pagamento: colMap.forma_pagamento ? normalizeForma(row[colMap.forma_pagamento]) : "",
      data_pagamento:  colMap.data_pagamento  ? parseDateSmart(row[colMap.data_pagamento], dateFormat) : null,
    }));
  }

  function handleSheetChange(name: string) {
    setSelectedSheet(name);
    const rows    = allSheetData[name] || [];
    const headers = Object.keys(rows[0] || {});
    setImportHeaders(headers);
    setImportRows(rows);
    setColMap(autoDetectColumns(headers));
  }

  function buildRows(rows: any[], cmap: Record<string, string>, medicoOverride?: string): object[] {
    return rows.map(row => {
      const valor = parseValor(row[cmap.valor]);
      if (!valor) return null;
      const medNome  = (cmap.medico_nome ? String(row[cmap.medico_nome] || "").trim() : "") || medicoOverride || "";
      const medicoId = findMedicoId(medNome, medicos);
      const dataPag  = cmap.data_pagamento ? parseDateSmart(row[cmap.data_pagamento], dateFormat) : null;
      return {
        nome_paciente:   cmap.nome_paciente   ? (String(row[cmap.nome_paciente]   || "").trim() || undefined) : undefined,
        medico_id:       medicoId,
        medico_nome:     medNome || undefined,
        valor,
        forma_pagamento: cmap.forma_pagamento ? normalizeForma(row[cmap.forma_pagamento]) : undefined,
        bandeira:        cmap.bandeira        ? (String(row[cmap.bandeira]        || "").trim() || undefined) : undefined,
        parcelas:        cmap.parcelas        ? (parseInt(row[cmap.parcelas]) || 1) : 1,
        data_pagamento:  dataPag ? `${dataPag}T12:00:00` : undefined,
        observacoes:     cmap.observacoes     ? (String(row[cmap.observacoes]     || "").trim() || undefined) : undefined,
        registrado_por:  "importacao",
      };
    }).filter(Boolean) as object[];
  }

  async function handleImport() {
    setImporting(true);

    let toInsert: object[] = [];

    if (importAllDoctors) {
      // Import each doctor sheet, using sheet name as medico_nome
      const doctorSheets = importSheets.filter(s => !NON_DOCTOR_SHEETS.includes(s));
      for (const sheetName of doctorSheets) {
        const rows    = allSheetData[sheetName] || [];
        const headers = Object.keys(rows[0] || {});
        const cmap    = autoDetectColumns(headers);
        if (!cmap.valor) continue;
        toInsert = [...toInsert, ...buildRows(rows, cmap, sheetName)];
      }
    } else {
      if (!colMap.valor) { alert("Mapeie pelo menos a coluna Valor."); setImporting(false); return; }
      toInsert = buildRows(importRows, colMap);
    }

    if (!toInsert.length) {
      setImporting(false);
      setImportResult({ ok: 0, err: 1 });
      return;
    }

    const ok = await bulkInsertFinanceiro(toInsert);
    setImporting(false);
    setImportResult({ ok: ok ? toInsert.length : 0, err: ok ? 0 : toInsert.length });
    if (ok) load();
  }

  const showBandeira = form.forma_pagamento === "crédito" || form.forma_pagamento === "débito";
  const previewRows  = showImport ? buildPreviewRows() : [];

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-4 space-y-5">

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCards.map(({ label, value, icon: Icon, color, shadow }) => (
          <div key={label} className="rounded-xl border border-white/10 p-4 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.04)" }}>
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-lg ${shadow} shrink-0`}>
              <Icon size={18} className="text-white" />
            </div>
            <div>
              <p className="text-white font-black text-lg leading-none">{loading ? "–" : value}</p>
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-wider mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filtros + Ações */}
      <div className="rounded-xl border border-white/10 p-3 space-y-2.5" style={{ background: "rgba(255,255,255,0.03)" }}>

        {/* Row 1: period presets + actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {(["mes_atual","mes_anterior","ano_atual","90dias","mes_especifico","intervalo","tudo"] as PeriodoMode[]).map(mode => {
            const labels: Record<PeriodoMode,string> = {
              mes_atual: "Este mês", mes_anterior: "Mês anterior", ano_atual: "Este ano",
              "90dias": "90 dias", mes_especifico: "Mês específico", intervalo: "Intervalo", tudo: "Tudo",
            };
            return (
              <button key={mode} onClick={() => setPeriodoMode(mode)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition border ${periodoMode === mode ? "bg-emerald-600 border-emerald-500 text-white" : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10"}`}>
                {labels[mode]}
              </button>
            );
          })}

          <div className="ml-auto flex items-center gap-2">
            <button onClick={exportCSV} disabled={filtered.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white text-xs font-bold transition disabled:opacity-30">
              <Download size={12} /> CSV
            </button>
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-black transition shadow-lg shadow-sky-500/30">
              <Upload size={12} /> Importar
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
            <button onClick={() => { setForm({ ...EMPTY_FORM }); setShowModal(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition shadow-lg shadow-emerald-500/30">
              <Plus size={13} /> Lançamento
            </button>
          </div>
        </div>

        {/* Row 2: conditional date pickers */}
        {periodoMode === "mes_especifico" && (
          <div className="flex items-center gap-2">
            <span className="text-white/40 text-xs">Mês/Ano:</span>
            <input type="month" value={mesAno} onChange={e => setMesAno(e.target.value)}
              style={{ colorScheme: "dark" }}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
          </div>
        )}
        {periodoMode === "intervalo" && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white/40 text-xs">De:</span>
            <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
              style={{ colorScheme: "dark" }}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
            <span className="text-white/40 text-xs">Até:</span>
            <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
              style={{ colorScheme: "dark" }}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
          </div>
        )}

        {/* Row 3: search + filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Smart search */}
          <div className="relative flex-1 min-w-[220px]">
            <Sparkles size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-violet-400 pointer-events-none" />
            <input value={gptQuery}
              onChange={e => { setGptQuery(e.target.value); if (!e.target.value.trim()) setGptResult(null); }}
              onKeyDown={e => { if (e.key === "Enter" && gptQuery.trim()) { setGptResult(parseSmartQuery(gptQuery)); setBusca(""); } }}
              placeholder='Busca inteligente: "pix acima de 500 em março" ↵'
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/25 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-violet-500/50" />
            {gptResult && (
              <button onClick={() => { setGptResult(null); setGptQuery(""); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/80 transition">
                <X size={11} />
              </button>
            )}
          </div>

          {/* Text search */}
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            <input value={busca} onChange={e => { setBusca(e.target.value); if (e.target.value) setGptResult(null); }}
              placeholder="Paciente / médico..."
              className="pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 w-40" />
          </div>

          {/* Médico */}
          <select value={medicoFiltro} onChange={e => setMedicoFiltro(e.target.value)}
            style={{ colorScheme: "dark" }}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none">
            <option value="">Todos médicos</option>
            {medicos.map(m => <option key={m.id} value={m.id}>{m.nome.replace(/^(Dr\.|Dra\.) /, "")}</option>)}
          </select>

          {/* Forma */}
          <select value={formaFiltro} onChange={e => setFormaFiltro(e.target.value)}
            style={{ colorScheme: "dark" }}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none">
            <option value="">Todas formas</option>
            {FORMAS.map(f => <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
          </select>

          {/* Valor range */}
          <input type="number" min="0" value={valorMin} onChange={e => setValorMin(e.target.value)}
            placeholder="R$ mín"
            className="w-20 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
          <input type="number" min="0" value={valorMax} onChange={e => setValorMax(e.target.value)}
            placeholder="R$ máx"
            className="w-20 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />

          {/* Incompletos toggle */}
          <button onClick={() => setSomenteIncompletos(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition ${somenteIncompletos ? "bg-amber-500/20 border-amber-500/40 text-amber-300" : "bg-white/5 border-white/10 text-white/40 hover:text-white"}`}>
            <AlertTriangle size={11} /> Incompletos
          </button>

          <span className="text-white/30 text-xs ml-auto">{filtered.length} reg.</span>
        </div>

        {/* Smart search result label */}
        {gptResult && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20">
            <Sparkles size={11} className="text-violet-400 shrink-0" />
            <span className="text-violet-300 text-xs">{gptResult.descricao}</span>
          </div>
        )}
      </div>

      {/* Charts + Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {byMedico.length > 0 && (
          <div className="rounded-xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.04)" }}>
            <h3 className="text-white/60 text-xs font-bold uppercase tracking-wide mb-3">Receita por Médico</h3>
            <div className="space-y-3">
              {byMedico.map(m => (
                <div key={m.id}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-white/70 font-semibold truncate max-w-[150px]">{m.nome.replace(/^(Dr\.|Dra\.) /, "")}</span>
                    <span className="text-emerald-400 font-black shrink-0 ml-2">{fmt(m.total)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all"
                      style={{ width: `${(m.total / maxVal) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>

            {filtered.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <h4 className="text-white/40 text-[10px] font-bold uppercase tracking-wide mb-2">Por Forma</h4>
                <div className="space-y-1.5">
                  {FORMAS.map(f => {
                    const tot = filtered.filter(t => t.forma_pagamento === f).reduce((s, t) => s + Number(t.valor || 0), 0);
                    if (!tot) return null;
                    return (
                      <div key={f} className="flex justify-between items-center">
                        <span className={`px-2 py-0.5 rounded-full border font-black text-[9px] ${FORMA_STYLE[f]}`}>{f.toUpperCase()}</span>
                        <span className="text-white/60 font-bold text-[11px]">{fmt(tot)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div className={`rounded-xl border border-white/10 overflow-hidden ${byMedico.length > 0 ? "lg:col-span-2" : "lg:col-span-3"}`}
          style={{ background: "rgba(255,255,255,0.04)" }}>
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <h3 className="text-white/60 text-xs font-bold uppercase tracking-wide">Transações</h3>
            {busca && <span className="text-xs text-emerald-400/70">filtrado: "{busca}"</span>}
          </div>

          {loading ? (
            <div className="py-12 text-center text-white/30 text-sm">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-white/20 text-sm">Nenhuma transação encontrada</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-4 py-2.5 text-white/30 font-bold">Data</th>
                    <th className="text-left px-4 py-2.5 text-white/30 font-bold">Paciente</th>
                    <th className="text-left px-4 py-2.5 text-white/30 font-bold hidden sm:table-cell">Médico</th>
                    <th className="text-left px-4 py-2.5 text-white/30 font-bold hidden sm:table-cell">Pagamento</th>
                    <th className="text-right px-4 py-2.5 text-white/30 font-bold">Valor</th>
                    <th className="px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => (
                    <tr key={t.id} className="border-b border-white/5 hover:bg-white/[0.03] transition group">
                      <td className="px-4 py-3 text-white/50 whitespace-nowrap">{fmtDate(t.data_pagamento)}</td>
                      <td className="px-4 py-3 max-w-[130px]">
                        {t.nome_paciente ? (
                          <button onClick={() => setPaciente(t.nome_paciente)}
                            className="text-white/80 font-semibold text-xs hover:text-emerald-300 hover:underline text-left truncate max-w-full flex items-center gap-1 group">
                            <span className="truncate">{t.nome_paciente}</span>
                            <ChevronRight size={10} className="shrink-0 opacity-0 group-hover:opacity-100 text-emerald-400" />
                          </button>
                        ) : <span className="text-white/30 text-xs">—</span>}
                        {t.observacoes && <span className="block text-white/30 text-[10px] font-normal truncate">{t.observacoes}</span>}
                      </td>
                      <td className="px-4 py-3 text-white/50 hidden sm:table-cell max-w-[140px] truncate">
                        {(t.medico_nome || "—").replace(/^(Dr\.|Dra\.) /, "")}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {t.forma_pagamento ? (
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${FORMA_STYLE[t.forma_pagamento] || "bg-white/10 text-white/50 border-white/20"}`}>
                            {t.forma_pagamento.toUpperCase()}
                            {t.bandeira   ? ` · ${t.bandeira}` : ""}
                            {t.parcelas > 1 ? ` ${t.parcelas}x` : ""}
                          </span>
                        ) : "—"}
                        {t.registrado_por === "importacao" && <span className="ml-1.5 text-[9px] text-white/20 font-bold">import</span>}
                        {t.registrado_por === "manual"     && <span className="ml-1.5 text-[9px] text-white/20 font-bold">manual</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-400 font-black whitespace-nowrap">{fmt(Number(t.valor))}</td>
                      <td className="px-2 py-3">
                        <button onClick={() => handleDelete(t.id)} disabled={deletingId === t.id}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-rose-500/20 text-white/30 hover:text-rose-400 transition disabled:opacity-30"
                          title="Excluir">
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-white/10 bg-white/[0.02]">
                    <td colSpan={3} className="px-4 py-3 text-white/40 text-xs font-bold">TOTAL</td>
                    <td className="hidden sm:table-cell" />
                    <td className="px-4 py-3 text-right text-emerald-300 font-black text-sm">{fmt(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal: Histórico do Paciente ─────────────────────────────────────── */}
      {paciente && (
        <PatientHistoryModal
          nomePaciente={paciente}
          todasTransacoes={transacoes}
          medicos={medicos}
          currentUser={{ nome: "Secretária" }}
          onClose={() => setPaciente(null)}
        />
      )}

      {/* ── Modal: Novo Lançamento Manual ─────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 shadow-2xl" style={{ background: "rgba(14,26,70,0.98)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                  <Plus size={15} className="text-white" />
                </div>
                <div>
                  <p className="text-white font-black text-sm">Novo Lançamento</p>
                  <p className="text-white/40 text-[10px]">Registrar pagamento manualmente</p>
                </div>
              </div>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition"><X size={16} /></button>
            </div>

            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Paciente</label>
                  <input value={form.nome_paciente} onChange={e => handleFormChange("nome_paciente", e.target.value)}
                    placeholder="Nome do paciente"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Médico</label>
                  <select value={form.medico_id} onChange={e => handleFormChange("medico_id", e.target.value)}
                    style={{ colorScheme: 'dark' }}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40">
                    <option value="">Selecionar...</option>
                    {medicos.map(m => <option key={m.id} value={m.id}>{m.nome.replace(/^(Dr\.|Dra\.) /, "")}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Valor (R$)</label>
                  <input type="number" min="0" step="0.01" value={form.valor} onChange={e => handleFormChange("valor", e.target.value)}
                    placeholder="0,00"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Data</label>
                  <input type="date" value={form.data_pagamento} onChange={e => handleFormChange("data_pagamento", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Forma</label>
                  <select value={form.forma_pagamento} onChange={e => handleFormChange("forma_pagamento", e.target.value)}
                    style={{ colorScheme: 'dark' }}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40">
                    {FORMAS.map(f => <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
                  </select>
                </div>
                {showBandeira && (
                  <div>
                    <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Bandeira</label>
                    <input value={form.bandeira} onChange={e => handleFormChange("bandeira", e.target.value)}
                      placeholder="Visa, Elo..."
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                  </div>
                )}
                {(form.forma_pagamento === "crédito" || form.forma_pagamento === "débito") && (
                  <div>
                    <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">
                      Parcelas
                      {parseValor(form.valor) && parseInt(form.parcelas) > 1 && (
                        <span className="ml-2 text-violet-300 normal-case font-black">
                          = {fmt(parseValor(form.valor)! / parseInt(form.parcelas))}/parcela
                        </span>
                      )}
                    </label>
                    <select value={form.parcelas} onChange={e => handleFormChange("parcelas", e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40">
                      {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => {
                        const v = parseValor(form.valor);
                        const suffix = v && n > 1 ? ` → ${fmt(v / n)}/parcela` : "";
                        return <option key={n} value={n}>{n}x{suffix}</option>;
                      })}
                    </select>
                  </div>
                )}
              </div>

              {/* Parcelas preview */}
              {(form.forma_pagamento === "crédito" || form.forma_pagamento === "débito") && parseInt(form.parcelas) > 1 && parseValor(form.valor) && (
                (() => {
                  const totalVal = parseValor(form.valor)!;
                  const n        = parseInt(form.parcelas);
                  const mensal   = totalVal / n;
                  const base     = new Date(form.data_pagamento || new Date().toISOString().slice(0, 10));
                  return (
                    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-violet-300 text-[10px] font-black uppercase tracking-wide">Parcelamento</span>
                        <span className="text-violet-300 font-black text-sm">{n}x de {fmt(mensal)}</span>
                      </div>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {Array.from({ length: n }, (_, i) => {
                          const d = new Date(base);
                          d.setMonth(d.getMonth() + i);
                          return (
                            <div key={i} className="flex items-center justify-between text-[10px]">
                              <span className={`font-bold ${i === 0 ? "text-white/70" : "text-white/40"}`}>
                                {i + 1}ª parcela — {d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" })}
                              </span>
                              <span className={`font-black ${i === 0 ? "text-emerald-400" : "text-white/40"}`}>{fmt(mensal)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()
              )}

              <div>
                <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Observações</label>
                <input value={form.observacoes} onChange={e => handleFormChange("observacoes", e.target.value)}
                  placeholder="Tipo de consulta, convênio, etc."
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
              </div>
            </div>

            <div className="flex gap-2 px-5 pb-5">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/50 hover:text-white hover:bg-white/5 text-xs font-bold transition">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving || !form.valor}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition shadow-lg shadow-emerald-500/30 disabled:opacity-50">
                {saving ? "Salvando..." : "Salvar Lançamento"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Importar Excel ──────────────────────────────────────────────── */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 shadow-2xl flex flex-col max-h-[90vh]" style={{ background: "rgba(14,26,70,0.98)" }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
                  <FileSpreadsheet size={15} className="text-white" />
                </div>
                <div>
                  <p className="text-white font-black text-sm">Importar Planilha</p>
                  <p className="text-white/40 text-[10px]">{importRows.length} linhas encontradas</p>
                </div>
              </div>
              <button onClick={() => setShowImport(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition"><X size={16} /></button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4">

              {/* Result feedback */}
              {importResult && (
                <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border ${importResult.err === 0 ? "bg-emerald-500/10 border-emerald-500/30" : "bg-rose-500/10 border-rose-500/30"}`}>
                  {importResult.err === 0
                    ? <><CheckCircle size={16} className="text-emerald-400 shrink-0" /><span className="text-emerald-300 text-sm font-bold">{importResult.ok} lançamentos importados com sucesso!</span></>
                    : <><AlertCircle size={16} className="text-rose-400 shrink-0" /><span className="text-rose-300 text-sm font-bold">Erro ao importar. Verifique os dados.</span></>
                  }
                </div>
              )}

              {/* Sheet selector */}
              {importSheets.length > 1 && (
                <div className="space-y-2">
                  <p className="text-white/60 text-xs font-bold uppercase tracking-wide">Aba da Planilha</p>
                  <div className="flex items-center gap-3 flex-wrap">
                    <select
                      value={selectedSheet}
                      onChange={e => handleSheetChange(e.target.value)}
                      disabled={importAllDoctors}
                      style={{ colorScheme: 'dark' }}
                      className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none disabled:opacity-40"
                    >
                      {importSheets.map(s => (
                        <option key={s} value={s}>{s} ({allSheetData[s]?.length ?? 0} linhas)</option>
                      ))}
                    </select>
                    {importSheets.filter(s => !NON_DOCTOR_SHEETS.includes(s)).length > 1 && (
                      <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={importAllDoctors}
                          onChange={e => setImportAllDoctors(e.target.checked)}
                          className="rounded"
                        />
                        Importar TODAS as abas de médico (usa nome da aba como médico)
                      </label>
                    )}
                  </div>
                  {importAllDoctors && (
                    <p className="text-sky-400/70 text-[11px]">
                      {importSheets.filter(s => !NON_DOCTOR_SHEETS.includes(s)).length} abas serão importadas:{" "}
                      {importSheets.filter(s => !NON_DOCTOR_SHEETS.includes(s)).join(", ")}
                    </p>
                  )}
                </div>
              )}

              {/* Date format */}
              <div className="space-y-2">
                <p className="text-white/60 text-xs font-bold uppercase tracking-wide">Formato de Data</p>
                <div className="flex gap-4 flex-wrap">
                  {([["mdy", "MM/DD/AA (padrão desta planilha)"], ["dmy", "DD/MM/AA"], ["auto", "Auto-detectar"]] as const).map(([v, label]) => (
                    <label key={v} className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer select-none">
                      <input
                        type="radio"
                        name="datefmt"
                        value={v}
                        checked={dateFormat === v}
                        onChange={() => setDateFormat(v)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Column mapping */}
              {!importAllDoctors && (
              <div>
                <p className="text-white/60 text-xs font-bold uppercase tracking-wide mb-3">Mapeamento de Colunas</p>
                <div className="grid grid-cols-2 gap-2">
                  {DB_FIELDS.map(f => (
                    <div key={f.key} className="flex items-center gap-2">
                      <label className="text-white/50 text-[11px] font-semibold w-32 shrink-0">
                        {f.label}{f.required && <span className="text-rose-400 ml-0.5">*</span>}
                      </label>
                      <select
                        value={colMap[f.key] || ""}
                        onChange={e => setColMap(m => ({ ...m, [f.key]: e.target.value }))}
                        style={{ colorScheme: 'dark' }}
                        className="flex-1 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-500/40"
                      >
                        <option value="">— ignorar —</option>
                        {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              )}

              {/* Preview */}
              <div>
                <p className="text-white/60 text-xs font-bold uppercase tracking-wide mb-2">Prévia (primeiras {previewRows.length} linhas)</p>
                <div className="rounded-xl border border-white/10 overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th className="text-left px-3 py-2 text-white/30 font-bold">Data</th>
                        <th className="text-left px-3 py-2 text-white/30 font-bold">Paciente</th>
                        <th className="text-left px-3 py-2 text-white/30 font-bold">Médico</th>
                        <th className="text-left px-3 py-2 text-white/30 font-bold">Forma</th>
                        <th className="text-right px-3 py-2 text-white/30 font-bold">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="px-3 py-2 text-white/40">{r.data_pagamento || "—"}</td>
                          <td className="px-3 py-2 text-white/70 max-w-[120px] truncate">{r.nome_paciente || "—"}</td>
                          <td className="px-3 py-2 text-white/50 max-w-[120px] truncate">{r.medico_nome || "—"}</td>
                          <td className="px-3 py-2 text-white/50">{r.forma_pagamento || "—"}</td>
                          <td className="px-3 py-2 text-right text-emerald-400 font-black">
                            {r.valor != null ? fmt(r.valor) : <span className="text-rose-400">?</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-2 px-5 pb-5 pt-3 border-t border-white/10 shrink-0">
              <button onClick={() => setShowImport(false)}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/50 hover:text-white hover:bg-white/5 text-xs font-bold transition">
                {importResult?.err === 0 ? "Fechar" : "Cancelar"}
              </button>
              {!importResult?.err && importResult?.ok == null && (
                <button
                  onClick={handleImport}
                  disabled={importing || (!importAllDoctors && !colMap.valor)}
                  className="flex-1 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-black transition shadow-lg shadow-sky-500/30 disabled:opacity-50"
                >
                  {importing ? "Importando..." : importAllDoctors
                    ? `Importar todas as abas (${importSheets.filter(s => !NON_DOCTOR_SHEETS.includes(s)).reduce((n, s) => n + (allSheetData[s]?.length ?? 0), 0)} registros)`
                    : `Importar ${importRows.length} registros`}
                </button>
              )}
              {importResult?.ok != null && importResult.err === 0 && (
                <button onClick={() => { setShowImport(false); setImportResult(null); }}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition">
                  Concluído ✓
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
