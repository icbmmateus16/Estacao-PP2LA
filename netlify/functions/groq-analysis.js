/**
 * Netlify Function: groq-analysis
 * Recebe dados meteorológicos da estação PP2LA e retorna análise em linguagem
 * natural gerada pelo modelo Groq llama-3.3-70b-versatile.
 *
 * Chama: POST /.netlify/functions/groq-analysis
 * Body:  { current: {...}, history: {...}, period: "24h" }
 */

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const MODEL    = "llama-3.3-70b-versatile";

// Quantas leituras recentes enviar ao modelo (limite de tokens)
const MAX_HISTORY_POINTS = 24;

exports.handler = async event => {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=300",   // cache 5 min
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: "Missing GROQ_API_KEY environment variable" })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { current = {}, history = {}, period = "24h" } = payload;

  // ─── Monta resumo da série histórica ────────────────────────────────────────
  function seriesSummary(arr, label, unit, dec = 1) {
    const vals = (arr || [])
      .map(v => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; })
      .filter(v => v !== null);
    if (!vals.length) return null;
    const min = Math.min(...vals).toFixed(dec);
    const max = Math.max(...vals).toFixed(dec);
    const avg = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(dec);
    // tendência: últimos 6 pontos vs primeiros 6
    const half = Math.floor(vals.length / 2);
    const firstHalf = vals.slice(0, Math.max(1, half));
    const lastHalf  = vals.slice(-Math.max(1, half));
    const avgFirst  = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgLast   = lastHalf.reduce((a, b) => a + b, 0) / lastHalf.length;
    const diff = avgLast - avgFirst;
    const trend = diff > 0.5 ? "subindo" : diff < -0.5 ? "caindo" : "estável";
    return `${label}: mín ${min}${unit}, méd ${avg}${unit}, máx ${max}${unit}, tendência: ${trend}`;
  }

  // ─── Calcula variação de pressão recente ────────────────────────────────────
  function pressureDelta(arr) {
    const vals = (arr || [])
      .map(v => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; })
      .filter(v => v !== null);
    if (vals.length < 4) return null;
    const recent = vals.slice(-4);
    const delta  = recent[recent.length - 1] - recent[0];
    return delta.toFixed(1);
  }

  const periodNames = {
    "24h":   "últimas 24 horas",
    week:    "última semana",
    month:   "último mês",
    year:    "último ano",
    decade:  "última década"
  };
  const periodLabel = periodNames[period] || period;

  // ─── Dados atuais ─────────────────────────────────────────────────────────
  const c = current;
  const tempAtual  = c.temp  != null ? `${Number(c.temp ).toFixed(1)}°C`  : "N/D";
  const feelAtual  = c.feel  != null ? `${Number(c.feel ).toFixed(1)}°C`  : "N/D";
  const umiAtual   = c.umi   != null ? `${Number(c.umi  ).toFixed(0)}%`   : "N/D";
  const dewAtual   = c.dew   != null ? `${Number(c.dew  ).toFixed(1)}°C`  : "N/D";
  const rainAtual  = c.rain  != null ? `${Number(c.rain ).toFixed(0)}%`   : "N/D";
  const qnhAtual   = c.qnh   != null ? `${Number(c.qnh  ).toFixed(1)} hPa`: "N/D";
  const pabsAtual  = c.pabs  != null ? `${Number(c.pabs ).toFixed(1)} hPa`: "N/D";

  // Pressão: variação recente
  const deltaQNH  = pressureDelta(history.qnh);
  const deltaPabs = pressureDelta(history.pabs);
  const pressInfo = deltaQNH != null
    ? `Variação de pressão QNH nas últimas leituras: ${parseFloat(deltaQNH) > 0 ? "+" : ""}${deltaQNH} hPa.`
    : "";

  // Resumos históricos
  const histLines = [
    seriesSummary(history.temp,  "Temperatura",       "°C",  1),
    seriesSummary(history.feel,  "Sensação térmica",  "°C",  1),
    seriesSummary(history.umi,   "Umidade",           "%",   0),
    seriesSummary(history.dew,   "Ponto de orvalho",  "°C",  1),
    seriesSummary(history.rain,  "Chuva",             "%",   0),
    seriesSummary(history.qnh,   "Pressão QNH",       " hPa",1),
    seriesSummary(history.pabs,  "Pressão absoluta",  " hPa",1),
  ].filter(Boolean).join("\n");

  // ─── Prompt para o Groq ──────────────────────────────────────────────────
  const systemPrompt = `Você é o assistente meteorológico da Estação PP2LA, localizada em Gama, Distrito Federal, Brasil.
Analise os dados reais da estação e gere um relatório em português brasileiro.
Seja direto, preciso e use linguagem acessível ao público geral.
NÃO mencione que você é uma IA. Escreva como um meteorologista especializado.
Estruture a resposta em 3 partes SEPARADAS POR "|||":
1. RESUMO ATUAL (2-3 frases sobre a condição presente)
2. ANÁLISE DE TENDÊNCIA (1-2 frases sobre o que os dados históricos e a pressão indicam)
3. ALERTA OU RECOMENDAÇÃO (1 frase prática — pode ser "Sem alertas no momento." se o tempo estiver normal)
NÃO use cabeçalhos, markdown, bullet points ou emojis. Apenas texto puro separado por |||.`;

  const userPrompt = `Dados atuais da Estação PP2LA — Gama-DF:
Temperatura: ${tempAtual}
Sensação térmica: ${feelAtual}
Umidade relativa: ${umiAtual}
Ponto de orvalho: ${dewAtual}
Intensidade de chuva: ${rainAtual}
Pressão QNH: ${qnhAtual}
Pressão absoluta: ${pabsAtual}

Resumo histórico (${periodLabel}):
${histLines || "Dados históricos não disponíveis."}

${pressInfo}

Gere o relatório meteorológico completo.`;

  // ─── Chama a API do Groq ─────────────────────────────────────────────────
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 15000);

  try {
    const groqRes = await fetch(GROQ_API, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify({
        model:       MODEL,
        messages:    [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt   }
        ],
        temperature: 0.65,
        max_tokens:  420,
        stream:      false
      })
    });

    clearTimeout(timeout);

    if (!groqRes.ok) {
      const errText = await groqRes.text().catch(() => "");
      return {
        statusCode: groqRes.status, headers,
        body: JSON.stringify({ error: `Groq API error ${groqRes.status}`, detail: errText })
      };
    }

    const groqData = await groqRes.json();
    const text     = groqData.choices?.[0]?.message?.content?.trim() || "";

    // Divide as 3 partes
    const parts    = text.split("|||").map(p => p.trim()).filter(Boolean);
    const resumo   = parts[0] || text;
    const tendencia= parts[1] || null;
    const alerta   = parts[2] || null;

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ resumo, tendencia, alerta, model: MODEL })
    };

  } catch (err) {
    clearTimeout(timeout);
    const reason = err.name === "AbortError" ? "Groq API timeout (15s)" : `Groq API unavailable: ${err.message}`;
    return { statusCode: 502, headers, body: JSON.stringify({ error: reason }) };
  }
};
