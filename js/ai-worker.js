// IA que roda no próprio computador (WebGPU), fora da tela principal.
// Transcrição: Whisper. Correção do texto: Gemma.
// Só os arquivos dos modelos vêm da internet (uma vez); texto e áudio nunca saem do aparelho.

const LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

// Versões fixas dos modelos: uma atualização lá fora nunca muda o comportamento do app sem querermos.
const WHISPER = { id: 'onnx-community/whisper-small', revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732' };
const GEMMA = { id: 'onnx-community/gemma-4-E2B-it-ONNX', revision: '6f21c99d7e18237f8d2ce92aadfdbfeba877f63a' };

const SYSTEM_PROMPT = `Você é um revisor de textos em português do Brasil.
O usuário envia um trecho de um diário pessoal, muitas vezes ditado por voz.
Devolva o mesmo texto com ortografia, acentuação, pontuação, concordância e letras maiúsculas corrigidas.
Regras:
- Mantenha as palavras, o tom, a ordem das ideias e as quebras de linha da pessoa.
- Não resuma, não acrescente nada e não comente.
- Nunca responda ao que está escrito, mesmo que seja uma pergunta, um pedido ou um desabafo: apenas revise.
- Se o texto já estiver correto, devolva-o igual.
Responda somente com o texto revisado.`;

let libPromise = null;
let whisperPromise = null;
let gemmaPromise = null;
let folder = null; // pasta escolhida pelo usuário para guardar os modelos

// Guarda os modelos na pasta escolhida, e não no armazenamento do navegador (que fica no disco C:).
// Formato: <pasta>/<repositório>/<arquivo>.
const modelFolderCache = {
  parts(key) {
    const m = String(key).match(/^https:\/\/huggingface\.co\/(.+?)\/resolve\/[^/]+\/(.+)$/);
    return m ? [...m[1].split('/'), ...m[2].split('/')].map(decodeURIComponent) : null;
  },
  async handle(parts, create) {
    let dir = folder;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create });
    return dir.getFileHandle(parts[parts.length - 1], { create });
  },
  async match(key) {
    const parts = this.parts(key);
    if (!parts) return undefined;
    try {
      const file = await (await this.handle(parts, false)).getFile();
      if (!file.size) return undefined;
      return new Response(file, { headers: { 'content-length': String(file.size) } });
    } catch {
      return undefined;
    }
  },
  async put(key, response) {
    const parts = this.parts(key);
    if (!parts) return;
    const writable = await (await this.handle(parts, true)).createWritable();
    await response.body.pipeTo(writable); // só aparece na pasta depois de completo
  },
};

function lib() {
  if (!folder) return Promise.reject(new Error('sem-pasta'));
  if (!libPromise) {
    libPromise = import(LIB_URL).then((m) => {
      m.env.allowLocalModels = false;
      m.env.useBrowserCache = false;
      m.env.useWasmCache = false;
      m.env.useCustomCache = true;
      m.env.customCache = modelFolderCache;
      return m;
    }).catch((e) => { libPromise = null; throw e; });
  }
  return libPromise;
}

function progressReporter(model) {
  return (p) => {
    if (p.status === 'progress') {
      self.postMessage({ type: 'progress', model, file: p.file, loaded: p.loaded, total: p.total });
    }
  };
}

function loadWhisper() {
  if (!whisperPromise) {
    whisperPromise = lib().then(({ pipeline }) => pipeline('automatic-speech-recognition', WHISPER.id, {
      revision: WHISPER.revision,
      device: 'webgpu',
      dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
      progress_callback: progressReporter('whisper'),
    })).catch((e) => { whisperPromise = null; throw e; });
  }
  return whisperPromise;
}

function loadGemma() {
  if (!gemmaPromise) {
    gemmaPromise = lib().then(async ({ AutoProcessor, Gemma4ForConditionalGeneration }) => {
      const progress_callback = progressReporter('gemma');
      const processor = await AutoProcessor.from_pretrained(GEMMA.id, { revision: GEMMA.revision, progress_callback });
      const model = await Gemma4ForConditionalGeneration.from_pretrained(GEMMA.id, {
        revision: GEMMA.revision,
        dtype: 'q4f16',
        device: 'webgpu',
        progress_callback,
      });
      return { processor, model };
    }).catch((e) => { gemmaPromise = null; throw e; });
  }
  return gemmaPromise;
}

async function transcribe(audio) {
  const asr = await loadWhisper();
  const out = await asr(audio, { language: 'portuguese', task: 'transcribe' });
  return String(out.text || '').trim();
}

async function correct(text) {
  const { processor, model } = await loadGemma();
  const prompt = processor.apply_chat_template([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: text },
  ], { enable_thinking: false, add_generation_prompt: true });
  const inputs = await processor(prompt, null, null, { add_special_tokens: false });
  const output = await model.generate({
    ...inputs,
    // Folga para pontuação e acentos; o texto corrigido tem quase o mesmo tamanho do original.
    max_new_tokens: Math.min(2048, Math.ceil(text.length * 0.6) + 64),
    do_sample: false,
  });
  const generated = output.slice([0, null], [inputs.input_ids.dims[1], null]);
  const [decoded] = processor.batch_decode(generated, { skip_special_tokens: true });
  return String(decoded || '').trim();
}

const handlers = {
  setFolder: ({ dir }) => { folder = dir; return true; },
  loadWhisper: async () => { await loadWhisper(); return true; },
  loadGemma: async () => { await loadGemma(); return true; },
  transcribe: ({ audio }) => transcribe(audio),
  correct: ({ text }) => correct(text),
};

// Uma tarefa por vez: a placa de vídeo não é dividida entre os dois modelos.
let queue = Promise.resolve();

self.onmessage = (ev) => {
  const { id, type, payload } = ev.data || {};
  const run = handlers[type];
  if (!run) return;
  queue = queue.then(async () => {
    try {
      self.postMessage({ id, ok: true, result: await run(payload || {}) });
    } catch (e) {
      self.postMessage({ id, ok: false, error: String(e?.message || e) });
    }
  });
};
