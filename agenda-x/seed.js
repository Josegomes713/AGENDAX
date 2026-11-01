'use strict';
// Dados de demonstração: cria o estabelecimento "Barbearia Demo" com serviços, profissionais,
// clientes, agenda, financeiro e notificações. Login: demo@agendax.com / demo12345
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, tx, DATA_DIR } = require('./db');
const L = require('./lib');

const EMAIL = 'demo@agendax.com';
if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(EMAIL)) {
  console.log('Demo já existe. Login: demo@agendax.com / demo12345');
  process.exit(0);
}

// Fotos de demonstração: PNGs de cor sólida gerados localmente
function pngSolido(r, g, b, w = 8, h = 8) {
  const zlib = require('zlib');
  const crc = (buf) => { let c, crcv = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crcv ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcv = (crcv >>> 8) ^ c; } return (crcv ^ 0xffffffff) >>> 0; };
  const chunk = (tipo, dados) => { const len = Buffer.alloc(4); len.writeUInt32BE(dados.length); const td = Buffer.concat([Buffer.from(tipo), dados]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const linha = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }).flatMap(() => [r, g, b]))]);
  const raw = Buffer.concat(Array.from({ length: h }, () => linha));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function foto(estId, cor) {
  const dir = path.join(DATA_DIR, 'uploads', String(estId)); fs.mkdirSync(dir, { recursive: true });
  const nome = crypto.randomBytes(12).toString('hex') + '.png';
  fs.writeFileSync(path.join(dir, nome), pngSolido(...cor, 64, 64));
  return `/uploads/${estId}/${nome}`;
}

const hojeStr = L.hojeLocal('America/Fortaleza');
const horarios = JSON.stringify(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { ativo: d >= 1 && d <= 6, inicio: '09:00', fim: d === 6 ? '14:00' : '19:00' }])));

