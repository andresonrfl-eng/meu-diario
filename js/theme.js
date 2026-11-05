// Aplica tema e tamanho de fonte antes da página aparecer (evita "piscar").
// Tema padrão: "light" (Dia). "dark" = Noite. "auto" = segue o aparelho.
// (chave 'theme3' desde a v1.3.0, visual "Calmo e natural": todos começam no tema Dia)
(function () {
  try {
    var t = localStorage.getItem('diario.theme3');
    if (t !== 'dark' && t !== 'auto') t = 'light';
    document.documentElement.setAttribute('data-theme', t);
    // Com PIN, o conteúdo começa escondido até desbloquear (js/lock.js).
    if (localStorage.getItem('diario.pin')) document.documentElement.classList.add('locked');
    var f = parseInt(localStorage.getItem('diario.font'), 10);
    if (f >= 14 && f <= 34) document.documentElement.style.setProperty('--editor-font', f + 'px');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
