/**
 * Standard MIDI file reader.
 * Turns a .mid file into timed notes so a small synth can play them
 * into the same analyser as an audio file. Tick-per-quarter files only.
 */

function readVarLen(view, offset, end) {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    if (offset >= end) throw new Error('This MIDI file is incomplete.');
    const byte = view.getUint8(offset++);
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, offset };
  }
  throw new Error('This MIDI file has a bad time value.');
}

function text(view, offset, length) {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

export function isMidiFile(file) {
  if (!file) return false;
  const type = (file.type || '').toLowerCase();
  if (type === 'audio/midi' || type === 'audio/mid' || type === 'audio/x-midi') return true;
  return /\.(mid|midi)$/i.test(file.name || '');
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {{ duration:number, notes:Array<{time:number,dur:number,note:number,vel:number,channel:number}> }}
 */
export function parseMidi(buffer) {
  const view = new DataView(buffer);
  const end = view.byteLength;
  if (end < 14 || text(view, 0, 4) !== 'MThd') {
    throw new Error('This file is not a MIDI song.');
  }
  const headerLen = view.getUint32(4);
  const format = view.getUint16(8);
  const trackCount = view.getUint16(10);
  const division = view.getUint16(12);
  if (division & 0x8000) {
    throw new Error('This MIDI time format is not supported.');
  }
  const ticksPerBeat = division || 480;
  let offset = 8 + headerLen;

  const tempoMarks = [{ tick: 0, uspq: 500000 }];
  /** @type {Array<{tick:number,channel:number,note:number,vel:number,on:boolean}>} */
  const raw = [];

  for (let track = 0; track < trackCount && offset + 8 <= end; track++) {
    if (text(view, offset, 4) !== 'MTrk') break;
    const trackLen = view.getUint32(offset + 4);
    const trackEnd = Math.min(end, offset + 8 + trackLen);
    offset += 8;
    let tick = 0;
    let status = 0;

    while (offset < trackEnd) {
      const delta = readVarLen(view, offset, trackEnd);
      offset = delta.offset;
      tick += delta.value;
      if (offset >= trackEnd) break;
      let byte = view.getUint8(offset);
      if (byte & 0x80) {
        status = byte;
        offset++;
      } else if (!status) {
        throw new Error('This MIDI file has a bad event.');
      }

      if (status === 0xff) {
        if (offset >= trackEnd) break;
        const type = view.getUint8(offset++);
        const len = readVarLen(view, offset, trackEnd);
        offset = len.offset;
        if (type === 0x51 && len.value >= 3 && offset + 3 <= trackEnd) {
          const uspq = (view.getUint8(offset) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset + 2);
          tempoMarks.push({ tick, uspq: uspq || 500000 });
        }
        offset += len.value;
        if (type === 0x2f) break;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const len = readVarLen(view, offset, trackEnd);
        offset = len.offset + len.value;
        continue;
      }

      const kind = status & 0xf0;
      const channel = status & 0x0f;
      const needed = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
      if (offset + needed > trackEnd) break;
      const data0 = view.getUint8(offset++);
      const data1 = needed === 2 ? view.getUint8(offset++) : 0;
      if (kind === 0x90) raw.push({ tick, channel, note: data0, vel: data1, on: data1 > 0 });
      else if (kind === 0x80) raw.push({ tick, channel, note: data0, vel: 0, on: false });
    }
    offset = trackEnd;
  }

  if (format > 1) throw new Error('This MIDI file uses an unsupported layout.');

  tempoMarks.sort((a, b) => a.tick - b.tick);
  const unique = [];
  for (const mark of tempoMarks) {
    const prev = unique[unique.length - 1];
    if (prev && prev.tick === mark.tick) prev.uspq = mark.uspq;
    else unique.push({ tick: mark.tick, uspq: mark.uspq });
  }

  function secondsAt(tick) {
    let lastTick = 0;
    let seconds = 0;
    let uspq = 500000;
    for (const mark of unique) {
      if (mark.tick >= tick) break;
      seconds += ((mark.tick - lastTick) / ticksPerBeat) * (uspq / 1000000);
      lastTick = mark.tick;
      uspq = mark.uspq;
    }
    seconds += ((tick - lastTick) / ticksPerBeat) * (uspq / 1000000);
    return seconds;
  }

  raw.sort((a, b) => a.tick - b.tick || (a.on === b.on ? 0 : a.on ? -1 : 1));
  const held = new Map();
  const notes = [];
  for (const event of raw) {
    const key = `${event.channel}:${event.note}`;
    if (event.on) {
      held.set(key, event);
    } else {
      const start = held.get(key);
      held.delete(key);
      if (!start) continue;
      const time = secondsAt(start.tick);
      const dur = Math.max(0.03, secondsAt(event.tick) - time);
      notes.push({
        time,
        dur,
        note: start.note,
        vel: start.vel,
        channel: start.channel
      });
    }
  }
  const tail = secondsAt(raw.length ? raw[raw.length - 1].tick : 0);
  for (const start of held.values()) {
    const time = secondsAt(start.tick);
    notes.push({
      time,
      dur: Math.max(0.2, tail - time),
      note: start.note,
      vel: start.vel,
      channel: start.channel
    });
  }
  notes.sort((a, b) => a.time - b.time);
  if (!notes.length) throw new Error('This MIDI file has no notes.');
  let duration = 0;
  for (const note of notes) duration = Math.max(duration, note.time + note.dur);
  return { duration, notes };
}
