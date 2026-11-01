/* Aparência da página pública: cores da marca e fundo. Usado na página dos clientes e na pré-visualização das Configurações. */
(function () {
  const PADRAO = { cor_principal: '#7c3aed', cor_secundaria: '#120d22', cor_destaque: '#a78bfa', fundo: { tipo: 'cor', cor: '#f5f3fb', tema: 'barbearia', imagem: '' } };
  const TEMAS = [
    { id: 'barbearia', nome: 'Barbearia', css: 'linear-gradient(135deg,#0f0f10,#2a2a2e)' },
    { id: 'dourado', nome: 'Dourado', css: 'linear-gradient(135deg,#1a1405,#7a5c14 60%,#d4a72c)' },
    { id: 'rosa', nome: 'Rosa suave', css: 'linear-gradient(135deg,#fdf2f8,#fbcfe8)' },
    { id: 'oceano', nome: 'Oceano', css: 'linear-gradient(135deg,#0c4a6e,#38bdf8)' },
    { id: 'natureza', nome: 'Natureza', css: 'linear-gradient(135deg,#052e16,#4ade80)' },
    { id: 'minimal', nome: 'Minimalista', css: 'linear-gradient(180deg,#ffffff,#f1f5f9)' },
  ];
  const PALETA = ['#ffffff', '#f1f5f9', '#e2e8f0', '#94a3b8', '#475569', '#1e293b', '#0f172a',
    '#fef2f2', '#fca5a5', '#ef4444', '#dc2626', '#991b1b', '#fff7ed', '#fed7aa',
    '#fb923c', '#f97316', '#ea580c', '#9a3412', '#fffbeb', '#fde68a', '#facc15',
    '#eab308', '#a16207', '#f0fdf4', '#86efac', '#4ade80', '#16a34a', '#14532d',
    '#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a', '#faf5ff', '#e9d5ff',
    '#a855f7', '#7c3aed', '#581c87', '#fff1f2', '#fecdd3', '#fb7185', '#e11d48',
    '#881337', '#ecfdf5', '#99f6e4', '#2dd4bf', '#0d9488', '#134e4a', '#000000'];
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (h, alvo, t) => { const a = rgb(h), b = rgb(alvo); return hex(a.map((v, i) => v + (b[i] - v) * t)); };
  const lum = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const tinta = (h) => (lum(h) > 0.45 ? '#171226' : '#ffffff');
  const mescla = (ap) => { const f = Object.assign({}, PADRAO.fundo, (ap && ap.fundo) || {}); return Object.assign({}, PADRAO, ap || {}, { fundo: f }); };
  function fundoCss(ap) {
    const f = mescla(ap).fundo;
    if (f.tipo === 'tema') { const t = TEMAS.find((x) => x.id === f.tema) || TEMAS[0]; return { background: t.css, fixo: true }; }
    if (f.tipo === 'imagem' && f.imagem) return { background: `linear-gradient(rgba(0,0,0,.28),rgba(0,0,0,.28)),url("${String(f.imagem).replace(/"/g, '')}") center/cover no-repeat`, fixo: true };
    return { background: f.cor, fixo: false };
  }
  function variaveis(ap) {
    const a = mescla(ap), p = a.cor_principal;
    return { '--p': p, '--p-600': mix(p, '#000000', 0.18), '--p-100': mix(p, '#ffffff', 0.86), '--p-50': mix(p, '#ffffff', 0.93), '--p-light': a.cor_destaque, '--pub-hd': a.cor_secundaria, '--pub-hd-ink': tinta(a.cor_secundaria) };
  }
  function aplicar(ap) {
    const v = variaveis(ap), r = document.documentElement.style;
    Object.keys(v).forEach((k) => r.setProperty(k, v[k]));
    const f = fundoCss(ap);
    document.body.style.background = f.background;
    document.body.style.backgroundAttachment = f.fixo ? 'fixed' : '';
  }
  window.AXA = { PADRAO, TEMAS, PALETA, mix, lum, tinta, mescla, fundoCss, variaveis, aplicar };
})();
