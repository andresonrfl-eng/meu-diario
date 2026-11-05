// Aplica tema e tamanho de fonte antes da página aparecer (evita "piscar").
// Tema padrão: "dark" (Noite). "light" = Amanhecer. "auto" = segue o aparelho.
// (chave 'theme2' desde a v1.2.0: o visual novo começa no tema Noite para todos)
(function () {
  try {
    var t = localStorage.getItem('diario.theme2');
    if (t !== 'light' && t !== 'auto') t = 'dark';
    document.documentElement.setAttribute('data-theme', t);
    var f = parseInt(localStorage.getItem('diario.font'), 10);
    if (f >= 14 && f <= 34) document.documentElement.style.setProperty('--editor-font', f + 'px');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