tx(() => {
  const e = db.prepare("INSERT INTO estabelecimentos (nome, slug, telefone, endereco, descricao, plano, assinatura_status, trial_ate) VALUES (?,?,?,?,?,?,?,?)")
    .run('Barbearia Demo', 'barbearia-demo', '(85) 99999-0000', 'Rua das Flores, 123 — Fortaleza/CE', 'Cortes clássicos e modernos, barba e cuidados. Agende online em segundos.', 'premium', 'trial', L.addDias(hojeStr, 14));
  const eid = Number(e.lastInsertRowid);
  db.prepare('INSERT INTO usuarios (estabelecimento_id, nome, email, senha_hash) VALUES (?,?,?,?)').run(eid, 'Dono da Barbearia', EMAIL, L.hashSenha('demo12345'));

  const profs = [['Rafael', '#7c3aed', 40], ['Diego', '#0ea5e9', 35], ['Camila', '#ec4899', 45]].map(([nome, cor, com]) =>
    Number(db.prepare('INSERT INTO profissionais (estabelecimento_id, nome, cor, comissao_percent, horarios) VALUES (?,?,?,?,?)').run(eid, nome, cor, com, horarios).lastInsertRowid));
  const servs = [
    ['Corte masculino', 'Tesoura ou máquina, com acabamento na navalha.', 45, 45, [124, 58, 237], [0, 1, 2]],
    ['Barba completa', 'Toalha quente, óleo e finalização.', 35, 30, [30, 27, 46], [0, 1]],
    ['Corte + Barba', 'O combo completo com desconto.', 70, 75, [91, 33, 182], [0, 1]],
    ['Escova', 'Escova modelada com finalizador.', 60, 60, [236, 72, 153], [2]],
    ['Manicure', 'Esmaltação tradicional ou em gel.', 40, 45, [244, 114, 182], [2]],
    ['Limpeza de pele', 'Higienização profunda e hidratação.', 90, 60, [14, 165, 233], [2]],
  ].map(([nome, desc, preco, dur, cor, ps]) => {
    const id = Number(db.prepare('INSERT INTO servicos (estabelecimento_id, nome, descricao, preco, duracao_min, foto) VALUES (?,?,?,?,?,?)').run(eid, nome, desc, preco, dur, foto(eid, cor)).lastInsertRowid);
    ps.forEach((i) => db.prepare('INSERT INTO profissional_servicos VALUES (?,?)').run(profs[i], id));
    return { id, preco, dur, ps };
  });
  const nomes = ['João Silva', 'Pedro Alves', 'Lucas Costa', 'Marcos Lima', 'Ana Souza', 'Beatriz Rocha', 'Carlos Dias', 'Fernanda Melo', 'Gustavo Reis', 'Helena Prado'];
  const clientes = nomes.map((n, i) => Number(db.prepare('INSERT INTO clientes (estabelecimento_id, nome, telefone, criado_em) VALUES (?,?,?,datetime(\'now\', ?))')
    .run(eid, n, `(85) 9${8000 + i * 137}-${1000 + i * 91}`, `-${(i * 3) % 40} days`).lastInsertRowid));

  // histórico dos últimos 20 dias (concluídos), alguns cancelados, e agenda futura
  let sem = 7;
  const rnd = () => (sem = (sem * 9301 + 49297) % 233280) / 233280;
  for (let dia = -20; dia <= 10; dia++) {
    const d = L.addDias(hojeStr, dia);
    if (L.diaSemana(d) === 0) continue;
    const qtd = dia < 0 ? 4 + Math.floor(rnd() * 5) : 2 + Math.floor(rnd() * 4);
    for (let k = 0; k < qtd; k++) {
      const s = servs[Math.floor(rnd() * servs.length)];
      const prof = profs[s.ps[Math.floor(rnd() * s.ps.length)]];
      const h = 9 + Math.floor(rnd() * 8); const m = rnd() < 0.5 ? '00' : '30';
      const hora = `${String(h).padStart(2, '0')}:${m}`;
      const inicio = `${d} ${hora}`, fim = L.addMin(d, hora, s.dur);
      if (L.toMin(fim.slice(11)) > 19 * 60 || fim.slice(0, 10) !== d) continue;
      // evita sobreposição simples
      const bate = db.prepare("SELECT 1 FROM agendamentos WHERE profissional_id = ? AND inicio < ? AND fim > ?").get(prof, fim, inicio);
      if (bate) continue;
      const cli = clientes[Math.floor(rnd() * clientes.length)];
      let status = 'agendado', com = null, comv = null;
      const passado = inicio < L.agoraLocal('America/Fortaleza');
      if (passado) status = rnd() < 0.1 ? 'cancelado' : rnd() < 0.06 ? 'faltou' : 'concluido';
      else if (rnd() < 0.06) status = 'cancelado';
      const pr = db.prepare('SELECT comissao_percent FROM profissionais WHERE id = ?').get(prof).comissao_percent;
      if (status === 'concluido') { com = pr; comv = Math.round(s.preco * pr) / 100; }
      const ag = db.prepare("INSERT INTO agendamentos (estabelecimento_id, cliente_id, profissional_id, servico_id, inicio, fim, status, preco, comissao_percent, comissao_valor, origem, lembrete_enviado) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)")
        .run(eid, cli, prof, s.id, inicio, fim, status, s.preco, com, comv, rnd() < 0.4 ? 'online' : 'interno');
      if (status === 'concluido') {
        db.prepare("INSERT INTO lancamentos (estabelecimento_id, tipo, descricao, categoria, valor, data, agendamento_id) VALUES (?,?,?,?,?,?,?)")
          .run(eid, 'receita', `Atendimento #${ag.lastInsertRowid}`, 'Serviços', s.preco, d, ag.lastInsertRowid);
      }
    }
  }
  [['Aluguel do espaço', 'Fixas', 1200, -15], ['Produtos (pomadas, óleos)', 'Insumos', 380, -9], ['Energia e internet', 'Fixas', 260, -6], ['Material de limpeza', 'Insumos', 95, -3]]
    .forEach(([d, c, v, off]) => db.prepare("INSERT INTO lancamentos (estabelecimento_id, tipo, descricao, categoria, valor, data) VALUES (?,?,?,?,?,?)").run(eid, 'despesa', d, c, v, L.addDias(hojeStr, off)));
  db.prepare("INSERT INTO notificacoes (estabelecimento_id, tipo, titulo, mensagem) VALUES (?,?,?,?)").run(eid, 'agendamento', 'Novo agendamento online 📅', 'Ana Souza — Escova com Camila.');
  db.prepare("INSERT INTO notificacoes (estabelecimento_id, tipo, titulo, mensagem) VALUES (?,?,?,?)").run(eid, 'info', 'Bem-vindo ao AGENDA X! 🎉', 'Seu teste grátis de 14 dias começou.');
});
console.log('Demo criada. Login: demo@agendax.com / demo12345  — página pública: /agendar/barbearia-demo');
