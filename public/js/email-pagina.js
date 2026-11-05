(function () {
  const ok = new URLSearchParams(location.search).get('r') === 'ok';
  document.getElementById('t').textContent = ok ? 'E-mail confirmado ✅' : 'Link inválido ou expirado';
  document.getElementById('m').textContent = ok ? 'Obrigado! Agora você também pode recuperar sua senha por e-mail.' : 'Entre no app e toque em "Reenviar e-mail" para receber um link novo.';
})();
