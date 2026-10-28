'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

// ---------- Senhas e tokens ----------
function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}
function verificarSenha(senha, armazenado) {
  const [saltHex, hashHex] = String(armazenado).split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(senha, Buffer.from(saltHex, 'hex'), 64);
  const esperado = Buffer.from(hashHex, 'hex');
  return esperado.length === hash.length && crypto.timingSafeEqual(hash, esperado);
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const novoToken = () => crypto.randomBytes(32).toString('hex');

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// ---------- Limite de tentativas (memória) ----------
const baldes = new Map();
function limite(chave, max, janelaMs) {
  const agora = Date.now();
  const b = baldes.get(chave) || { n: 0, ate: agora + janelaMs };
  if (agora > b.ate) { b.n = 0; b.ate = agora + janelaMs; }
  b.n++;
  baldes.set(chave, b);
  return b.n <= max;
}
setInterval(() => { const t = Date.now(); for (const [k, b] of baldes) if (t > b.ate) baldes.delete(k); }, 600000).unref();

// ---------- Datas (horário local do estabelecimento, sem fuso no banco) ----------
function agoraLocal(fuso) {
  // 'YYYY-MM-DD HH:MM'
  const s = new Date().toLocaleString('sv-SE', { timeZone: fuso || 'America/Fortaleza' });
  return s.slice(0, 16);
}
const hojeLocal = (fuso) => agoraLocal(fuso).slice(0, 10);
function addMin(data, hora, min) {
  const d = new Date(`${data}T${hora}:00Z`);
  return new Date(d.getTime() + min * 60000).toISOString().slice(0, 16).replace('T', ' ');
}
function addDias(data, n) {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const diaSemana = (data) => new Date(`${data}T00:00:00Z`).getUTCDay();
const dataValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(new Date(s + 'T00:00:00Z'));
const horaValida = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
const hm = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
const toMin = (h) => parseInt(h.slice(0, 2), 10) * 60 + parseInt(h.slice(3, 5), 10);

// ---------- Planos ----------
// Funções por plano (somam): Básico +5 (5) · Profissional +10 (15) · Premium +20 (35).
const FUNCOES = {
  financeiro: 'Financeiro: receitas, despesas e saldo',
  logo: 'Seu logo na página de agendamento',
  lembretes: 'Lembretes de atendimento no app',
  historico_cliente: 'Histórico de atendimentos de cada cliente',
  cancelamento_online: 'Cliente cancela pela página com código',
  comissoes: 'Comissões por profissional',
  relatorios: 'Relatórios: faturamento e situação dos agendamentos',
  fotos_profissionais: 'Foto dos profissionais',
  intervalo_horarios: 'Intervalo de horários personalizado',
  escolher_profissional: 'Cliente escolhe o profissional ao agendar',
  exportar: 'Exportar agendamentos (CSV)',
  exportar_clientes: 'Exportar clientes (CSV)',
  exportar_financeiro: 'Exportar financeiro (CSV)',
  categorias_despesas: 'Categorias em receitas e despesas',
  rel_servicos: 'Relatório: serviços mais procurados',
  rel_profissionais: 'Relatório: desempenho por profissional',
  rel_clientes: 'Relatório: melhores clientes',
  rel_cancelamentos: 'Relatório: cancelamentos e faltas',
  rel_origem: 'Relatório: origem dos agendamentos',
  rel_ticket: 'Ticket médio e taxa de cancelamento',
  remarcar_agendamento: 'Editar e remarcar agendamentos',
  preco_personalizado: 'Valor personalizado no agendamento e na conclusão',
  observacoes_clientes: 'Observações no cadastro do cliente',
  horarios_profissionais: 'Horários de trabalho de cada profissional',
  pagina_personalizada: 'Página pública personalizada: descrição, endereço, telefone, cores e fundo',
  marcar_falta: 'Marcar falta do cliente',
  receitas_avulsas: 'Lançar receitas avulsas no financeiro',
  dashboard_graficos: 'Gráficos e serviços mais procurados no painel',
  agenda_online_60_dias: 'Agenda online aberta por 60 dias (nos outros, 14)',
  historico_notificacoes: 'Histórico completo de notificações',
  link_personalizado: 'Endereço personalizado da página de agendamento',
  fuso_horario: 'Fuso horário personalizado',
  cor_profissional: 'Cor de cada profissional na agenda',
  observacoes_agendamento: 'Observações nos agendamentos',
  observacoes_online: 'Cliente deixa observação ao agendar online',
};
const BASE = ['agenda', 'clientes', 'servicos', 'pagina_publica'];
const NIVEIS = {
  basico: ['financeiro', 'logo', 'lembretes', 'historico_cliente', 'cancelamento_online'],
  profissional: ['comissoes', 'relatorios', 'fotos_profissionais', 'intervalo_horarios', 'escolher_profissional', 'remarcar_agendamento', 'preco_personalizado', 'observacoes_clientes', 'horarios_profissionais', 'pagina_personalizada'],
  premium: ['exportar', 'exportar_clientes', 'exportar_financeiro', 'categorias_despesas', 'rel_servicos', 'rel_profissionais', 'rel_clientes', 'rel_cancelamentos', 'rel_origem', 'rel_ticket',
    'marcar_falta', 'receitas_avulsas', 'dashboard_graficos', 'agenda_online_60_dias', 'historico_notificacoes', 'link_personalizado', 'fuso_horario', 'cor_profissional', 'observacoes_agendamento', 'observacoes_online'],
};
const lista = (ids) => ids.map((id) => ({ id, nome: FUNCOES[id] }));
const PLANOS = {
  gratis: {
    id: 'gratis', nome: 'Grátis', preco: 0, max_profissionais: 1, max_servicos: 5, max_clientes: 50, max_agendamentos_mes: 30,
    recursos: [...BASE], total_funcoes: 0, funcoes: [], herda: null,
    destaques: ['Agenda, clientes e serviços', 'Página de agendamento online', '1 profissional', 'Até 5 serviços e 50 clientes', 'Até 30 agendamentos por mês'],
  },
  basico: {
    id: 'basico', nome: 'Básico', preco: 20, max_profissionais: 1, max_servicos: 20, max_clientes: 500, max_agendamentos_mes: 300,
    recursos: [...BASE, ...NIVEIS.basico], total_funcoes: 5, funcoes: lista(NIVEIS.basico), herda: 'inicial',
    destaques: ['1 profissional', 'Até 20 serviços, 500 clientes e 300 agendamentos/mês'],
  },
  profissional: {
    id: 'profissional', nome: 'Profissional', preco: 37.9, max_profissionais: 5, max_servicos: null, max_clientes: null, max_agendamentos_mes: null,
    recursos: [...BASE, ...NIVEIS.basico, ...NIVEIS.profissional], total_funcoes: 15, funcoes: lista(NIVEIS.profissional), herda: 'Básico',
    destaques: ['Até 5 profissionais', 'Serviços, clientes e agendamentos ilimitados'],
  },
  premium: {
    id: 'premium', nome: 'Premium', preco: 59.9, max_profissionais: null, max_servicos: null, max_clientes: null, max_agendamentos_mes: null,
    recursos: [...BASE, ...NIVEIS.basico, ...NIVEIS.profissional, ...NIVEIS.premium], total_funcoes: 35, funcoes: lista(NIVEIS.premium), herda: 'Profissional',
    destaques: ['Profissionais ilimitados', 'Tudo ilimitado'],
  },
};
const TRIAL_DIAS = 14;

// Durante o teste de 14 dias vale tudo (Premium). Depois, quem não assinou fica no plano Grátis.
function estadoAssinatura(est) {
  const hoje = hojeLocal(est.fuso);
  if (est.assinatura_status === 'ativa') {
    // Assinatura paga por Pix tem validade (assinatura_ate). Contas de dono/cortesia não têm data e não vencem.
    if (!est.assinatura_ate) return { status: 'ativa', dias_restantes: null, acesso: true, plano_efetivo: est.plano };
    const resta = Math.round((new Date(est.assinatura_ate + 'T00:00:00Z') - new Date(hoje + 'T00:00:00Z')) / 86400000);
    if (resta < 0) return { status: 'gratis', dias_restantes: 0, acesso: true, plano_efetivo: 'gratis', vencida: true, assinatura_ate: est.assinatura_ate };
    return { status: 'ativa', dias_restantes: resta, acesso: true, plano_efetivo: est.plano, assinatura_ate: est.assinatura_ate };
  }
  const dias = Math.round((new Date(est.trial_ate + 'T00:00:00Z') - new Date(hoje + 'T00:00:00Z')) / 86400000);
  if (est.assinatura_status === 'trial' && dias >= 0) return { status: 'trial', dias_restantes: dias, acesso: true, plano_efetivo: 'premium' };
  return { status: 'gratis', dias_restantes: 0, acesso: true, plano_efetivo: 'gratis' };
}
const planoEfetivo = (est) => PLANOS[estadoAssinatura(est).plano_efetivo];

// ---------- Imagens (data URL base64, validadas por assinatura do arquivo) ----------
const MAX_IMG = 3 * 1024 * 1024;
function detectarImagem(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
function salvarImagem(dataUrl, estabId) {
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw erro(400, 'Imagem inválida. Use JPG, PNG ou WebP.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMG) throw erro(413, 'Imagem muito grande (máximo 3 MB).');
  const ext = detectarImagem(buf);
  if (!ext) throw erro(400, 'Arquivo não é uma imagem válida.');
  const dir = path.join(DATA_DIR, 'uploads', String(estabId));
  fs.mkdirSync(dir, { recursive: true });
  const nome = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(dir, nome), buf);
  return `/uploads/${estabId}/${nome}`;
}
function removerImagem(url) {
  try {
    if (!url || !url.startsWith('/uploads/')) return;
    const p = path.normalize(path.join(DATA_DIR, url));
    if (p.startsWith(path.join(DATA_DIR, 'uploads') + path.sep)) fs.unlinkSync(p);
  } catch (_) { /* ignora */ }
}

// ---------- Aparência da página pública (cores e fundo) ----------
const TEMAS_FUNDO = ['barbearia', 'dourado', 'rosa', 'oceano', 'natureza', 'minimal'];
const APARENCIA_PADRAO = { cor_principal: '#7c3aed', cor_secundaria: '#120d22', cor_destaque: '#a78bfa', fundo: { tipo: 'cor', cor: '#f5f3fb', tema: 'barbearia', imagem: '' } };
function aparenciaDe(est) {
  let j = {}; try { j = JSON.parse(est.aparencia || '{}') || {}; } catch (_) { j = {}; }
  return { ...APARENCIA_PADRAO, ...j, fundo: { ...APARENCIA_PADRAO.fundo, ...(j.fundo || {}) } };
}

// ---------- Erros e respostas ----------
function erro(status, mensagem, extra) {
  const e = new Error(mensagem);
  e.status = status; e.extra = extra || {};
  return e;
}
function enviarJSON(res, status, obj, headers) {
  const corpo = JSON.stringify(obj);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(corpo),
    'Cache-Control': 'no-store',
  }, headers || {}));
  res.end(corpo);
}
function lerCorpo(req, limiteBytes) {
  return new Promise((resolve, reject) => {
    let tam = 0; const partes = [];
    req.on('data', (c) => {
      tam += c.length;
      if (tam > limiteBytes) { reject(erro(413, 'Requisição muito grande.')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      if (!partes.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))); }
      catch (_) { reject(erro(400, 'JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

// ---------- Validação ----------
function texto(v, max, obrigatorio, rotulo) {
  const s = (v == null ? '' : String(v)).trim();
  if (obrigatorio && !s) throw erro(400, `${rotulo || 'Campo'} é obrigatório.`);
  if (s.length > max) throw erro(400, `${rotulo || 'Campo'} muito longo (máx. ${max}).`);
  return s;
}
function numero(v, rotulo, { min = 0, max = 1e9, padrao } = {}) {
  if ((v === '' || v == null) && padrao !== undefined) return padrao;
  const n = Number(String(v).replace(',', '.'));
  if (!isFinite(n) || n < min || n > max) throw erro(400, `${rotulo} inválido.`);
  return n;
}
const emailValido = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 160;
const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'estabelecimento';

// ---------- Arquivos estáticos ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
function servirArquivo(res, raiz, relativo, extraHeaders) {
  const p = path.normalize(path.join(raiz, relativo));
  if (!p.startsWith(path.normalize(raiz) + path.sep) && p !== path.normalize(raiz)) return false;
  let st; try { st = fs.statSync(p); } catch (_) { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(p).toLowerCase();
  if (!MIME[ext]) return false;
  res.writeHead(200, Object.assign({
    'Content-Type': MIME[ext], 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff',
  }, extraHeaders || {}));
  fs.createReadStream(p).pipe(res);
  return true;
}

// ---------- Roteador mínimo ----------
class Roteador {
  constructor() { this.rotas = []; }
  add(metodo, padrao, opts, fn) {
    if (typeof opts === 'function') { fn = opts; opts = {}; }
    const chaves = [];
    const re = new RegExp('^' + padrao.replace(/:([a-z_]+)/gi, (_, k) => { chaves.push(k); return '([^/]+)'; }) + '/?$');
    this.rotas.push({ metodo, re, chaves, opts, fn });
  }
  achar(metodo, pathname) {
    for (const r of this.rotas) {
      if (r.metodo !== metodo) continue;
      const m = r.re.exec(pathname);
      if (m) {
        const params = {};
        r.chaves.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { rota: r, params };
      }
    }
    return null;
  }
}

module.exports = {
  hashSenha, verificarSenha, sha256, novoToken, parseCookies, limite,
  agoraLocal, hojeLocal, addMin, addDias, diaSemana, dataValida, horaValida, hm, toMin,
  PLANOS, TRIAL_DIAS, estadoAssinatura, planoEfetivo, TEMAS_FUNDO, APARENCIA_PADRAO, aparenciaDe,
  salvarImagem, removerImagem, erro, enviarJSON, lerCorpo,
  texto, numero, emailValido, slugify, servirArquivo, Roteador,
};
