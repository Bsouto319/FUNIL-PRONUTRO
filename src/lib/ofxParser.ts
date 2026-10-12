// Parser de extrato OFX (SGML 1.02, formato usado por Stone e pela maioria
// dos bancos brasileiros) -- tags podem não ter fechamento (<DTPOSTED>valor
// sem </DTPOSTED>), então não dá pra usar um parser XML de verdade, tem que
// ser por linha.

export type OfxTransacao = {
  tipo: "CREDIT" | "DEBIT";
  data: string;       // ISO yyyy-mm-dd
  valor: number;       // sempre positivo
  memo: string;
  fitid: string;
};

export type OfxExtrato = {
  banco: string;       // FI/ORG do cabeçalho (ex: "Stone Instituição de Pagamento S.A.")
  conta: string;        // ACCTID
  transacoes: OfxTransacao[];
};

function parseOfxDate(raw: string): string {
  // formato DTPOSTED: 20260930080747[-3:BRT] ou 20260930
  const digits = raw.slice(0, 8);
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function extractTag(block: string, tag: string): string {
  // pega o conteúdo entre <TAG> e a próxima tag (ou quebra de linha), com ou sem fechamento
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : "";
}

export function parseOfx(conteudo: string): OfxExtrato {
  const banco = extractTag(conteudo, "ORG");
  const conta = extractTag(conteudo, "ACCTID");

  const blocos = conteudo.split(/<STMTTRN>/i).slice(1); // primeiro split é o cabeçalho, ignora
  const transacoes: OfxTransacao[] = blocos.map(bloco => {
    const fim = bloco.search(/<\/STMTTRN>/i);
    const corpo = fim >= 0 ? bloco.slice(0, fim) : bloco;
    const trntype = extractTag(corpo, "TRNTYPE").toUpperCase() as "CREDIT" | "DEBIT";
    const trnamt = parseFloat(extractTag(corpo, "TRNAMT").replace(",", "."));
    return {
      tipo: trntype,
      data: parseOfxDate(extractTag(corpo, "DTPOSTED")),
      valor: Math.abs(trnamt),
      memo: extractTag(corpo, "MEMO"),
      fitid: extractTag(corpo, "FITID"),
    };
  }).filter(t => !isNaN(t.valor) && t.data);

  return { banco, conta, transacoes };
}
