// Aplica tema e tamanho de fonte antes da página aparecer (evita "piscar").
(function () {
  try {
    var t = localStorage.getItem('diario.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    var f = parseInt(localStorage.getItem('diario.font'), 10);
    if (f >= 14 && f <= 34) document.documentElement.style.setProperty('--editor-font', f + 'px');
  } catch (e) { /* armazenamento indisponível: usa o padrão */ }
})();
