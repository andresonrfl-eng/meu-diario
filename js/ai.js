// IA local no computador: pasta dos modelos, comunicação com o worker e ditado com Whisper.
import { isPhantomTranscript, isStopCommand } from './ai-text.js';

const IDLE_MS = 10 * 60 * 1000; // libera a memória da placa de vídeo quando a IA fica sem uso

// ---------- Disponibilidade ----------
let gpuCheck = null;
export function localAIAvailable() {
  if (!gpuCheck) {
    gpuCheck = (async () => {
      if (!('showDirectoryPicker' in window) || !navigator.gpu || !window.AudioWorkletNode) return false;
      try { return Boolean(await navigator.gpu.requestAdapter()); } catch { return false; }
    })();
  }
  return gpuCheck;
}

// ---------- Pasta dos modelos ----------
// O navegador guardaria os modelos no disco do sistema; aqui eles ficam numa pasta escolhida pelo usuário.
function folderDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('diario-ia', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kv(mode, fn) {
  const db = await folderDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export function savedFolder() {
  return kv('readonly', (s) => s.get('folder')).catch(() => null);
}
export async function chooseFolder() {
  const dir = await window.showDirectoryPicker({ id: 'diario-modelos', mode: 'readwrite', startIn: 'documents' });
  await kv('readwrite', (s) => s.put(dir, 'folder'));
  return dir;
}
export async function folderReady(dir) {
  const opts = { mode: 'readwrite' };
  if (await dir.queryPermission(opts) === 'granted') return true;
  return (await dir.requestPermission(opts)) === 'granted';
}

// ---------- Worker ----------
export function createLocalAI({ onProgress } = {}) {
  let worker = null;
  let folder = null;
  let nextId = 1;
  let idleTimer = null;
  const pending = new Map();
  const files = new Map();

  function fail(message) {
    for (const { reject } of pending.values()) reject(new Error(message));
    pending.clear();
  }
  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const msg = ev.data;
      if (msg.type === 'progress') {
        files.set(msg.file, msg);
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) { loaded += f.loaded || 0; total += f.total || 0; }
        onProgress?.({ model: msg.model, loaded, total });
        return;
      }
      const job = pending.get(msg.id);
      if (!job) return;
      pending.delete(msg.id);
      if (msg.ok) job.resolve(msg.result); else job.reject(new Error(msg.error));
    };
    worker.onerror = (ev) => { fail(ev.message || 'Falha na IA local'); shutdown(); };
    return worker;
  }
  function shutdown() {
    clearTimeout(idleTimer);
    worker?.terminate();
    worker = null;
    files.clear();
  }
  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!pending.size) shutdown(); else scheduleIdle(); }, IDLE_MS);
  }
  function call(type, payload, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ensureWorker().postMessage({ id, type, payload }, transfer);
      scheduleIdle();
    });
  }
  async function withFolder() {
    if (worker && folder) return;
    if (!folder) throw new Error('sem-pasta');
    await call('setFolder', { dir: folder });
  }

  return {
    async setFolder(dir) {
      folder = dir;
      shutdown();
      await call('setFolder', { dir });
    },
    async loadWhisper() { await withFolder(); files.clear(); return call('loadWhisper'); },
    async loadCorrector() { await withFolder(); files.clear(); return call('loadGemma'); },
    async transcribe(audio) { await withFolder(); return call('transcribe', { audio }, [audio.buffer]); },
    async correct(text) { await withFolder(); return call('correct', { text }); },
  };
}

// ---------- Ditado com Whisper ----------
const FRAME_MS = 100;
const SILENCE_END_MS = 800;
const PRE_ROLL_MS = 300;
const MIN_SPEECH_MS = 400;
const MAX_SEGMENT_MS = 25000; // o Whisper trabalha com janelas de 30 s

function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}
function concat(frames) {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) { out.set(f, at); at += f.length; }
  return out;
}

const NO_VOICE_WARNING_FRAMES = 100; // 10 s sem captar voz

export async function listMics() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput' && d.label && d.deviceId !== 'communications')
    .map((d) => ({ id: d.deviceId, label: d.label }));
}

// Sem indicar o aparelho, o Chrome pode escolher um microfone virtual mudo (ex.: Steam Streaming Microphone).
// Por isso sempre pede o escolhido nas Configurações ou, na falta dele, o padrão do sistema.
async function openMic(preferred) {
  const audio = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  for (const id of new Set([preferred, 'default'])) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: { exact: id } } });
    } catch (e) {
      if (e?.name !== 'OverconstrainedError' && e?.name !== 'NotFoundError') throw e;
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio });
}

function micName(track) {
  return track?.label?.match(/\(([^)]+)\)/)?.[1] || 'microfone';
}

