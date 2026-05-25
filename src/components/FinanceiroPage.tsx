import { useEffect, useRef, useState } from "react";
import { DollarSign, CreditCard, TrendingUp, Receipt, Plus, Search, Download, Trash2, X, Upload, FileSpreadsheet, CheckCircle, AlertCircle, FileText, ChevronRight, AlertTriangle, Printer, Send, Pencil, BarChart2, CheckSquare, Square, Tag } from "lucide-react";
import { fetchFinanceiro, fetchMedicos, insertFinanceiro, updateFinanceiro, deleteFinanceiro, bulkInsertFinanceiro, bulkDeleteFinanceiro, markPagoFinanceiro, fetchNotasFiscais, uploadNotaFiscal, getNotaFiscalUrl, deleteNotaFiscal, fetchAgendamentosPendentes, sendDirectWhatsApp } from "../lib/api";

function fmt(val: number) {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

const FORMAS = ["crédito", "débito", "pix", "dinheiro"];
const TIPOS  = ["consulta", "retorno", "avaliação", "exame", "procedimento", "outro"];
const FORMA_STYLE: Record<string, string> = {
  crédito:  "bg-violet-500/20 text-violet-300 border-violet-500/30",
  débito:   "bg-sky-500/20 text-sky-300 border-sky-500/30",
  pix:      "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  dinheiro: "bg-amber-500/20 text-amber-300 border-amber-500/30",
};
const TIPO_STYLE: Record<string, string> = {
  consulta:     "bg-blue-500/20 text-blue-300 border-blue-500/30",
  retorno:      "bg-teal-500/20 text-teal-300 border-teal-500/30",
  "avaliação":  "bg-purple-500/20 text-purple-300 border-purple-500/30",
  exame:        "bg-amber-500/20 text-amber-300 border-amber-500/30",
  procedimento: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  outro:        "bg-white/10 text-white/40 border-white/15",
};
const EMPTY_FORM = {
  nome_paciente: "", cpf_paciente: "", medico_id: "", medico_nome: "",
  valor: "", forma_pagamento: "pix", bandeira: "", banco: "",
  parcelas: "1", tipo_servico: "consulta",
  data_venda: new Date().toISOString().slice(0, 10),
  data_pagamento: new Date().toISOString().slice(0, 10),
  observacoes: "", taxa_cartao: "", taxas_diversas: "",
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

// ── KPI Report Generator ──────────────────────────────────────────────────────

function generateKPIHtml(opts: {
  txs:        any[];
  despesaIds: Set<string>;
  medicoNome: string;
  periodo:    string;
  clinicaNome: string;
}): string {
  const { txs, despesaIds, medicoNome, periodo, clinicaNome } = opts;

  const receitas  = txs.filter(t => !despesaIds.has(t.id));
  const despesas  = txs.filter(t =>  despesaIds.has(t.id));

  const totalBruto    = receitas.reduce((s, t) => s + Number(t.valor || 0), 0);
  const totalDespesas = despesas.reduce((s, t) => s + Number(t.valor || 0), 0);
  const totalDeducoes = receitas.reduce((s, t) => {
    const b = Number(t.valor || 0);
    return s + b * (Number(t.taxa_cartao || 0) / 100) + Number(t.taxas_diversas || 0);
  }, 0);
  const totalLiq   = totalBruto - totalDeducoes - totalDespesas;
  const ticket     = receitas.length > 0 ? totalBruto / receitas.length : 0;

  const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtD   = (iso: string) => iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

  // por forma
  const formas: Record<string, number> = {};
  receitas.forEach(t => { if (t.forma_pagamento) formas[t.forma_pagamento] = (formas[t.forma_pagamento] || 0) + Number(t.valor || 0); });
  const formaEntries = Object.entries(formas).sort((a, b) => b[1] - a[1]);

  // por tipo
  const tipos: Record<string, { total: number; count: number }> = {};
  receitas.forEach(t => {
    const k = t.tipo_servico || "consulta";
    tipos[k] = tipos[k] || { total: 0, count: 0 };
    tipos[k].total += Number(t.valor || 0);
    tipos[k].count++;
  });
  const tipoEntries = Object.entries(tipos).sort((a, b) => b[1].total - a[1].total);

  const maxForma = formaEntries[0]?.[1] || 1;
  const maxTipo  = tipoEntries[0]?.[1].total || 1;

  const formaBar = formaEntries.map(([f, v]) =>
    `<div class="bar-row"><div class="bar-label">${f.toUpperCase()}</div>
     <div class="bar-track"><div class="bar-fill" style="width:${Math.round((v/maxForma)*100)}%"></div></div>
     <div class="bar-val">${fmtBRL(v)}</div></div>`).join("");

  const tipoBar = tipoEntries.map(([t, d]) =>
    `<div class="bar-row"><div class="bar-label">${t.charAt(0).toUpperCase()+t.slice(1)}</div>
     <div class="bar-track"><div class="bar-fill teal" style="width:${Math.round((d.total/maxTipo)*100)}%"></div></div>
     <div class="bar-val">${fmtBRL(d.total)} <span class="bar-count">${d.count} atend.</span></div></div>`).join("");

  const txRows = txs.map(t => {
    const isDespesa = despesaIds.has(t.id);
    const bruto     = Number(t.valor || 0);
    const taxaC     = bruto * (Number(t.taxa_cartao || 0) / 100);
    const taxaD     = Number(t.taxas_diversas || 0);
    const saida     = taxaC + taxaD;
    const final     = bruto - saida;
    return `<tr class="${isDespesa ? "row-despesa" : ""}">
      <td>${fmtD(t.data_venda || t.data_pagamento)}</td>
      <td>${t.nome_paciente || "—"}</td>
      <td>${(t.tipo_servico || "consulta").charAt(0).toUpperCase()+(t.tipo_servico||"consulta").slice(1)}</td>
      <td>${t.forma_pagamento ? t.forma_pagamento.toUpperCase()+(t.parcelas>1?` ${t.parcelas}x`:""):"—"}</td>
      <td class="num">${isDespesa ? `<span class="despesa-tag">DESPESA</span>` : ""} ${fmtBRL(bruto)}</td>
      <td class="num ${isDespesa?"despesa":""}">${isDespesa ? `(${fmtBRL(bruto)})` : (saida > 0 ? `(${fmtBRL(saida)})` : "—")}</td>
      <td class="num bold ${isDespesa?"despesa":""}">${isDespesa ? "—" : fmtBRL(final)}</td>
      <td>${t.observacoes || "—"}</td>
    </tr>`;
  }).join("");

  const gerado = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"long", year:"numeric" });

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>KPI — ${medicoNome} — ${periodo}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f4f8; color: #1a202c; }
  .page { max-width: 960px; margin: 0 auto; padding: 32px 24px; }
  /* Header */
  .header { background: linear-gradient(135deg, #0e1f4a 0%, #1a3a6e 100%); color: white; border-radius: 16px; padding: 28px 32px; margin-bottom: 24px; display:flex; justify-content:space-between; align-items:center; }
  .header-left h1 { font-size: 22px; font-weight: 900; letter-spacing: -0.5px; }
  .header-left p  { font-size: 13px; opacity: 0.6; margin-top: 4px; }
  .header-right   { text-align: right; }
  .header-right .period { font-size: 15px; font-weight: 700; color: #7dd3fc; }
  .header-right .gen    { font-size: 11px; opacity: 0.5; margin-top: 4px; }
  /* KPI Cards */
  .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 24px; }
  .kpi-card { background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .kpi-card .label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #718096; margin-bottom: 6px; }
  .kpi-card .value { font-size: 20px; font-weight: 900; color: #1a202c; line-height: 1; }
  .kpi-card .sub   { font-size: 10px; color: #a0aec0; margin-top: 4px; }
  .kpi-card.green .value { color: #059669; }
  .kpi-card.blue  .value { color: #2563eb; }
  .kpi-card.red   .value { color: #dc2626; }
  .kpi-card.purple.value { color: #7c3aed; }
  /* Sections */
  .section { background: white; border-radius: 12px; padding: 20px 24px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .section h2 { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #718096; margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
  /* Bars */
  .bar-row  { display:flex; align-items:center; gap:10px; margin-bottom: 10px; }
  .bar-label{ font-size: 11px; font-weight: 700; color: #4a5568; width: 100px; flex-shrink:0; }
  .bar-track{ flex:1; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; background: linear-gradient(90deg, #059669, #34d399); border-radius: 4px; }
  .bar-fill.teal { background: linear-gradient(90deg, #0284c7, #38bdf8); }
  .bar-val  { font-size: 12px; font-weight: 700; color: #1a202c; width: 130px; text-align:right; flex-shrink:0; }
  .bar-count{ font-size: 10px; color: #a0aec0; font-weight: 500; }
  /* DRE */
  .dre { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
  .dre-item { padding: 14px 20px; }
  .dre-item:not(:last-child) { border-right: 1px solid #e2e8f0; }
  .dre-item .dl { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #718096; margin-bottom: 6px; }
  .dre-item .dv { font-size: 22px; font-weight: 900; }
  .dre-item.green .dv { color: #059669; }
  .dre-item.red   .dv { color: #dc2626; }
  .dre-item.blue  .dv { color: #2563eb; }
  /* Table */
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f7fafc; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; color: #718096; padding: 10px 12px; text-align: left; border-bottom: 2px solid #e2e8f0; }
  td { padding: 9px 12px; border-bottom: 1px solid #f0f4f8; vertical-align: top; }
  tr:hover td { background: #f7fafc; }
  td.num   { text-align: right; font-variant-numeric: tabular-nums; }
  td.bold  { font-weight: 700; }
  td.despesa { color: #dc2626; }
  tr.row-despesa td { background: #fff5f5; }
  .despesa-tag { display:inline-block; font-size:8px; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; background:#fee2e2; color:#dc2626; border-radius:3px; padding:1px 4px; margin-right:4px; vertical-align:middle; }
  /* Footer */
  .footer { text-align: center; color: #a0aec0; font-size: 11px; margin-top: 28px; padding-top: 16px; border-top: 1px solid #e2e8f0; }
  .no-print { display:flex; gap:10px; justify-content:flex-end; margin-bottom:20px; }
  .btn { padding: 9px 20px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; border: none; }
  .btn-primary { background: #059669; color: white; }
  .btn-secondary { background: #e2e8f0; color: #4a5568; }
  @media print {
    body { background: white; }
    .page { padding: 0; max-width: 100%; }
    .no-print { display: none; }
    .header { border-radius: 0; }
    .section, .kpi-card { box-shadow: none; border: 1px solid #e2e8f0; }
  }
</style></head><body>
<div class="page">
  <div class="no-print">
    <button class="btn btn-secondary" onclick="window.close()">Fechar</button>
    <button class="btn btn-primary" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
  </div>

  <div class="header">
    <div class="header-left">
      <h1>${clinicaNome}</h1>
      <p>Relatório de Desempenho — ${medicoNome || "Todos os Médicos"}</p>
    </div>
    <div class="header-right">
      <div class="period">📅 ${periodo}</div>
      <div class="gen">Gerado em ${gerado}</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card green"><div class="label">Receita Bruta</div><div class="value">${fmtBRL(totalBruto)}</div><div class="sub">${receitas.length} atendimentos</div></div>
    <div class="kpi-card red"><div class="label">Deduções</div><div class="value">${fmtBRL(totalDeducoes)}</div><div class="sub">taxas cartão/outros</div></div>
    <div class="kpi-card red"><div class="label">Despesas</div><div class="value">${fmtBRL(totalDespesas)}</div><div class="sub">${despesas.length} lançamentos</div></div>
    <div class="kpi-card blue"><div class="label">Receita Líquida</div><div class="value">${fmtBRL(totalLiq)}</div><div class="sub">após deduções e despesas</div></div>
    <div class="kpi-card purple"><div class="label">Ticket Médio</div><div class="value">${fmtBRL(ticket)}</div><div class="sub">por atendimento</div></div>
  </div>

  <div class="section" style="margin-bottom:20px">
    <h2>DRE — Demonstrativo de Resultado</h2>
    <div class="dre">
      <div class="dre-item green"><div class="dl">(+) Receita Bruta</div><div class="dv">${fmtBRL(totalBruto)}</div></div>
      <div class="dre-item red"><div class="dl">(−) Deduções + Despesas</div><div class="dv">${fmtBRL(totalDeducoes + totalDespesas)}</div></div>
      <div class="dre-item blue"><div class="dl">(=) Resultado Líquido</div><div class="dv">${fmtBRL(totalLiq)}</div></div>
    </div>
  </div>

  <div class="two-col">
    <div class="section">
      <h2>Por Forma de Pagamento</h2>
      ${formaBar || "<p style='color:#a0aec0;font-size:12px'>Sem dados</p>"}
    </div>
    <div class="section">
      <h2>Por Tipo de Serviço</h2>
      ${tipoBar || "<p style='color:#a0aec0;font-size:12px'>Sem dados</p>"}
    </div>
  </div>

  <div class="section">
    <h2>Lançamentos — ${txs.length} registros selecionados</h2>
    <table>
      <thead>
        <tr><th>Data</th><th>Paciente</th><th>Tipo</th><th>Forma / Parcelas</th><th style="text-align:right">Vlr Entrada</th><th style="text-align:right">Deduções</th><th style="text-align:right">Vlr Final</th><th>Observações</th></tr>
      </thead>
      <tbody>${txRows}</tbody>
    </table>
  </div>

  <div class="footer">
    Relatório gerado pelo ProNutro CRM · ${clinicaNome} · ${gerado}<br>
    Este documento é confidencial e destinado exclusivamente ao profissional indicado.
  </div>
</div>
</body></html>`;
}

// ── KPIExportModal ────────────────────────────────────────────────────────────

function KPIExportModal({ txs, medicos, onClose }: {
  txs:     any[];
  medicos: any[];
  onClose: () => void;
}) {
  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10);

  const [despesaIds,   setDespesaIds]   = useState<Set<string>>(new Set());
  const [medicoFiltro, setMedicoFiltro] = useState("");
  const [clinicaNome,  setClinicaNome]  = useState("ProNutro Clínica");

  // Período por pickers
  const [dataFrom, setDataFrom] = useState(() => {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return d.toISOString().slice(0, 10);
  });
  const [dataTo, setDataTo] = useState(todayISO);
  const [presetAtivo, setPresetAtivo] = useState("mes_atual");

  const PRESETS = [
    { key: "mes_atual",    label: "Este mês" },
    { key: "mes_anterior", label: "Mês ant." },
    { key: "trim",         label: "Trimestre" },
    { key: "ano_atual",    label: "Ano" },
    { key: "custom",       label: "Personalizado" },
  ];

  function applyPreset(key: string) {
    setPresetAtivo(key);
    const n = new Date();
    if (key === "mes_atual") {
      setDataFrom(new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10));
      setDataTo(new Date(n.getFullYear(), n.getMonth() + 1, 0).toISOString().slice(0, 10));
    } else if (key === "mes_anterior") {
      setDataFrom(new Date(n.getFullYear(), n.getMonth() - 1, 1).toISOString().slice(0, 10));
      setDataTo(new Date(n.getFullYear(), n.getMonth(), 0).toISOString().slice(0, 10));
    } else if (key === "trim") {
      setDataFrom(new Date(n.getFullYear(), n.getMonth() - 2, 1).toISOString().slice(0, 10));
      setDataTo(new Date(n.getFullYear(), n.getMonth() + 1, 0).toISOString().slice(0, 10));
    } else if (key === "ano_atual") {
      setDataFrom(`${n.getFullYear()}-01-01`);
      setDataTo(`${n.getFullYear()}-12-31`);
    }
    // "custom" → não mexe nas datas, só mostra os pickers
  }

  // Rótulo legível do período
  const periodoLabel = (() => {
    const f = new Date(dataFrom + "T12:00:00");
    const t = new Date(dataTo   + "T12:00:00");
    const fStr = f.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
    const tStr = t.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
    return fStr === tStr ? fStr : `${fStr} – ${tStr}`;
  })();

  const medicoNome = medicoFiltro
    ? (medicos.find(m => m.id === medicoFiltro)?.nome || "")
    : "Todos os Médicos";

  // Filtra por médico E por período selecionado
  const displayTxs = txs.filter(t => {
    const date = t.data_venda || t.data_pagamento;
    if (date) {
      const d = date.slice(0, 10);
      if (d < dataFrom || d > dataTo) return false;
    }
    if (medicoFiltro) {
      const med = medicos.find(m => m.id === medicoFiltro);
      const baseName = (med?.nome || "").split(" ")[1]?.toLowerCase() || "";
      return t.medico_id === medicoFiltro || (baseName && (t.medico_nome || "").toLowerCase().includes(baseName));
    }
    return true;
  });

  const totalBruto    = displayTxs.filter(t => !despesaIds.has(t.id)).reduce((s, t) => s + Number(t.valor || 0), 0);
  const totalDespesas = displayTxs.filter(t =>  despesaIds.has(t.id)).reduce((s, t) => s + Number(t.valor || 0), 0);

  function toggleDespesa(id: string) {
    setDespesaIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleGenerate() {
    const html = generateKPIHtml({ txs: displayTxs, despesaIds, medicoNome, periodo: periodoLabel, clinicaNome });
    const win  = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}>
      <div className="w-full sm:max-w-2xl max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
        style={{ background: "rgba(10,20,60,0.98)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <BarChart2 size={16} className="text-white" />
            </div>
            <div>
              <p className="text-white font-black text-sm">Exportar KPI</p>
              <p className="text-violet-300/70 text-[10px] font-semibold">{periodoLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {/* ── Período ── */}
          <div className="rounded-xl border border-white/8 p-4 space-y-3" style={{ background: "rgba(255,255,255,0.03)" }}>
            <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block">Período do Relatório</label>

            {/* Presets */}
            <div className="flex gap-1.5 flex-wrap">
              {PRESETS.map(p => (
                <button key={p.key} onClick={() => applyPreset(p.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                    presetAtivo === p.key
                      ? "bg-violet-600 border-violet-500 text-white"
                      : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10"
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>

            {/* Date pickers — sempre visíveis */}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-white/30 text-[9px] font-bold uppercase tracking-wide block mb-1">De</label>
                <input type="date" value={dataFrom}
                  onChange={e => { setDataFrom(e.target.value); setPresetAtivo("custom"); }}
                  style={{ colorScheme: "dark" }}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-violet-500/40" />
              </div>
              <span className="text-white/25 text-sm mt-4">→</span>
              <div className="flex-1">
                <label className="text-white/30 text-[9px] font-bold uppercase tracking-wide block mb-1">Até</label>
                <input type="date" value={dataTo}
                  onChange={e => { setDataTo(e.target.value); setPresetAtivo("custom"); }}
                  style={{ colorScheme: "dark" }}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-violet-500/40" />
              </div>
              <div className="mt-4 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[10px] font-bold whitespace-nowrap">
                {displayTxs.length} reg.
              </div>
            </div>

            {/* Rótulo resultante */}
            <p className="text-white/30 text-[10px]">Título no relatório: <span className="text-violet-300 font-bold">{periodoLabel}</span></p>
          </div>

          {/* Médico + Clínica */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Médico no Relatório</label>
              <select value={medicoFiltro} onChange={e => setMedicoFiltro(e.target.value)}
                style={{ colorScheme: "dark" }}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-violet-500/40">
                <option value="">Todos os Médicos</option>
                {medicos.map(m => <option key={m.id} value={m.id}>{m.nome.replace(/^(Dr\.|Dra\.) /, "")}</option>)}
              </select>
            </div>
            <div>
              <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Nome da Clínica</label>
              <input value={clinicaNome} onChange={e => setClinicaNome(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-violet-500/40" />
            </div>
          </div>

          {/* Preview KPIs */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Receita (selecionados)", value: totalBruto, color: "text-emerald-400" },
              { label: "Despesas marcadas",      value: totalDespesas, color: "text-rose-400" },
              { label: "Resultado Líquido",      value: totalBruto - totalDespesas, color: "text-sky-300" },
            ].map(c => (
              <div key={c.label} className="rounded-xl border border-white/8 p-3 text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
                <p className={`font-black text-base ${c.color}`}>{c.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
                <p className="text-white/30 text-[9px] font-bold uppercase mt-1">{c.label}</p>
              </div>
            ))}
          </div>

          {/* Lista de lançamentos com toggle despesa */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-wide">
                Lançamentos — marque as despesas para destacá-las no relatório
              </p>
              {despesaIds.size > 0 && (
                <button onClick={() => setDespesaIds(new Set())}
                  className="text-white/30 hover:text-white/60 text-[10px] transition">
                  Limpar marcações
                </button>
              )}
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
              {displayTxs.map(t => {
                const isDespesa = despesaIds.has(t.id);
                return (
                  <div key={t.id}
                    onClick={() => toggleDespesa(t.id)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition ${
                      isDespesa
                        ? "border-rose-500/30 bg-rose-500/8"
                        : "border-white/8 bg-white/3 hover:bg-white/6"
                    }`}>
                    <div className={`shrink-0 w-4 h-4 rounded flex items-center justify-center border transition ${isDespesa ? "bg-rose-500/30 border-rose-500/50" : "border-white/20"}`}>
                      {isDespesa && <Tag size={9} className="text-rose-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white/70 text-xs font-semibold truncate">{t.nome_paciente || "—"}</span>
                        {isDespesa && <span className="text-[9px] font-black text-rose-400 bg-rose-500/15 px-1.5 py-0.5 rounded-full border border-rose-500/25">DESPESA</span>}
                      </div>
                      <p className="text-white/30 text-[10px]">
                        {t.data_pagamento ? new Date(t.data_pagamento).toLocaleDateString("pt-BR") : "—"}
                        {t.observacoes ? ` · ${t.observacoes}` : ""}
                        {t.forma_pagamento ? ` · ${t.forma_pagamento}` : ""}
                      </p>
                    </div>
                    <span className={`font-black text-xs shrink-0 ${isDespesa ? "text-rose-400" : "text-emerald-400"}`}>
                      {Number(t.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </span>
                  </div>
                );
              })}
              {displayTxs.length === 0 && (
                <p className="text-white/20 text-xs text-center py-6">Nenhum lançamento encontrado para este médico</p>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 py-4 border-t border-white/10 flex gap-2 shrink-0">
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-white/10 text-white/50 hover:text-white hover:bg-white/5 text-xs font-bold transition">
            Cancelar
          </button>
          <button onClick={handleGenerate} disabled={displayTxs.length === 0}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-black transition shadow-lg shadow-violet-500/30 disabled:opacity-40">
            <BarChart2 size={13} /> Gerar Relatório KPI
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtFileSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ── PatientHistoryModal ───────────────────────────────────────────────────────

function PatientHistoryModal({ nomePaciente, todasTransacoes, medicos, currentUser, onClose, onEditTx, onDeleteTx }: {
  nomePaciente: string;
  todasTransacoes: any[];
  medicos: any[];
  currentUser: any;
  onClose: () => void;
  onEditTx?: (tx: any) => void;
  onDeleteTx?: (id: string) => Promise<void>;
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
                  <div key={t.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/5 hover:border-white/10 transition" style={{ background: "rgba(255,255,255,0.03)" }}>
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
                    {(onEditTx || onDeleteTx) && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                        {onEditTx && (
                          <button onClick={() => { onEditTx(t); onClose(); }}
                            className="p-1 rounded-lg hover:bg-amber-500/20 text-white/20 hover:text-amber-400 transition" title="Editar">
                            <Pencil size={12} />
                          </button>
                        )}
                        {onDeleteTx && (
                          <button onClick={() => onDeleteTx(t.id)}
                            className="p-1 rounded-lg hover:bg-rose-500/20 text-white/20 hover:text-rose-400 transition" title="Excluir">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    )}
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

// ── ReciboModal ───────────────────────────────────────────────────────────────

function gerarHTMLRecibo(tx: any): string {
  const data = tx.data_pagamento ? new Date(tx.data_pagamento).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : "—";
  const valor = Number(tx.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const forma = tx.forma_pagamento ? tx.forma_pagamento.charAt(0).toUpperCase() + tx.forma_pagamento.slice(1) : "—";
  const num = (tx.id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Recibo #${num}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; color: #222; }
  h1 { font-size: 20px; text-align: center; margin: 0; letter-spacing: 2px; }
  .sub { text-align: center; font-size: 12px; color: #666; margin-bottom: 24px; }
  .divider { border-top: 2px solid #000; margin: 16px 0; }
  .thin { border-top: 1px solid #ccc; margin: 12px 0; }
  .num { text-align: right; font-size: 11px; color: #888; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  td { padding: 7px 0; vertical-align: top; }
  td:first-child { color: #555; font-size: 12px; width: 38%; }
  td:last-child { font-weight: bold; font-size: 13px; }
  .valor-total { text-align: right; font-size: 22px; font-weight: bold; margin: 8px 0; }
  .extenso { text-align: right; font-size: 11px; color: #555; }
  .ass { margin-top: 60px; text-align: center; }
  .ass-line { border-top: 1px solid #000; display: inline-block; width: 300px; padding-top: 6px; font-size: 12px; }
  .footer { margin-top: 40px; font-size: 10px; color: #aaa; text-align: center; }
  @media print { body { margin: 0; } }
</style></head><body>
<h1>PRONUTRO CLÍNICA</h1>
<p class="sub">Nutrição Esportiva e Clínica · Brasília-DF</p>
<div class="divider"></div>
<p class="num">RECIBO Nº ${num}</p>
<table>
  <tr><td>Paciente</td><td>${tx.nome_paciente || "—"}</td></tr>
  <tr><td>Profissional</td><td>${(tx.medico_nome || "—").replace(/^(Dr\.|Dra\.) /, "")}</td></tr>
  <tr><td>Serviço</td><td>Consulta de Nutrição</td></tr>
  <tr><td>Data</td><td>${data}</td></tr>
  <tr><td>Forma de pagamento</td><td>${forma}${tx.bandeira ? " · " + tx.bandeira : ""}${tx.parcelas > 1 ? " · " + tx.parcelas + "x" : ""}</td></tr>
  ${tx.observacoes ? `<tr><td>Observações</td><td>${tx.observacoes}</td></tr>` : ""}
</table>
<div class="divider"></div>
<p class="valor-total">${valor}</p>
<div class="thin"></div>
<div class="ass">
  <span class="ass-line">Assinatura / Carimbo</span>
</div>
<p class="footer">Emitido em ${new Date().toLocaleDateString("pt-BR")} · Este recibo tem validade legal como comprovante de pagamento.</p>
</body></html>`;
}

function buildReciboText(tx: any): string {
  const data  = tx.data_pagamento ? new Date(tx.data_pagamento).toLocaleDateString("pt-BR") : "—";
  const valor = Number(tx.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const num   = (tx.id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
  return `*RECIBO DE PAGAMENTO - ProNutro*\n\n` +
    `Nº: ${num}\n` +
    `Paciente: ${tx.nome_paciente || "—"}\n` +
    `Profissional: ${(tx.medico_nome || "—").replace(/^(Dr\.|Dra\.) /,"")}\n` +
    `Serviço: Consulta de Nutrição\n` +
    `Data: ${data}\n` +
    `Forma: ${tx.forma_pagamento || "—"}${tx.bandeira ? " · " + tx.bandeira : ""}${tx.parcelas > 1 ? " · " + tx.parcelas + "x" : ""}\n` +
    `*Valor: ${valor}*\n\n` +
    `_Este comprovante confirma o recebimento do pagamento._`;
}

function ReciboModal({ tx, onClose }: { tx: any; onClose: () => void }) {
  const [phone, setPhone] = useState("");

  function handlePrint() {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(gerarHTMLRecibo(tx));
    win.document.close();
    win.focus();
    win.print();
  }

  function handleWhatsApp() {
    const p = phone.replace(/\D/g, "");
    if (p.length < 10) return alert("Informe o número com DDD e código do país.\nEx: 5561999998888");
    const text = buildReciboText(tx);
    window.open(`https://wa.me/${p}?text=${encodeURIComponent(text)}`, "_blank");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 shadow-2xl" style={{ background: "rgba(10,20,60,0.98)" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-sky-400" />
            <p className="text-white font-black text-sm">Emitir Recibo</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition"><X size={15} className="text-white/40" /></button>
        </div>

        {/* Preview */}
        <div className="mx-5 my-4 rounded-xl border border-white/10 p-4 space-y-2" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div className="text-center pb-3 border-b border-white/10">
            <p className="text-white font-black text-sm tracking-widest">PRONUTRO CLÍNICA</p>
            <p className="text-white/40 text-[10px]">Nutrição Esportiva e Clínica · Brasília-DF</p>
          </div>
          <p className="text-white/30 text-[10px] text-right">Recibo Nº {(tx.id || "").replace(/-/g, "").slice(0, 8).toUpperCase()}</p>
          {[
            ["Paciente",     tx.nome_paciente || "—"],
            ["Profissional", (tx.medico_nome || "—").replace(/^(Dr\.|Dra\.) /,"")],
            ["Serviço",      "Consulta de Nutrição"],
            ["Data",         tx.data_pagamento ? new Date(tx.data_pagamento).toLocaleDateString("pt-BR") : "—"],
            ["Pagamento",    `${tx.forma_pagamento || "—"}${tx.bandeira ? " · "+tx.bandeira : ""}${tx.parcelas > 1 ? " · "+tx.parcelas+"x" : ""}`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between text-xs">
              <span className="text-white/40">{k}</span>
              <span className="text-white/80 font-semibold text-right max-w-[60%]">{v}</span>
            </div>
          ))}
          <div className="pt-3 border-t border-white/10 text-right">
            <p className="text-emerald-400 font-black text-xl">{Number(tx.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
          </div>
        </div>

        {/* WhatsApp — abre wa.me com texto pronto */}
        <div className="px-5 pb-2 space-y-2">
          <p className="text-white/40 text-[10px] font-bold">ENVIAR RECIBO POR WHATSAPP</p>
          <div className="flex gap-2">
            <input
              value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="5561999998888  (55 + DDD + número)"
              className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-mono placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            />
            <button
              onClick={handleWhatsApp}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition shadow-lg shadow-emerald-500/30"
            >
              <Send size={12} /> Abrir WhatsApp
            </button>
          </div>
          <p className="text-white/20 text-[10px]">Abre o WhatsApp com o recibo pronto para enviar — basta clicar em enviar lá.</p>
        </div>

        {/* Actions */}
        <div className="px-5 py-4 flex gap-2">
          <button onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-black transition shadow-lg shadow-sky-500/30">
            <Printer size={13} /> Imprimir / Salvar PDF
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 text-xs font-bold transition">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

type PeriodoMode = "mes_atual" | "mes_anterior" | "ano_atual" | "90dias" | "mes_especifico" | "intervalo" | "tudo";

export default function FinanceiroPage({ initialPaciente }: { initialPaciente?: string | null } = {}) {
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
  const [gptResult, setGptResult]       = useState<ReturnType<typeof parseSmartQuery> | null>(null);
  const [pendentes, setPendentes]       = useState<any[]>([]);
  const [showPendentes, setShowPendentes] = useState(false);
  const [loading, setLoading]           = useState(true);

  // Manual entry modal
  const [showModal, setShowModal]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [form, setForm]             = useState({ ...EMPTY_FORM });

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Patient history modal
  const [paciente, setPaciente] = useState<string | null>(initialPaciente || null);

  // Recibo
  const [reciboTx,    setReciboTx]    = useState<any | null>(null);
  // Editing existing transaction
  const [editingTx,   setEditingTx]   = useState<any | null>(null);
  // KPI Export selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showKpiExport, setShowKpiExport] = useState(false);
  const [togglingPagoId, setTogglingPagoId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

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
  useEffect(() => { fetchAgendamentosPendentes().then(setPendentes); }, []);

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
      // Strip separators → digits only → numeric search if ≥ 2 digits and no letters
      const digits = textSearch.replace(/[.,\s]/g, "");
      const isNumericSearch = digits.length >= 2 && /^\d+$/.test(digits);

      result = result.filter(t => {
        if (norm(t.nome_paciente   || "").includes(q)) return true;
        if (norm(t.medico_nome     || "").includes(q)) return true;
        if (norm(t.observacoes     || "").includes(q)) return true;
        if (norm(t.forma_pagamento || "").includes(q)) return true;
        if (isNumericSearch) {
          // Compare against the integer part of valor (ex: "835" matches R$835 and R$1.835)
          const valorInt = Math.floor(Number(t.valor || 0)).toString();
          if (valorInt.includes(digits)) return true;
          // Also exact match with decimals: "83511" matches 835.11
          const valorCents = Math.round(Number(t.valor || 0) * 100).toString();
          if (valorCents === digits) return true;
        }
        return false;
      });
    }

    return result.sort((a, b) => {
      const da = a.data_pagamento ? new Date(a.data_pagamento).getTime() : 0;
      const db = b.data_pagamento ? new Date(b.data_pagamento).getTime() : 0;
      return db - da;
    });
  })();

  const total       = filtered.reduce((s, t) => s + Number(t.valor || 0), 0);
  const totalLiquido = filtered.reduce((s, t) => {
    const bruto   = Number(t.valor || 0);
    const taxaC   = bruto * (Number(t.taxa_cartao || 0) / 100);
    const taxaD   = Number(t.taxas_diversas || 0);
    return s + bruto - taxaC - taxaD;
  }, 0);
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

  const totalDeducoes = total - totalLiquido;
  const statCards = [
    { label: "Receita Bruta",    value: fmt(total),            icon: DollarSign, color: "from-emerald-500 to-teal-600",  shadow: "shadow-emerald-500/30" },
    { label: "Receita Líquida",  value: fmt(totalLiquido),     icon: TrendingUp, color: "from-sky-500 to-blue-600",      shadow: "shadow-sky-500/30"     },
    { label: "Deduções",         value: fmt(totalDeducoes),    icon: CreditCard, color: "from-rose-500 to-pink-600",     shadow: "shadow-rose-500/30"    },
    { label: "Ticket Médio",     value: fmt(ticketMedio),      icon: Receipt,    color: "from-violet-500 to-purple-600", shadow: "shadow-violet-500/30"  },
    { label: "Atendimentos",     value: filtered.length,       icon: Receipt,    color: "from-amber-500 to-orange-600",  shadow: "shadow-amber-500/30"   },
    { label: "Médicos Ativos",   value: byMedico.length,       icon: CreditCard, color: "from-indigo-500 to-blue-700",  shadow: "shadow-indigo-500/30"  },
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

  function handleEdit(tx: any) {
    setEditingTx(tx);
    setForm({
      nome_paciente:   tx.nome_paciente   || "",
      cpf_paciente:    tx.cpf_paciente    || "",
      medico_id:       tx.medico_id       || "",
      medico_nome:     tx.medico_nome     || "",
      valor:           tx.valor           ? String(tx.valor) : "",
      forma_pagamento: tx.forma_pagamento || "pix",
      bandeira:        tx.bandeira        || "",
      banco:           tx.banco           || "",
      parcelas:        tx.parcelas        ? String(tx.parcelas) : "1",
      tipo_servico:    tx.tipo_servico    || "consulta",
      data_venda:      tx.data_venda      ? String(tx.data_venda).slice(0,10) : (tx.data_pagamento ? String(tx.data_pagamento).slice(0,10) : new Date().toISOString().slice(0,10)),
      data_pagamento:  tx.data_pagamento  ? String(tx.data_pagamento).slice(0,10) : new Date().toISOString().slice(0,10),
      observacoes:     tx.observacoes     || "",
      taxa_cartao:     tx.taxa_cartao     ? String(tx.taxa_cartao) : "",
      taxas_diversas:  tx.taxas_diversas  ? String(tx.taxas_diversas) : "",
    });
    setShowModal(true);
  }

  async function handleSave() {
    const valorNum = parseValor(form.valor);
    if (!valorNum || valorNum <= 0) return alert("Informe um valor válido.");
    setSaving(true);
    const payload: any = {
      medico_id:       form.medico_id || undefined,
      nome_paciente:   form.nome_paciente || undefined,
      cpf_paciente:    form.cpf_paciente || undefined,
      medico_nome:     form.medico_nome || undefined,
      valor:           valorNum,
      forma_pagamento: form.forma_pagamento || undefined,
      bandeira:        form.bandeira || undefined,
      banco:           form.banco || undefined,
      parcelas:        parseInt(form.parcelas) || 1,
      tipo_servico:    form.tipo_servico || undefined,
      data_venda:      form.data_venda || undefined,
      data_pagamento:  form.data_pagamento ? `${form.data_pagamento}T12:00:00` : undefined,
      observacoes:     form.observacoes || undefined,
      taxa_cartao:     form.taxa_cartao ? parseFloat(form.taxa_cartao.replace(",", ".")) : null,
      taxas_diversas:  form.taxas_diversas ? parseFloat(form.taxas_diversas.replace(",", ".")) : null,
    };
    if (editingTx) {
      await updateFinanceiro(editingTx.id, payload);
    } else {
      await insertFinanceiro(payload);
    }
    setSaving(false);
    setShowModal(false);
    setEditingTx(null);
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

  async function handleTogglePago(t: any) {
    setTogglingPagoId(t.id);
    await markPagoFinanceiro(t.id, !t.pago);
    setTogglingPagoId(null);
    load();
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!confirm(`Excluir ${ids.length} lançamento${ids.length !== 1 ? "s" : ""} selecionado${ids.length !== 1 ? "s" : ""}? Essa ação não pode ser desfeita.`)) return;
    await bulkDeleteFinanceiro(ids);
    setSelectedIds(new Set());
    load();
  }

  async function handleClearAll() {
    const total = filtered.length;
    if (!total) return;
    const confirmMsg = `Apagar TODOS os ${total} lançamentos do período atual?\n\nEssa ação é permanente e não pode ser desfeita.\n\nDigite "APAGAR" para confirmar.`;
    const input = window.prompt(confirmMsg);
    if (input?.trim().toUpperCase() !== "APAGAR") return;
    setClearingAll(true);
    await bulkDeleteFinanceiro(filtered.map(t => t.id));
    setClearingAll(false);
    setSelectedIds(new Set());
    load();
  }

  // ── Export CSV ────────────────────────────────────────────────────────────

  function handleSmartSearch() {
    const q = busca.trim();
    if (!q) return;
    const parsed = parseSmartQuery(q);
    const hasSmart = parsed.valorMin != null || parsed.valorMax != null || parsed.forma || parsed.incompletos;
    if (hasSmart || parsed.mes || parsed.ano) {
      setGptResult(parsed);
      if (parsed.mes && parsed.ano) {
        setMesAno(`${parsed.ano}-${String(parsed.mes).padStart(2, "0")}`);
        setPeriodoMode("mes_especifico");
      } else if (parsed.mes) {
        setPeriodoMode("tudo");
      } else if (!parsed.mes && !parsed.ano) {
        setPeriodoMode("tudo");
      }
    }
  }

  function exportCSV() {
    const headers = [
      "Data Venda","Data Pgto","Mês","Tipo","Forma Pgto","Paciente","CPF",
      "Médico","Banco","Bandeira","Parcelas","Vlr Entrada (R$)","Vlr Saída (R$)","Vlr Final (R$)","Obs","Origem"
    ];
    const rows = filtered.map(t => {
      const bruto  = Number(t.valor || 0);
      const taxaC  = bruto * (Number(t.taxa_cartao || 0) / 100);
      const taxaD  = Number(t.taxas_diversas || 0);
      const saida  = taxaC + taxaD;
      const final  = bruto - saida;
      const mes    = t.data_pagamento ? new Date(t.data_pagamento).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "";
      return [
        t.data_venda     ? fmtDate(t.data_venda)      : (t.data_pagamento ? fmtDate(t.data_pagamento) : ""),
        t.data_pagamento ? fmtDate(t.data_pagamento)   : "",
        mes,
        t.tipo_servico   || "consulta",
        t.forma_pagamento || "",
        t.nome_paciente  || "",
        t.cpf_paciente   || "",
        t.medico_nome    || "",
        t.banco          || "",
        t.bandeira       || "",
        t.parcelas       || 1,
        bruto.toFixed(2).replace(".", ","),
        saida.toFixed(2).replace(".", ","),
        final.toFixed(2).replace(".", ","),
        (t.observacoes   || "").replace(/;/g, " "),
        t.registrado_por || "",
      ];
    });
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
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-4 space-y-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-white/5 [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb]:rounded-full">

      {/* Lembrete de Cobrança */}
      {pendentes.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 overflow-hidden" style={{ background: "rgba(245,158,11,0.06)" }}>
          <button
            onClick={() => setShowPendentes(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-left"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">⚠️</span>
              <span className="text-amber-300 text-xs font-black">Lembrete de Cobrança</span>
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                {pendentes.length} consulta{pendentes.length !== 1 ? "s" : ""} nos últimos 14 dias
              </span>
            </div>
            <span className="text-amber-400/50 text-xs">{showPendentes ? "▲" : "▼"}</span>
          </button>

          {showPendentes && (
            <div className="border-t border-amber-500/15 divide-y divide-white/5">
              {pendentes.map(ag => {
                const nome   = ag.nome_paciente || ag.lead?.name || "—";
                const fone   = ag.telefone_paciente || ag.lead?.phone || "";
                const medico = ag.medico?.nome?.replace(/^(Dr\.|Dra\.) /, "") || "—";
                const valor  = ag.medico?.valor;
                const d      = new Date(ag.data_hora);
                const diasAtras = Math.floor((Date.now() - d.getTime()) / 86400000);
                return (
                  <div key={ag.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0 text-amber-400 font-black text-xs">
                      {nome[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white/80 text-xs font-bold truncate">{nome}</p>
                      <p className="text-white/35 text-[10px]">{medico} · {d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · {diasAtras === 0 ? "hoje" : `${diasAtras}d atrás`}</p>
                    </div>
                    {valor && (
                      <span className="text-emerald-400 font-black text-xs shrink-0">
                        {Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </span>
                    )}
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full shrink-0 ${ag.status === "realizado" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-amber-500/20 text-amber-400 border border-amber-500/30"}`}>
                      {ag.status === "realizado" ? "REALIZADO" : "AGENDADO"}
                    </span>
                    {fone && (
                      <a href={`https://wa.me/${fone}`} target="_blank" rel="noreferrer"
                        className="shrink-0 text-[10px] text-emerald-400/60 hover:text-emerald-300 transition">WA</a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map(({ label, value, icon: Icon, color, shadow }) => (
          <div key={label} className="rounded-xl border border-white/10 p-3.5 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.04)" }}>
            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-lg ${shadow} shrink-0`}>
              <Icon size={16} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-white font-black text-base leading-none truncate">{loading ? "–" : value}</p>
              <p className="text-white/40 text-[9px] font-bold uppercase tracking-wider mt-0.5 leading-tight">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filtros + Ações */}
      <div className="rounded-xl border border-white/10 p-3 space-y-2.5" style={{ background: "rgba(255,255,255,0.03)" }}>

        {/* Row 1: period presets + always-visible pickers + actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {([
            { mode: "mes_atual",    label: "Este mês" },
            { mode: "mes_anterior", label: "Mês ant." },
            { mode: "ano_atual",    label: "Ano"      },
            { mode: "tudo",         label: "Tudo"     },
          ] as { mode: PeriodoMode; label: string }[]).map(({ mode, label }) => (
            <button key={mode}
              onClick={() => { setPeriodoMode(mode); setDataInicio(""); setDataFim(""); }}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition border ${periodoMode === mode && periodoMode !== "mes_especifico" && periodoMode !== "intervalo" ? "bg-emerald-600 border-emerald-500 text-white" : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10"}`}>
              {label}
            </button>
          ))}

          <div className="w-px h-5 bg-white/10 mx-0.5" />

          {/* Month picker — always visible */}
          <input type="month" value={mesAno}
            onChange={e => { setMesAno(e.target.value); setPeriodoMode("mes_especifico"); setDataInicio(""); setDataFim(""); }}
            title="Mês específico"
            style={{ colorScheme: "dark" }}
            className={`px-2.5 py-1 rounded-lg border text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40 transition ${periodoMode === "mes_especifico" ? "bg-emerald-600/20 border-emerald-500/50 text-emerald-300" : "bg-white/5 border-white/10 text-white/50"}`}
          />

          {/* Date range — always visible */}
          <input type="date" value={dataInicio}
            onChange={e => { setDataInicio(e.target.value); setPeriodoMode("intervalo"); }}
            placeholder="De"
            title="Data início"
            style={{ colorScheme: "dark" }}
            className={`px-2.5 py-1 rounded-lg border text-xs focus:outline-none focus:ring-1 focus:ring-sky-500/40 transition ${periodoMode === "intervalo" && dataInicio ? "bg-sky-600/20 border-sky-500/50 text-sky-300" : "bg-white/5 border-white/10 text-white/40"}`}
          />
          <input type="date" value={dataFim}
            onChange={e => { setDataFim(e.target.value); setPeriodoMode("intervalo"); }}
            placeholder="Até"
            title="Data fim"
            style={{ colorScheme: "dark" }}
            className={`px-2.5 py-1 rounded-lg border text-xs focus:outline-none focus:ring-1 focus:ring-sky-500/40 transition ${periodoMode === "intervalo" && dataFim ? "bg-sky-600/20 border-sky-500/50 text-sky-300" : "bg-white/5 border-white/10 text-white/40"}`}
          />
          {(dataInicio || dataFim) && (
            <button onClick={() => { setDataInicio(""); setDataFim(""); setPeriodoMode("mes_atual"); }}
              className="text-white/30 hover:text-white/60 transition" title="Limpar datas">
              <X size={12} />
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button onClick={handleClearAll} disabled={filtered.length === 0 || clearingAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/15 hover:bg-rose-600/30 border border-rose-500/30 text-rose-400 hover:text-rose-300 text-xs font-black transition disabled:opacity-30"
              title="Apagar todos os lançamentos do período atual">
              <Trash2 size={12} /> {clearingAll ? "Apagando..." : "Limpar tudo"}
            </button>
            <button onClick={exportCSV} disabled={filtered.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white text-xs font-bold transition disabled:opacity-30">
              <Download size={12} /> CSV
            </button>
            <button
              onClick={() => {
                if (selectedIds.size === 0) {
                  setSelectedIds(new Set(filtered.map(t => t.id)));
                }
                setShowKpiExport(true);
              }}
              disabled={filtered.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 border border-violet-500/50 text-white text-xs font-black transition shadow shadow-violet-500/30 disabled:opacity-30">
              <BarChart2 size={12} /> KPI
            </button>
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-black transition shadow-lg shadow-sky-500/30">
              <Upload size={12} /> Importar
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
            <button onClick={() => { setForm({ ...EMPTY_FORM }); setEditingTx(null); setShowModal(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition shadow-lg shadow-emerald-500/30">
              <Plus size={13} /> Lançamento
            </button>
          </div>
        </div>

        {/* Row 3: unified search + filters */}
        <div className="flex items-center gap-2 flex-wrap">

          {/* Unified search bar */}
          <div className="relative flex-1 min-w-[260px]">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            <input
              value={busca}
              onChange={e => { setBusca(e.target.value); if (gptResult && !e.target.value.trim()) setGptResult(null); }}
              onKeyDown={e => { if (e.key === "Enter") handleSmartSearch(); }}
              placeholder='Paciente, pix, "acima de 500 em março"... ↵'
              className={`w-full pl-8 pr-16 py-1.5 rounded-lg border text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 transition ${gptResult ? "bg-violet-500/10 border-violet-500/35 focus:ring-violet-500/50" : "bg-white/5 border-white/10 focus:ring-emerald-500/40"}`}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {busca && (
                <button onClick={() => { setBusca(""); setGptResult(null); }} className="text-white/25 hover:text-white/60 transition">
                  <X size={10} />
                </button>
              )}
              <button onClick={handleSmartSearch} title="Busca inteligente (Enter)"
                className={`text-[10px] transition ${gptResult ? "text-violet-400" : "text-white/20 hover:text-white/50"}`}>
                🤖
              </button>
            </div>
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

        {/* AI filter active label */}
        {gptResult && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20">
            <span className="text-[11px]">🤖</span>
            <span className="text-violet-300 text-xs font-semibold">{gptResult.descricao}</span>
            <button onClick={() => { setGptResult(null); setBusca(""); }} className="ml-auto text-white/25 hover:text-white/60 transition">
              <X size={11} />
            </button>
          </div>
        )}
      </div>

      {/* ── Tabela de Transações — full width ── */}
      <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-white/60 text-xs font-bold uppercase tracking-wide">Lançamentos</h3>
            <span className="text-[10px] text-white/30 font-bold">{filtered.length} registros</span>
          </div>
          {busca && <span className="text-xs text-emerald-400/70">filtrado: "{busca}"</span>}
        </div>

        {loading ? (
          <div className="py-16 text-center text-white/30 text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-white/20 text-sm">Nenhuma transação encontrada</div>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[600px] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-white/5 [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb]:rounded-full">
            <table className="w-full text-xs min-w-[1180px]">
              <thead className="sticky top-0 z-10" style={{ background: "rgba(14,26,70,0.97)" }}>
                <tr className="border-b border-white/8">
                  <th className="px-3 py-2.5 w-8">
                    <button
                      onClick={() => {
                        if (selectedIds.size === filtered.length) setSelectedIds(new Set());
                        else setSelectedIds(new Set(filtered.map((t: any) => t.id)));
                      }}
                      className="text-white/30 hover:text-violet-400 transition flex items-center">
                      {selectedIds.size > 0 && selectedIds.size === filtered.length
                        ? <CheckSquare size={13} className="text-violet-400" />
                        : <Square size={13} />}
                    </button>
                  </th>
                  <th className="text-left px-3 py-2.5 text-white/35 font-bold whitespace-nowrap">Data Venda</th>
                  <th className="text-left px-3 py-2.5 text-white/35 font-bold whitespace-nowrap">Data Pgto</th>
                  <th className="text-left px-3 py-2.5 text-white/35 font-bold whitespace-nowrap">Mês</th>
                  <th className="text-left px-3 py-2.5 text-white/35 font-bold whitespace-nowrap">Tipo</th>
                  <th className="text-left px-3 py-2.5 text-white/35 font-bold whitespace-nowrap">Forma Pgto</th>
                  <th className="text-left px-3 py-2.5 text-white/35 font-bold whitespace-nowrap">Paciente</th>
                  <th className="text-left px-3 py-2.5 text-white/35 font-bold whitespace-nowrap">CPF</th>
                  <th className="text-left px-3 py-2.5 text-white/35 font-bold whitespace-nowrap">Médico</th>
                  <th className="text-left px-3 py-2.5 text-white/35 font-bold whitespace-nowrap">Banco/Bandeira</th>
                  <th className="text-right px-3 py-2.5 text-white/35 font-bold whitespace-nowrap">Vlr Entrada</th>
                  <th className="text-right px-3 py-2.5 text-white/35 font-bold whitespace-nowrap">Vlr Saída</th>
                  <th className="text-center px-3 py-2.5 text-white/35 font-bold whitespace-nowrap">Parc.</th>
                  <th className="text-right px-3 py-2.5 text-white/35 font-bold whitespace-nowrap">Vlr Final</th>
                  <th className="text-left px-3 py-2.5 text-white/35 font-bold whitespace-nowrap">Descrição</th>
                  <th className="text-center px-2 py-2.5 text-white/35 font-bold whitespace-nowrap">NF</th>
                  <th className="px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const bruto  = Number(t.valor || 0);
                  const taxaC  = bruto * (Number(t.taxa_cartao || 0) / 100);
                  const taxaD  = Number(t.taxas_diversas || 0);
                  const saida  = taxaC + taxaD;
                  const final  = bruto - saida;
                  const mes    = t.data_pagamento ? new Date(t.data_pagamento).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }) : "—";
                  const tipo   = t.tipo_servico || "consulta";
                  const isSelected = selectedIds.has(t.id);
                  return (
                    <tr key={t.id} className={`border-b border-white/[0.04] transition group ${isSelected ? "bg-violet-500/8" : "hover:bg-white/[0.03]"}`}>
                      <td className="px-3 py-2.5 w-8">
                        <button
                          onClick={() => setSelectedIds(prev => {
                            const next = new Set(prev);
                            next.has(t.id) ? next.delete(t.id) : next.add(t.id);
                            return next;
                          })}
                          className="text-white/30 hover:text-violet-400 transition flex items-center">
                          {isSelected
                            ? <CheckSquare size={13} className="text-violet-400" />
                            : <Square size={13} />}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-white/50 whitespace-nowrap">
                        {t.data_venda ? fmtDate(t.data_venda) : (t.data_pagamento ? fmtDate(t.data_pagamento) : "—")}
                      </td>
                      <td className="px-3 py-2.5 text-white/40 whitespace-nowrap">
                        {t.data_pagamento ? fmtDate(t.data_pagamento) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-white/35 whitespace-nowrap capitalize">{mes}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${TIPO_STYLE[tipo] || "bg-white/10 text-white/40 border-white/15"}`}>
                          {tipo.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {t.forma_pagamento ? (
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${FORMA_STYLE[t.forma_pagamento] || "bg-white/10 text-white/50 border-white/20"}`}>
                            {t.forma_pagamento.toUpperCase()}
                          </span>
                        ) : <span className="text-white/20">—</span>}
                      </td>
                      <td className="px-3 py-2.5 max-w-[140px]">
                        {t.nome_paciente ? (
                          <button onClick={() => setPaciente(t.nome_paciente)}
                            className="text-white/80 font-semibold hover:text-emerald-300 hover:underline text-left truncate max-w-full flex items-center gap-1 group/pac">
                            <span className="truncate">{t.nome_paciente}</span>
                            <ChevronRight size={9} className="shrink-0 opacity-0 group-hover/pac:opacity-100 text-emerald-400" />
                          </button>
                        ) : <span className="text-white/20">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-white/35 whitespace-nowrap font-mono text-[10px]">
                        {t.cpf_paciente || <span className="text-white/15">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-white/50 max-w-[120px] truncate whitespace-nowrap">
                        {(t.medico_nome || "—").replace(/^(Dr\.|Dra\.) /, "")}
                      </td>
                      <td className="px-3 py-2.5 text-white/40 whitespace-nowrap text-[10px]">
                        {[t.banco, t.bandeira && `${t.bandeira}${t.parcelas > 1 ? ` ${t.parcelas}x` : ""}`].filter(Boolean).join(" · ") || <span className="text-white/15">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <span className="text-emerald-400 font-black">{fmt(bruto)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {saida > 0
                          ? <span className="text-rose-400/80 font-bold">({fmt(saida)})</span>
                          : <span className="text-white/15">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        {t.parcelas > 1
                          ? <span className="text-violet-300 font-black text-[10px]">{t.parcelas}x</span>
                          : <span className="text-white/20 text-[10px]">1x</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <span className={`font-black ${saida > 0 ? "text-sky-300" : "text-emerald-400"}`}>{fmt(final)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-white/35 max-w-[160px] truncate text-[11px]">
                        {t.observacoes || <span className="text-white/15">—</span>}
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <span className="text-white/15 text-[10px]">—</span>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleTogglePago(t)} disabled={togglingPagoId === t.id}
                            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black transition border disabled:opacity-40 ${t.pago ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30" : "bg-white/5 border-white/10 text-white/30 hover:bg-emerald-500/15 hover:border-emerald-500/30 hover:text-emerald-400"}`}
                            title={t.pago ? "Marcar como não pago" : "Marcar como pago"}>
                            <CheckCircle size={10} /> {t.pago ? "Pago" : "Pagar"}
                          </button>
                          <button onClick={() => setReciboTx(t)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/30 text-sky-400 text-[10px] font-black transition border border-sky-500/25"
                            title="Emitir Recibo">
                            <FileText size={10} /> Recibo
                          </button>
                          <button onClick={() => handleEdit(t)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-amber-500/20 text-white/30 hover:text-amber-400 transition"
                            title="Editar">
                            <Pencil size={11} />
                          </button>
                          <button onClick={() => handleDelete(t.id)} disabled={deletingId === t.id}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-rose-500/20 text-white/30 hover:text-rose-400 transition disabled:opacity-30"
                            title="Excluir">
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0" style={{ background: "rgba(14,26,70,0.97)" }}>
                <tr className="border-t border-white/15">
                  <td colSpan={9} className="px-3 py-3 text-white/40 text-xs font-bold uppercase tracking-wide">TOTAIS DO PERÍODO</td>
                  <td className="px-3 py-3 text-right">
                    <span className="text-emerald-300 font-black">{fmt(total)}</span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="text-rose-400/80 font-black">{totalDeducoes > 0 ? `(${fmt(totalDeducoes)})` : "—"}</span>
                  </td>
                  <td />
                  <td className="px-3 py-3 text-right">
                    <span className="text-sky-300 font-black">{fmt(totalLiquido)}</span>
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Análise Financeira — seção inferior ── */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Receita por Médico */}
          <div className="lg:col-span-2 rounded-xl border border-white/10 p-5" style={{ background: "rgba(255,255,255,0.04)" }}>
            <h3 className="text-white/60 text-xs font-bold uppercase tracking-wide mb-4">Receita por Médico</h3>
            {byMedico.length === 0 ? (
              <p className="text-white/20 text-xs py-4 text-center">Nenhum dado de médico no período</p>
            ) : (
              <div className="space-y-4">
                {byMedico.map((m, idx) => {
                  const pct        = Math.round((m.total / total) * 100);
                  const qtd        = filtered.filter(t => t.medico_id === m.id || norm(t.medico_nome || "").includes(norm(m.nome.replace(/^(dr\.|dra\.)\s*/i,"").split(" ")[0]))).length;
                  const ticket     = qtd > 0 ? m.total / qtd : 0;
                  const colors     = ["from-emerald-500 to-teal-400","from-sky-500 to-blue-400","from-violet-500 to-purple-400","from-amber-500 to-orange-400","from-rose-500 to-pink-400"];
                  const barColor   = colors[idx % colors.length];
                  return (
                    <div key={m.id}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-2.5 h-2.5 rounded-full bg-gradient-to-r ${barColor} shrink-0`} />
                          <span className="text-white/80 font-bold text-sm truncate">{m.nome.replace(/^(Dr\.|Dra\.) /, "")}</span>
                        </div>
                        <div className="flex items-center gap-4 shrink-0 ml-3">
                          <span className="text-white/30 text-[10px]">{qtd} atend. · ticket {fmt(ticket)}</span>
                          <span className="text-white/40 text-[11px] font-bold w-8 text-right">{pct}%</span>
                          <span className="text-emerald-400 font-black text-sm w-24 text-right">{fmt(m.total)}</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                        <div className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all`}
                          style={{ width: `${(m.total / maxVal) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* DRE simplificado */}
            <div className="mt-5 pt-4 border-t border-white/8 grid grid-cols-3 gap-3">
              {[
                { label: "Receita Bruta",   value: total,        color: "text-emerald-400" },
                { label: "(-) Deduções",    value: -totalDeducoes, color: "text-rose-400"  },
                { label: "(=) Líquido",     value: totalLiquido, color: "text-sky-300"     },
              ].map(c => (
                <div key={c.label} className="rounded-lg p-3 border border-white/8" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <p className="text-white/35 text-[9px] font-bold uppercase tracking-wide mb-1">{c.label}</p>
                  <p className={`font-black text-sm ${c.color}`}>{fmt(Math.abs(c.value))}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Por Forma de Pagamento */}
          <div className="rounded-xl border border-white/10 p-5" style={{ background: "rgba(255,255,255,0.04)" }}>
            <h3 className="text-white/60 text-xs font-bold uppercase tracking-wide mb-4">Por Forma de Pagamento</h3>
            <div className="space-y-3">
              {FORMAS.map(f => {
                const txsFo = filtered.filter(t => t.forma_pagamento === f);
                const tot   = txsFo.reduce((s, t) => s + Number(t.valor || 0), 0);
                if (!tot) return null;
                const pct   = Math.round((tot / total) * 100);
                return (
                  <div key={f}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${FORMA_STYLE[f]}`}>{f.toUpperCase()}</span>
                        <span className="text-white/30 text-[10px]">{txsFo.length} lançamentos</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white/35 text-[10px]">{pct}%</span>
                        <span className="text-white/70 font-black text-xs">{fmt(tot)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-white/20 to-white/10 transition-all"
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Ticket médio por forma */}
            <div className="mt-4 pt-4 border-t border-white/8 space-y-2">
              <p className="text-white/30 text-[9px] font-bold uppercase tracking-wide">Ticket Médio por Forma</p>
              {FORMAS.map(f => {
                const txsFo = filtered.filter(t => t.forma_pagamento === f);
                if (!txsFo.length) return null;
                const med = txsFo.reduce((s, t) => s + Number(t.valor || 0), 0) / txsFo.length;
                return (
                  <div key={f} className="flex justify-between text-[11px]">
                    <span className="text-white/40 capitalize">{f}</span>
                    <span className="text-white/70 font-bold">{fmt(med)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Barra flutuante de seleção ─────────────────────────────────────── */}
      {selectedIds.size > 0 && !showKpiExport && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 rounded-2xl border border-violet-500/40 shadow-2xl shadow-violet-500/20"
          style={{ background: "rgba(14,26,70,0.97)", backdropFilter: "blur(12px)" }}>
          <CheckSquare size={16} className="text-violet-400 shrink-0" />
          <span className="text-white font-black text-sm">{selectedIds.size} selecionado{selectedIds.size !== 1 ? "s" : ""}</span>
          <span className="text-violet-300 font-bold text-sm">
            {filtered.filter(t => selectedIds.has(t.id)).reduce((s, t) => s + Number(t.valor || 0), 0)
              .toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </span>
          <div className="w-px h-5 bg-white/15" />
          <button
            onClick={async () => {
              for (const id of Array.from(selectedIds)) {
                const tx = filtered.find(t => t.id === id);
                if (tx) await markPagoFinanceiro(id, true);
              }
              setSelectedIds(new Set());
              load();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition">
            <CheckCircle size={12} /> Marcar pago
          </button>
          <button onClick={() => setShowKpiExport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-black transition">
            <BarChart2 size={12} /> Gerar KPI
          </button>
          <button onClick={handleBulkDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-black transition">
            <Trash2 size={12} /> Excluir
          </button>
          <button onClick={() => setSelectedIds(new Set())}
            className="text-white/30 hover:text-white/70 transition">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Modal: KPI Export ─────────────────────────────────────────────────── */}
      {showKpiExport && (
        <KPIExportModal
          txs={selectedIds.size > 0
            ? filtered.filter(t => selectedIds.has(t.id))
            : filtered}
          medicos={medicos}
          onClose={() => setShowKpiExport(false)}
        />
      )}

      {/* ── Modal: Recibo ────────────────────────────────────────────────────── */}
      {reciboTx && (
        <ReciboModal tx={reciboTx} onClose={() => setReciboTx(null)} />
      )}

      {/* ── Modal: Histórico do Paciente ─────────────────────────────────────── */}
      {paciente && (
        <PatientHistoryModal
          nomePaciente={paciente}
          todasTransacoes={transacoes}
          medicos={medicos}
          currentUser={{ nome: "Secretária" }}
          onClose={() => setPaciente(null)}
          onEditTx={tx => { handleEdit(tx); setPaciente(null); }}
          onDeleteTx={handleDelete}
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
                  <p className="text-white font-black text-sm">{editingTx ? "Editar Lançamento" : "Novo Lançamento"}</p>
                  <p className="text-white/40 text-[10px]">{editingTx ? "Atualize os dados do pagamento" : "Registrar pagamento manualmente"}</p>
                </div>
              </div>
              <button onClick={() => { setShowModal(false); setEditingTx(null); }} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition"><X size={16} /></button>
            </div>

            <div className="p-5 space-y-3 overflow-y-auto max-h-[70vh]">

              {/* Paciente + CPF */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Paciente</label>
                  <input value={form.nome_paciente} onChange={e => handleFormChange("nome_paciente", e.target.value)}
                    placeholder="Nome do paciente"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">CPF</label>
                  <input value={form.cpf_paciente} onChange={e => handleFormChange("cpf_paciente", e.target.value)}
                    placeholder="000.000.000-00"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 font-mono" />
                </div>
              </div>

              {/* Médico + Tipo */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Médico</label>
                  <select value={form.medico_id} onChange={e => handleFormChange("medico_id", e.target.value)}
                    style={{ colorScheme: 'dark' }}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40">
                    <option value="">Selecionar...</option>
                    {medicos.map(m => <option key={m.id} value={m.id}>{m.nome.replace(/^(Dr\.|Dra\.) /, "")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Tipo de Serviço</label>
                  <select value={form.tipo_servico} onChange={e => handleFormChange("tipo_servico", e.target.value)}
                    style={{ colorScheme: 'dark' }}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40">
                    {TIPOS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
              </div>

              {/* Valor + Data Venda + Data Pgto */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Valor (R$)</label>
                  <input type="number" min="0" step="0.01" value={form.valor} onChange={e => handleFormChange("valor", e.target.value)}
                    placeholder="0,00"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Data Venda</label>
                  <input type="date" value={form.data_venda} onChange={e => handleFormChange("data_venda", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Data Pgto</label>
                  <input type="date" value={form.data_pagamento} onChange={e => handleFormChange("data_pagamento", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
              </div>

              {/* Banco + Taxas */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Banco</label>
                  <input value={form.banco} onChange={e => handleFormChange("banco", e.target.value)}
                    placeholder="Nubank, Itaú..."
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Taxa cartão (%)</label>
                  <input type="number" min="0" step="0.01" max="100" value={form.taxa_cartao} onChange={e => handleFormChange("taxa_cartao", e.target.value)}
                    placeholder="0,00"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Taxas diversas (R$)</label>
                  <input type="number" min="0" step="0.01" value={form.taxas_diversas} onChange={e => handleFormChange("taxas_diversas", e.target.value)}
                    placeholder="0,00"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
                </div>
              </div>
              {form.valor && (Number(form.taxa_cartao) > 0 || Number(form.taxas_diversas) > 0) && (() => {
                const bruto   = parseValor(form.valor) || 0;
                const taxaC   = bruto * (parseFloat(form.taxa_cartao) || 0) / 100;
                const taxaD   = parseFloat(form.taxas_diversas) || 0;
                const liquido = bruto - taxaC - taxaD;
                return (
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20">
                    <span className="text-white/40 text-[10px] font-bold uppercase tracking-wide">Valor Líquido</span>
                    <span className="text-emerald-300 font-black text-sm">{fmt(liquido)}</span>
                  </div>
                );
              })()}

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
              <button onClick={() => { setShowModal(false); setEditingTx(null); }}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/50 hover:text-white hover:bg-white/5 text-xs font-bold transition">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving || !form.valor}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition shadow-lg shadow-emerald-500/30 disabled:opacity-50">
                {saving ? "Salvando..." : editingTx ? "Atualizar Lançamento" : "Salvar Lançamento"}
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
