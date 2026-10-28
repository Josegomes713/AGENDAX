'use strict';
// Notificações push (Web Push + VAPID, RFC 8030/8291/8292) sem dependências, só com node:crypto.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

const b64u = (b) => Buffer.from(b).toString('base64url');

function carregarChaves(dataDir) {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    const pub = Buffer.from(process.env.VAPID_PUBLIC_KEY, 'base64url');
    return { publica: process.env.VAPID_PUBLIC_KEY, privada: jwkDe(pub, Buffer.from(process.env.VAPID_PRIVATE_KEY, 'base64url')) };
  }
  const arq = path.join(dataDir, 'vapid.json');
  try { const j = JSON.parse(fs.readFileSync(arq, 'utf8')); return { publica: j.publica, privada: jwkDe(Buffer.from(j.publica, 'base64url'), Buffer.from(j.d, 'base64url')) }; } catch (_) { /* gera */ }
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const publica = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]));
  try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(arq, JSON.stringify({ publica, d: jwk.d }), { mode: 0o600 }); } catch (_) { /* sem disco: chave vale só nesta execução */ }
  return { publica, privada: crypto.createPrivateKey({ key: jwk, format: 'jwk' }) };
}
function jwkDe(pub, d) {
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: b64u(d) }, format: 'jwk' });
}

function jwtVapid(chaves, endpoint, contato) {
  const aud = new URL(endpoint).origin;
  const cab = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corpo = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contato || 'mailto:contato@agendax.app' }));
  const assin = crypto.sign('sha256', Buffer.from(`${cab}.${corpo}`), { key: chaves.privada, dsaEncoding: 'ieee-p1363' });
  return `${cab}.${corpo}.${b64u(assin)}`;
}

// Criptografia aes128gcm (RFC 8291)
function criptografar(payload, p256dh, auth) {
  const uaPub = Buffer.from(p256dh, 'base64url'), segredoAuth = Buffer.from(auth, 'base64url');
  if (uaPub.length !== 65 || uaPub[0] !== 4 || segredoAuth.length < 16) throw new Error('Assinatura push inválida.');
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const segredo = ecdh.computeSecret(uaPub);
  const salt = crypto.randomBytes(16);
  const prk = Buffer.from(crypto.hkdfSync('sha256', segredo, segredoAuth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cifra = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const dados = Buffer.concat([cifra.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cifra.final(), cifra.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([65]), asPub, dados]);
}
// Inverso (usado nos testes)
function descriptografar(corpo, uaEcdh, auth) {
  const salt = corpo.subarray(0, 16), idlen = corpo[20], asPub = corpo.subarray(21, 21 + idlen), dados = corpo.subarray(21 + idlen);
  const segredo = uaEcdh.computeSecret(asPub);
  const uaPub = uaEcdh.getPublicKey(), segredoAuth = Buffer.from(auth, 'base64url');
  const prk = Buffer.from(crypto.hkdfSync('sha256', segredo, segredoAuth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(dados.subarray(dados.length - 16));
  const claro = Buffer.concat([d.update(dados.subarray(0, dados.length - 16)), d.final()]);
  return claro.subarray(0, claro.lastIndexOf(2)).toString();
}

function enviar(chaves, sub, payload, contato) {
  return new Promise((resolve) => {
    let corpo;
    try { corpo = criptografar(JSON.stringify(payload), sub.p256dh, sub.auth); } catch (e) { return resolve({ status: 400 }); }
    const u = new URL(sub.endpoint);
    if (u.protocol !== 'https:') return resolve({ status: 400 });
    const req = https.request({ method: 'POST', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, timeout: 10000, headers: {
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', 'Content-Length': corpo.length, TTL: '3600', Urgency: 'high',
      Authorization: `vapid t=${jwtVapid(chaves, sub.endpoint, contato)}, k=${chaves.publica}`,
    } }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0 }); });
    req.on('error', () => resolve({ status: 0 }));
    req.end(corpo);
  });
}

module.exports = { carregarChaves, jwtVapid, criptografar, descriptografar, enviar };