export function createWhisperDictation({ ai, getMic, onFinal, onInterim, onStateChange, onError }) {
  let running = false;
  let micLabel = 'microfone';
  let framesWithoutVoice = 0;
  let heardVoice = false;
  let finishing = false;
  let ctx = null;
  let stream = null;
  let node = null;
  let inFlight = 0;
  let chain = Promise.resolve();
  let floor = 0.005;
  let preRoll = [];
  let segment = null; // { frames, voicedMs, silenceMs }

  function status() {
    if (inFlight) onInterim('✍️ Transcrevendo…');
    else if (running && framesWithoutVoice >= NO_VOICE_WARNING_FRAMES) {
      onInterim(`🔇 Não estou captando sua voz em "${micLabel}". Confira o microfone em ⚙ Configurações.`);
    } else if (running) onInterim(`🎧 Ouvindo (${micLabel})… pode falar.`);
    else onInterim('');
  }
  function settle() {
    if (finishing && !inFlight) {
      finishing = false;
      onInterim('');
      onStateChange(false);
    } else {
      status();
    }
  }
  function send(frames) {
    inFlight += 1;
    status();
    const audio = concat(frames);
    chain = chain
      .then(() => ai.transcribe(audio))
      .then((text) => {
        if (isStopCommand(text)) { api.stop(); return; }
        if (text && !isPhantomTranscript(text)) onFinal(text);
      })
      .catch((e) => {
        console.warn('Falha ao transcrever', e);
        onError('model');
        if (running) api.stop();
      })
      .finally(() => { inFlight -= 1; settle(); });
  }
  function closeSegment() {
    const s = segment;
    segment = null;
    if (s && s.voicedMs >= MIN_SPEECH_MS) send(s.frames);
  }
  function onFrame(frame) {
    if (!running) return;
    const level = rms(frame);
    const threshold = Math.max(0.012, floor * 3);
    const voiced = level > threshold;
    if (!voiced) floor = floor * 0.95 + level * 0.05;
    if (voiced) {
      const wasWarning = framesWithoutVoice >= NO_VOICE_WARNING_FRAMES;
      framesWithoutVoice = 0;
      heardVoice = true;
      if (wasWarning) status();
    } else if (!heardVoice) { // pausas para pensar depois de já ter falado não geram aviso
      framesWithoutVoice += 1;
      if (framesWithoutVoice === NO_VOICE_WARNING_FRAMES) status();
    }
    if (!segment) {
      preRoll.push(frame);
      if (preRoll.length * FRAME_MS > PRE_ROLL_MS) preRoll.shift();
      if (voiced) {
        segment = { frames: preRoll, voicedMs: FRAME_MS, silenceMs: 0 };
        preRoll = [];
      }
      return;
    }
    segment.frames.push(frame);
    if (voiced) { segment.voicedMs += FRAME_MS; segment.silenceMs = 0; }
    else segment.silenceMs += FRAME_MS;
    if (segment.silenceMs >= SILENCE_END_MS || segment.frames.length * FRAME_MS >= MAX_SEGMENT_MS) closeSegment();
  }
  function releaseMic() {
    node?.port && (node.port.onmessage = null);
    node?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
    node = null; stream = null; ctx = null;
  }

  const api = {
    async start() {
      if (running || finishing) return;
      running = true;
      onStateChange(true);
      try {
        stream = await openMic(getMic?.() || 'default');
        if (!running) { releaseMic(); return; }
        micLabel = micName(stream.getAudioTracks()[0]);
        framesWithoutVoice = 0;
        heardVoice = false;
        // Pedir 16 kHz faz o navegador converter o áudio para o formato que o Whisper usa.
        ctx = new AudioContext({ sampleRate: 16000 });
        if (ctx.state === 'suspended') await ctx.resume();
        await ctx.audioWorklet.addModule(new URL('./mic-worklet.js', import.meta.url));
        if (!running) { releaseMic(); return; }
        const source = ctx.createMediaStreamSource(stream);
        node = new AudioWorkletNode(ctx, 'mic-capture');
        node.port.onmessage = (ev) => onFrame(ev.data);
        source.connect(node);
        status();
      } catch (e) {
        running = false;
        releaseMic();
        onInterim('');
        onStateChange(false);
        onError(e?.name === 'NotAllowedError' ? 'not-allowed' : e?.name === 'NotFoundError' ? 'audio-capture' : 'start');
      }
    },
    // Termina o que já foi falado antes de desligar.
    stop() {
      if (!running) return;
      running = false;
      finishing = true;
      closeSegment();
      preRoll = [];
      releaseMic();
      settle();
    },
    get active() { return running || finishing; },
  };
  return api;
}
