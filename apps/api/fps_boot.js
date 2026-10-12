import { bindInput, keys } from './input.js';
import { spawn } from './entities.js';
import { connect } from './net.js';

const MAP = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1],
  [1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1],
  [1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1],
  [1, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0, 1],
  [1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1],
  [1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

export function boot() {
  bindInput();
  try {
    connect();
  } catch (err) {
    /* relay is optional */
  }
  try {
    spawn();
  } catch (err) {
    /* entities stub is optional */
  }
  const canvas =
    document.getElementById('gameCanvas') ||
    document.getElementById('game-canvas') ||
    document.querySelector('canvas');
  const start =
    document.getElementById('start-btn') ||
    document.querySelector('[data-start], #play-btn, #btn-start, #play-again-btn');
  if (!canvas || !canvas.getContext) return;
  canvas.tabIndex = 0;
  const ctx = canvas.getContext('2d');
  const hudHp = document.getElementById('health-text') || document.getElementById('health');
  const hudAmmo = document.getElementById('current-ammo') || document.getElementById('ammo');
  const hudScore = document.getElementById('score-blue') || document.getElementById('score');
  let yaw = 0;
  let x = 1.5;
  let y = 1.5;
  let hp = 100;
  let ammo = 30;
  let reserve = 90;
  let score = 0;
  let running = false;
  const enemies = [
    { x: 10.5, y: 2.5, hp: 40 },
    { x: 8.5, y: 7.5, hp: 40 },
    { x: 3.5, y: 10.5, hp: 40 },
  ];

  function blocked(px, py) {
    const tx = Math.floor(px);
    const ty = Math.floor(py);
    if (ty < 0 || tx < 0 || ty >= MAP.length || tx >= MAP[0].length) return true;
    return MAP[ty][tx] > 0;
  }

  if (blocked(x, y)) {
    outer: for (let ty = 1; ty < MAP.length - 1; ty++) {
      for (let tx = 1; tx < MAP[0].length - 1; tx++) {
        if (MAP[ty][tx] === 0) {
          x = tx + 0.5;
          y = ty + 0.5;
          break outer;
        }
      }
    }
  }

  canvas.addEventListener('click', () => {
    canvas.focus();
    if (canvas.requestPointerLock) canvas.requestPointerLock();
  });
  document.addEventListener('mousemove', (e) => {
    if (!running) return;
    const locked = document.pointerLockElement === canvas;
    if (!locked && e.buttons !== 1) return;
    yaw += (e.movementX || 0) * 0.0024;
  });
  document.addEventListener('mousedown', (e) => {
    if (!running || e.button !== 0) return;
    if (e.target === canvas || document.pointerLockElement === canvas) shoot();
  });

  function shoot() {
    if (ammo <= 0) return;
    ammo -= 1;
    const dx = Math.cos(yaw);
    const dy = Math.sin(yaw);
    for (let t = 0.2; t < 14; t += 0.12) {
      const hx = x + dx * t;
      const hy = y + dy * t;
      if (blocked(hx, hy)) break;
      for (const en of enemies) {
        if (en.hp <= 0) continue;
        const ddx = en.x - hx;
        const ddy = en.y - hy;
        if (ddx * ddx + ddy * ddy < 0.38) {
          en.hp -= 20;
          if (en.hp <= 0) score += 100;
          return;
        }
      }
    }
  }

  function move(dt) {
    let mx = 0;
    let mz = 0;
    if (keys.KeyW || keys.KeyArrowUp) mz += 1;
    if (keys.KeyS || keys.KeyArrowDown) mz -= 1;
    if (keys.KeyA || keys.KeyArrowLeft) mx -= 1;
    if (keys.KeyD || keys.KeyArrowRight) mx += 1;
    const sp = 2.8 * dt;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const nx = x + (c * mz - s * mx) * sp;
    const ny = y + (s * mz + c * mx) * sp;
    if (!blocked(nx, y)) x = nx;
    if (!blocked(x, ny)) y = ny;
    if (keys.KeyR) {
      const take = Math.min(30 - ammo, reserve);
      ammo += take;
      reserve -= take;
    }
  }

  function column(u, w, h, span) {
    const fov = Math.PI / 3;
    const ang = yaw - fov / 2 + (u / w) * fov;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let dist = 0;
    let hit = 0;
    let side = 0;
    let px = x;
    let py = y;
    for (let i = 0; i < 80; i++) {
      px += dx * 0.08;
      py += dy * 0.08;
      dist += 0.08;
      const tx = Math.floor(px);
      const ty = Math.floor(py);
      if (ty < 0 || tx < 0 || ty >= MAP.length || tx >= MAP[0].length) {
        hit = 1;
        break;
      }
      if (MAP[ty][tx] > 0) {
        hit = MAP[ty][tx];
        side = Math.abs(px - tx - 0.5) > Math.abs(py - ty - 0.5) ? 1 : 0;
        break;
      }
    }
    const z = Math.max(0.18, dist * Math.cos(ang - yaw));
    const wallH = Math.min(h, (h * 0.92) / z);
    const top = (h - wallH) / 2;
    const shade = side ? 0.62 : 1;
    const col = hit === 1 ? [72, 92, 70] : [110, 86, 70];
    ctx.fillStyle = `rgb(${col[0] * shade},${col[1] * shade},${col[2] * shade})`;
    ctx.fillRect(u, top, span, wallH);
    ctx.fillStyle = '#161310';
    ctx.fillRect(u, top + wallH, span, h);
    ctx.fillStyle = '#6d8494';
    ctx.fillRect(u, 0, span, top);
  }

  function drawSprites(w, h) {
    const fov = Math.PI / 3;
    for (const en of enemies) {
      if (en.hp <= 0) continue;
      const rx = en.x - x;
      const ry = en.y - y;
      const dist = Math.hypot(rx, ry);
      let ang = Math.atan2(ry, rx) - yaw;
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;
      if (Math.abs(ang) > fov / 1.35) continue;
      const z = Math.max(0.2, dist * Math.cos(ang));
      const size = Math.min(h, (h * 0.72) / z);
      const sx = w / 2 + (ang / fov) * w - size / 2;
      const sy = (h - size) / 2;
      ctx.fillStyle = '#c45c3e';
      ctx.fillRect(sx, sy, size * 0.42, size);
    }
  }

  function hud() {
    if (hudHp) hudHp.textContent = `${hp}`;
    if (hudAmmo) hudAmmo.textContent = `${ammo} / ${reserve}`;
    if (hudScore) hudScore.textContent = String(score);
  }

  let last = performance.now();
  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const w = canvas.width || 960;
    const h = canvas.height || 540;
    ctx.fillStyle = '#0d0c0b';
    ctx.fillRect(0, 0, w, h);
    const span = w > 700 ? 2 : 1;
    for (let u = 0; u < w; u += span) column(u, w, h, span);
    drawSprites(w, h);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(w / 2 - 8, h / 2, 16, 2);
    ctx.fillRect(w / 2, h / 2 - 8, 2, 16);
    move(dt);
    hud();
    requestAnimationFrame(loop);
  }

  function startGame() {
    running = true;
    const menu = document.getElementById('menu-overlay');
    if (menu) menu.classList.add('hidden');
    const hudEl = document.getElementById('hud-overlay');
    if (hudEl) hudEl.classList.remove('hidden');
    if (start) start.classList.add('hidden');
    canvas.classList.remove('hidden');
    canvas.focus();
    if (canvas.requestPointerLock) canvas.requestPointerLock();
    last = performance.now();
    requestAnimationFrame(loop);
  }
  window.startGame = startGame;
  if (start) start.addEventListener('click', startGame);
}

boot();
