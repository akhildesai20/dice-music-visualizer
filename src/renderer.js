/**
 * Instanced rounded-dice renderer.
 *
 * One mesh, one draw call for the field, plus a half-resolution bloom of the
 * pip emission. The reference path raymarched a full-screen pass per die;
 * that does not survive 1,600 cubes. The mesh is the same rounded-box SDF.
 */

import { DICE_VERT, DICE_FRAG, QUAD_VERT, BLUR_FRAG, COMPOSITE_FRAG } from './shaders.js';
import { createRoundedBox } from './geometry.js';
import { makeViewProj } from './math.js';

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || 'Shader compile failed');
  }
  return shader;
}

function link(gl, vertSrc, fragSrc) {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'Program link failed');
  }
  return program;
}

function makeColorTarget(gl, w, h, depth) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let depthRb = null;
  if (depth) {
    depthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
  }
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Framebuffer incomplete: ' + status);
  }
  return { tex, fbo, depth: depthRb, w, h };
}

function destroyTarget(gl, target) {
  if (!target) return;
  gl.deleteTexture(target.tex);
  gl.deleteFramebuffer(target.fbo);
  if (target.depth) gl.deleteRenderbuffer(target.depth);
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    premultipliedAlpha: false
  });
  if (!gl) throw new Error('WebGL2 is required.');

  const diceProg = link(gl, DICE_VERT, DICE_FRAG);
  const blurProg = link(gl, QUAD_VERT, BLUR_FRAG);
  const compProg = link(gl, QUAD_VERT, COMPOSITE_FRAG);

  const diceLoc = {
    viewProj: gl.getUniformLocation(diceProg, 'u_viewProj'),
    scale: gl.getUniformLocation(diceProg, 'u_scale'),
    time: gl.getUniformLocation(diceProg, 'u_time'),
    blinkRate: gl.getUniformLocation(diceProg, 'u_blinkRate'),
    brightness: gl.getUniformLocation(diceProg, 'u_brightness'),
    half: gl.getUniformLocation(diceProg, 'u_half'),
    pipOff: gl.getUniformLocation(diceProg, 'u_pipOff'),
    pipOn: gl.getUniformLocation(diceProg, 'u_pipOn'),
    glow: gl.getUniformLocation(diceProg, 'u_glow'),
    pass: gl.getUniformLocation(diceProg, 'u_pass'),
    elevAmp: gl.getUniformLocation(diceProg, 'u_elevAmp'),
    elevFreq: gl.getUniformLocation(diceProg, 'u_elevFreq'),
    pipActivity: gl.getUniformLocation(diceProg, 'u_pipActivity'),
    pipTransient: gl.getUniformLocation(diceProg, 'u_pipTransient'),
    illum: gl.getUniformLocation(diceProg, 'u_illum')
  };
  const blurLoc = {
    tex: gl.getUniformLocation(blurProg, 'uTex'),
    dir: gl.getUniformLocation(blurProg, 'uDir')
  };
  const compLoc = {
    bloom: gl.getUniformLocation(compProg, 'uBloom'),
    glow: gl.getUniformLocation(compProg, 'u_glow')
  };

  const mesh = createRoundedBox(10);
  const interleaved = new Float32Array(mesh.positions.length * 2);
  for (let i = 0; i < mesh.positions.length / 3; i++) {
    interleaved[i * 6] = mesh.positions[i * 3];
    interleaved[i * 6 + 1] = mesh.positions[i * 3 + 1];
    interleaved[i * 6 + 2] = mesh.positions[i * 3 + 2];
    interleaved[i * 6 + 3] = mesh.normals[i * 3];
    interleaved[i * 6 + 4] = mesh.normals[i * 3 + 1];
    interleaved[i * 6 + 5] = mesh.normals[i * 3 + 2];
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const meshBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf);
  gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

  const indexBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  const indexCount = mesh.indices.length;

  const dynBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
  gl.bufferData(gl.ARRAY_BUFFER, 8 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 0);
  gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 32, 16);
  gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 32, 28);
  gl.vertexAttribDivisor(4, 1);

  const staticBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf);
  gl.bufferData(gl.ARRAY_BUFFER, 6 * 4, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(5);
  gl.vertexAttribPointer(5, 3, gl.FLOAT, false, 24, 0);
  gl.vertexAttribDivisor(5, 1);
  gl.enableVertexAttribArray(6);
  gl.vertexAttribPointer(6, 3, gl.FLOAT, false, 24, 12);
  gl.vertexAttribDivisor(6, 1);

  gl.bindVertexArray(null);

  const quadVao = gl.createVertexArray();
  const quadBuf = gl.createBuffer();
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const viewProj = new Float32Array(16);
  let dyn = new Float32Array(8);
  let stat = new Float32Array(6);
  let instanceCount = 0;
  let cssW = 1;
  let cssH = 1;
  let bloomW = 1;
  let bloomH = 1;
  let emitTarget = null;
  let blurA = null;
  let blurB = null;
  let bg = [0, 0, 0];

  function allocInstances(count) {
    if (count === instanceCount) return;
    instanceCount = count;
    dyn = new Float32Array(count * 8);
    stat = new Float32Array(count * 6);
    gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
    gl.bufferData(gl.ARRAY_BUFFER, dyn.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf);
    gl.bufferData(gl.ARRAY_BUFFER, stat.byteLength, gl.STATIC_DRAW);
  }

  function syncStatic(state) {
    allocInstances(state.count);
    for (let i = 0; i < state.count; i++) {
      const o = i * 6;
      stat[o] = state.color[i * 3];
      stat[o + 1] = state.color[i * 3 + 1];
      stat[o + 2] = state.color[i * 3 + 2];
      stat[o + 3] = state.blinkPhase[i];
      stat[o + 4] = state.blinkFreq[i];
      stat[o + 5] = state.blinkSharp[i];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, stat);
  }

  function resize(width, height, dpr) {
    cssW = Math.max(1, width);
    cssH = Math.max(1, height);
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const nw = Math.max(1, bw >> 1);
    const nh = Math.max(1, bh >> 1);
    if (nw === bloomW && nh === bloomH && emitTarget) return;
    bloomW = nw;
    bloomH = nh;
    destroyTarget(gl, emitTarget);
    destroyTarget(gl, blurA);
    destroyTarget(gl, blurB);
    emitTarget = makeColorTarget(gl, bloomW, bloomH, true);
    blurA = makeColorTarget(gl, bloomW, bloomH, false);
    blurB = makeColorTarget(gl, bloomW, bloomH, false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function setBackground(rgb) {
    bg = rgb;
  }

  function drawDice(pass, state, time, appearance) {
    gl.useProgram(diceProg);
    gl.uniformMatrix4fv(diceLoc.viewProj, false, viewProj);
    gl.uniform1f(diceLoc.scale, state.cubeSize);
    gl.uniform1f(diceLoc.time, time);
    gl.uniform1f(diceLoc.blinkRate, appearance.blinkFrequency);
    gl.uniform1f(diceLoc.brightness, appearance.dotBrightness);
    gl.uniform1f(diceLoc.half, state.half);
    gl.uniform3fv(diceLoc.pipOff, appearance.pipOff);
    gl.uniform3fv(diceLoc.pipOn, appearance.pipOn);
    gl.uniform1f(diceLoc.glow, appearance.glow);
    gl.uniform1i(diceLoc.pass, pass);
    gl.uniform1f(diceLoc.elevAmp, appearance.elevAmp || 0);
    gl.uniform1f(diceLoc.elevFreq, appearance.elevFreq || 0.04);
    gl.uniform1f(diceLoc.pipActivity, appearance.pipActivity || 0);
    gl.uniform1f(diceLoc.pipTransient, appearance.pipTransient || 0);
    gl.uniform1f(diceLoc.illum, appearance.illum == null ? 1 : appearance.illum);
    gl.bindVertexArray(vao);
    gl.drawElementsInstanced(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0, state.count);
  }

  function draw(state, time, appearance) {
    if (!emitTarget) resize(cssW, cssH, 1);
    allocInstances(state.count);
    const half = state.half;
    for (let i = 0; i < state.count; i++) {
      const o = i * 8;
      const q = i * 4;
      dyn[o] = state.quat[q + 1];
      dyn[o + 1] = state.quat[q + 2];
      dyn[o + 2] = state.quat[q + 3];
      dyn[o + 3] = state.quat[q];
      dyn[o + 4] = state.x[i];
      dyn[o + 5] = state.y[i];
      dyn[o + 6] = half + state.hop[i];
      dyn[o + 7] = state.flash[i];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, dyn);

    makeViewProj(cssW, cssH, viewProj);

    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawDice(0, state, time, appearance);

    if (appearance.glow > 0.001) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, emitTarget.fbo);
      gl.viewport(0, 0, bloomW, bloomH);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawDice(1, state, time, appearance);

      const blurPx = 1.1 + appearance.glow * 1.35;
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(quadVao);
      gl.useProgram(blurProg);
      gl.uniform1i(blurLoc.tex, 0);
      gl.activeTexture(gl.TEXTURE0);

      gl.bindFramebuffer(gl.FRAMEBUFFER, blurA.fbo);
      gl.bindTexture(gl.TEXTURE_2D, emitTarget.tex);
      gl.uniform2f(blurLoc.dir, blurPx / bloomW, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, blurB.fbo);
      gl.bindTexture(gl.TEXTURE_2D, blurA.tex);
      gl.uniform2f(blurLoc.dir, 0, blurPx / bloomH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(compProg);
      gl.uniform1i(compLoc.bloom, 0);
      gl.uniform1f(compLoc.glow, appearance.glow);
      gl.bindTexture(gl.TEXTURE_2D, blurB.tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    }

    gl.bindVertexArray(null);
  }

  return {
    gl,
    resize,
    syncStatic,
    draw,
    setBackground,
    indexCount,
    vertexCount: mesh.positions.length / 3
  };
}
