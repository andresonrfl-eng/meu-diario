// Exportação em PDF (biblioteca jsPDF carregada só quando for usada).
// As anotações ficam em texto de verdade (selecionável) e as fotos de páginas entram inteiras.

const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js';

const PAGE = { w: 210, h: 297, margin: 20 };
const REPLACEMENTS = [
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/[–—−]/g, '-'],
  [/…/g, '...'],
  [/[•●]/g, '-'],
  [/[   ]/g, ' '],
];

// As fontes padrão do PDF só têm o alfabeto latino: acentos do português funcionam;
// emojis e outros símbolos saem, em vez de virar caracteres estranhos.
export function pdfSafe(text) {
  let t = String(text ?? '').normalize('NFC').replace(/\r\n?/g, '\n');
  for (const [re, rep] of REPLACEMENTS) t = t.replace(re, rep);
  // eslint-disable-next-line no-control-regex
  t = t.replace(/[^\n\t\x20-\x7E¡-ÿ]/g, '');
  return t.replace(/[ \t]+$/gm, '').replace(/^[ \t]+$/gm, '');
}

let libPromise = null;
function loadJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSPDF_URL;
      s.onload = () => resolve(window.jspdf.jsPDF);
      s.onerror = () => { libPromise = null; s.remove(); reject(new Error('sem-biblioteca')); };
      document.head.append(s);
    });
  }
  return libPromise;
}

// entries: [{ title, content, whenText, moodText, pages: [nomes] }]
// getPage(nome) devolve Uint8Array com o JPEG, ou null se a foto não estiver disponível.
export async function buildPdf(jsPDF, entries, { getPage, onProgress } = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const width = PAGE.w - PAGE.margin * 2;
  const bottom = PAGE.h - PAGE.margin;
  let y = PAGE.margin;
  let missing = 0;

  const newPage = () => { doc.addPage(); y = PAGE.margin; };
  const lineHeight = (size, spacing = 1.45) => (size * spacing * 25.4) / 72;

  function write(text, { size = 12, style = 'normal', color = [40, 44, 40], after = 0 } = {}) {
    const clean = pdfSafe(text);
    if (!clean.trim()) return;
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const step = lineHeight(size);
    for (const line of doc.splitTextToSize(clean, width)) {
      if (y + step > bottom) newPage();
      doc.text(line, PAGE.margin, y + step * 0.75);
      y += step;
    }
    y += after;
  }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i > 0) newPage();
    write(e.whenText, { size: 10, style: 'bold', color: [95, 127, 107], after: 1.5 });
    if (e.title?.trim()) write(e.title.trim(), { size: 18, style: 'bold', after: 2 });
    if (e.moodText) write(`Humor: ${e.moodText}`, { size: 10, color: [110, 115, 110], after: 2 });
    y += 2;
    write(e.content || '');

    for (const name of e.pages || []) {
      const data = getPage ? await getPage(name) : null;
      if (!data) { missing += 1; continue; }
      newPage();
      const p = doc.getImageProperties(data);
      const scale = Math.min(width / p.width, (bottom - PAGE.margin) / p.height);
      doc.addImage(data, 'JPEG', PAGE.margin + (width - p.width * scale) / 2, PAGE.margin, p.width * scale, p.height * scale, undefined, 'FAST');
    }
    onProgress?.(i + 1, entries.length);
    // devolve o controle à tela de vez em quando, para o app não parecer travado
    if (i % 25 === 24) await new Promise((r) => setTimeout(r));
  }

  const total = doc.getNumberOfPages();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(140, 145, 140);
  for (let n = 1; n <= total; n++) {
    doc.setPage(n);
    doc.text(`${n} / ${total}`, PAGE.w / 2, PAGE.h - 10, { align: 'center' });
  }
  return { doc, missing };
}

export async function createPdf(entries, options) {
  const jsPDF = await loadJsPdf();
  return buildPdf(jsPDF, entries, options);
}
