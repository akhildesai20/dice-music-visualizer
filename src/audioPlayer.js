/**
 * Song, MIDI, and microphone input for one analyser.
 * Songs and MIDI pass through the gain control on the way to the speakers.
 * The analyser sits before that gain, so the volume slider does not change
 * detection. The microphone never reaches the speakers.
 */

import { isMidiFile, parseMidi } from './midi.js';

export function createAudioPlayer() {
  const audio = new Audio();
  audio.preload = 'auto';

  let ctx = null;
  let output = null;
  let analyser = null;
  let inputMix = null;
  let elementSource = null;
  let audibleGain = null;
  let midiGain = null;
  let midiFilter = null;
  let midiComp = null;
  let midiMakeup = null;
  let micGain = null;
  let micNode = null;
  let micStream = null;
  let noiseBuffer = null;

  let objectUrl = '';
  let fileName = '';
  let loaded = false;
  let kind = '';
  let sourceMode = 'song';
  let volume = 0.8;
  let audible = true;

  let midi = null;
  let midiCursor = 0;
  let songPos = 0;
  let playOrigin = 0;
  let midiRunning = false;
  let midiTimer = 0;
  let micLive = false;
  let micToken = 0;
  const voices = [];
  const endedHandlers = [];

  audio.addEventListener('ended', () => {
    if (kind === 'audio' && sourceMode === 'song') emitEnded();
  });

  function emitEnded() {
    for (const fn of endedHandlers) fn();
  }

  function ensureGraph() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    output = ctx.createGain();
    output.gain.value = volume;
    audibleGain = ctx.createGain();
    audibleGain.gain.value = 1;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.25;
    inputMix = ctx.createGain();
    midiGain = ctx.createGain();
    midiGain.gain.value = 0.45;
    midiFilter = ctx.createBiquadFilter();
    midiFilter.type = 'lowpass';
    midiFilter.frequency.value = 3800;
    midiFilter.Q.value = 0.7;
    midiComp = ctx.createDynamicsCompressor();
    midiComp.threshold.value = -20;
    midiComp.knee.value = 16;
    midiComp.ratio.value = 5;
    midiComp.attack.value = 0.008;
    midiComp.release.value = 0.22;
    midiMakeup = ctx.createGain();
    midiMakeup.gain.value = 2.6;
    micGain = ctx.createGain();
    micGain.gain.value = volume * 3;
    elementSource = ctx.createMediaElementSource(audio);
    elementSource.connect(inputMix);
    midiGain.connect(midiFilter);
    midiFilter.connect(midiComp);
    midiComp.connect(midiMakeup);
    midiMakeup.connect(inputMix);
    inputMix.connect(analyser);
    analyser.connect(audibleGain);
    audibleGain.connect(output);
    output.connect(ctx.destination);
    // A silent branch keeps the analyser running while the mic is muted.
    const keepAlive = ctx.createGain();
    keepAlive.gain.value = 0;
    analyser.connect(keepAlive);
    keepAlive.connect(ctx.destination);
  }

  function setAudible(on) {
    if (!audibleGain || audible === on) return;
    audible = on;
    audibleGain.gain.value = on ? 1 : 0;
  }

  function applyMicLevel() {
    if (micGain) micGain.gain.value = volume * 3;
  }

  function releaseMicHardware() {
    micLive = false;
    if (micStream) {
      for (const track of micStream.getTracks()) track.stop();
      micStream = null;
    }
    if (micNode) {
      try { micNode.disconnect(); } catch { /* already detached */ }
      micNode = null;
    }
    if (micGain && analyser) {
      try { micGain.disconnect(analyser); } catch { /* already detached */ }
    }
  }

  function stopMic() {
    micToken += 1;
    releaseMicHardware();
  }

  function silenceVoices() {
    if (!ctx) {
      voices.length = 0;
      return;
    }
    const t = ctx.currentTime;
    for (const voice of voices) {
      try {
        voice.gain.gain.cancelScheduledValues(t);
        voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), t);
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
        voice.source.stop(t + 0.04);
      } catch { /* already stopped */ }
    }
    voices.length = 0;
  }

  function placeCursor(time) {
    if (!midi) {
      midiCursor = 0;
      return;
    }
    let lo = 0;
    let hi = midi.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (midi.notes[mid].time < time) lo = mid + 1;
      else hi = mid;
    }
    midiCursor = lo;
  }

  function noise() {
    if (noiseBuffer) return noiseBuffer;
    const frames = Math.floor(ctx.sampleRate * 0.2);
    noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  function scheduleNote(note, when) {
    if (voices.length >= 28) {
      const oldest = voices.shift();
      try {
        oldest.gain.gain.cancelScheduledValues(when);
        oldest.gain.gain.setTargetAtTime(0.0001, when, 0.012);
        oldest.source.stop(when + 0.04);
      } catch { /* already stopped */ }
    }
    const vel = Math.max(0.08, Math.min(1, note.vel / 127));
    const gain = ctx.createGain();
    gain.connect(midiGain);
    const drum = note.channel === 9;
    let source;
    if (drum) {
      source = ctx.createBufferSource();
      source.buffer = noise();
      source.playbackRate.value = 0.35 + note.note / 80;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 180 + note.note * 36;
      filter.Q.value = 0.5;
      source.connect(filter);
      filter.connect(gain);
    } else {
      source = ctx.createOscillator();
      source.type = 'triangle';
      source.frequency.value = 440 * (2 ** ((note.note - 69) / 12));
      source.connect(gain);
    }
    const dur = Math.max(0.06, Math.min(note.dur, drum ? 0.16 : 8));
    const peak = (drum ? 0.34 : 0.28) * vel;
    const attack = drum ? 0.005 : 0.02;
    const release = drum ? 0.045 : Math.min(0.14, Math.max(0.04, dur * 0.3));
    const hold = when + Math.max(attack + 0.012, dur - release);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * (drum ? 0.25 : 0.7)), hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, hold + release);
    source.start(when);
    source.stop(hold + release + 0.02);
    const voice = { source, gain };
    voices.push(voice);
    source.onended = () => {
      const i = voices.indexOf(voice);
      if (i >= 0) voices.splice(i, 1);
    };
  }

  function midiPosition() {
    if (!midiRunning || !ctx) return songPos;
    return songPos + (ctx.currentTime - playOrigin);
  }

  function midiTick() {
    if (!midiRunning || !midi || !ctx) return;
    const pos = midiPosition();
    const horizon = pos + 0.28;
    while (midiCursor < midi.notes.length && midi.notes[midiCursor].time < horizon) {
      const note = midi.notes[midiCursor++];
      const when = playOrigin + (note.time - songPos);
      if (when >= ctx.currentTime - 0.03) scheduleNote(note, Math.max(when, ctx.currentTime));
    }
    if (pos >= midi.duration + 0.05) {
      midiRunning = false;
      songPos = midi.duration;
      silenceVoices();
      emitEnded();
      return;
    }
    midiTimer = window.setTimeout(midiTick, 70);
  }

  function pauseMidi(keepPosition) {
    if (midiRunning && ctx) songPos = midiPosition();
    midiRunning = false;
    window.clearTimeout(midiTimer);
    silenceVoices();
    if (!keepPosition) songPos = 0;
  }

  function clearSong() {
    audio.pause();
    pauseMidi(false);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    audio.removeAttribute('src');
    audio.load();
    midi = null;
    midiCursor = 0;
    songPos = 0;
    kind = '';
    loaded = false;
    fileName = '';
  }

  function loadFile(file) {
    ensureGraph();
    clearSong();
    sourceMode = 'song';
    stopMic();
    setAudible(true);
    fileName = file.name || 'Audio';
    if (isMidiFile(file)) {
      return file.arrayBuffer().then((buffer) => {
        midi = parseMidi(buffer);
        kind = 'midi';
        loaded = true;
        songPos = 0;
        placeCursor(0);
      });
    }
    objectUrl = URL.createObjectURL(file);
    kind = 'audio';
    audio.src = objectUrl;
    return new Promise((resolve, reject) => {
      const ok = () => { loaded = true; cleanup(); resolve(); };
      const bad = () => { loaded = false; cleanup(); reject(new Error('This file could not be decoded.')); };
      const cleanup = () => {
        audio.removeEventListener('loadedmetadata', ok);
        audio.removeEventListener('error', bad);
      };
      audio.addEventListener('loadedmetadata', ok);
      audio.addEventListener('error', bad);
      audio.load();
    });
  }

  function requestMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('This browser has no microphone input.'));
    }
    const audioConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: true };
    return navigator.mediaDevices.getUserMedia({ audio: audioConstraints }).catch((err) => {
      if (err && (err.name === 'OverconstrainedError' || err.name === 'NotSupportedError')) {
        return navigator.mediaDevices.getUserMedia({ audio: true });
      }
      throw err;
    });
  }

  async function startMic() {
    ensureGraph();
    const token = ++micToken;
    const pending = requestMic();
    if (ctx.state === 'suspended') await ctx.resume();
    audio.pause();
    pauseMidi(true);
    releaseMicHardware();
    let stream;
    try {
      stream = await pending;
    } catch (err) {
      const missing = err && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError');
      throw new Error(missing ? 'No microphone was found.' : 'Microphone permission was blocked.');
    }
    if (token !== micToken || sourceMode !== 'mic') {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    micStream = stream;
    micNode = ctx.createMediaStreamSource(micStream);
    applyMicLevel();
    micNode.connect(micGain);
    try { micGain.disconnect(analyser); } catch { /* first connection */ }
    micGain.connect(analyser);
    setAudible(false);
    micLive = true;
  }

  async function play() {
    ensureGraph();
    if (sourceMode === 'mic') return startMic();
    if (ctx.state === 'suspended') await ctx.resume();
    if (!loaded) return;
    setAudible(true);
    stopMic();
    if (kind === 'midi') {
      if (songPos >= midi.duration - 0.02) {
        songPos = 0;
        placeCursor(0);
      }
      playOrigin = ctx.currentTime;
      midiRunning = true;
      midiTick();
      return;
    }
    await audio.play();
  }

  function pause() {
    if (sourceMode === 'mic' || micLive) stopMic();
    audio.pause();
    pauseMidi(true);
  }

  function seek(t) {
    if (sourceMode === 'mic') return;
    if (kind === 'midi' && midi) {
      const next = Math.max(0, Math.min(midi.duration, t));
      const was = midiRunning;
      pauseMidi(true);
      songPos = next;
      placeCursor(next);
      if (was) {
        playOrigin = ctx.currentTime;
        midiRunning = true;
        midiTick();
      }
      return;
    }
    const dur = audio.duration;
    if (!Number.isFinite(dur)) return;
    audio.currentTime = Math.max(0, Math.min(dur, t));
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (output) output.gain.value = volume;
    applyMicLevel();
  }

  function setSource(mode) {
    const next = mode === 'mic' ? 'mic' : 'song';
    if (next === sourceMode) return;
    audio.pause();
    pauseMidi(true);
    sourceMode = next;
    if (next === 'mic') {
      stopMic();
      setAudible(false);
    } else {
      stopMic();
      setAudible(true);
    }
  }

  function remove() {
    const mic = sourceMode === 'mic';
    clearSong();
    if (mic) {
      stopMic();
      sourceMode = 'mic';
      setAudible(false);
    }
  }

  function onEnded(fn) {
    endedHandlers.push(fn);
  }

  function dispose() {
    pause();
    clearSong();
    stopMic();
    if (ctx) ctx.close();
  }

  return {
    loadFile,
    play,
    pause,
    seek,
    setVolume,
    setSource,
    remove,
    onEnded,
    dispose,
    get analyser() { return analyser; },
    get hasFile() { return loaded; },
    get name() { return fileName; },
    get kind() { return kind; },
    get source() { return sourceMode; },
    get playing() {
      if (sourceMode === 'mic') return micLive;
      if (kind === 'midi') return midiRunning;
      return loaded && !audio.paused && !audio.ended;
    },
    get currentTime() {
      if (sourceMode === 'mic') return 0;
      if (kind === 'midi') return midiPosition();
      return audio.currentTime || 0;
    },
    get duration() {
      if (sourceMode === 'mic') return 0;
      if (kind === 'midi' && midi) return midi.duration;
      return Number.isFinite(audio.duration) ? audio.duration : 0;
    }
  };
}

export function isAudioFile(file) {
  if (!file) return false;
  if (isMidiFile(file)) return false;
  if (file.type && file.type.startsWith('audio/')) return true;
  return /\.(mp3|wav|wave|ogg|m4a|aac|flac|webm)$/i.test(file.name || '');
}

export function isPlayableFile(file) {
  return isAudioFile(file) || isMidiFile(file);
}
