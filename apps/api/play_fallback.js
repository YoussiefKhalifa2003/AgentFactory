(function () {
  if (window.__deskGame) return;
  window.__deskGame = true;

  var canvas = document.getElementById("gameCanvas") || document.querySelector("canvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var TILE = 64;
  var MAP = 16;
  var FOV = Math.PI / 3;
  var keys = Object.create(null);
  var mouse = { locked: false };
  var running = false;
  var paused = false;
  var last = 0;
  var shake = 0;
  var bob = 0;
  var score = 0;
  var wave = 1;
  var anim = 0;

  var player = {
    x: 2.5 * TILE,
    y: 2.5 * TILE,
    a: 0,
    hp: 100,
    ammo: 30,
    reserve: 90,
    cool: 0,
    reload: 0
  };
  var map = [];
  var foes = [];
  var parts = [];
  var pickups = [];

  function el(id) {
    return document.getElementById(id);
  }
  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value;
  }
  function hide(node) {
    if (!node) return;
    node.classList.remove("active");
    node.classList.add("hidden");
  }
  function show(node) {
    if (!node) return;
    node.classList.remove("hidden");
    node.classList.add("active");
  }
  function hideMenus() {
    [
      "menu-start",
      "menu-pause",
      "menu-gameover",
      "start-screen",
      "game-over-screen",
      "pause-screen"
    ].forEach(function (id) {
      hide(el(id));
    });
    document.querySelectorAll(".menu, .screen, .overlay").forEach(hide);
  }
  function resize() {
    var box = (canvas.parentElement || document.body).getBoundingClientRect();
    var w = Math.max(640, Math.floor(box.width) || window.innerWidth || 800);
    var h = Math.max(480, Math.floor(box.height) || window.innerHeight || 600);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
  function dist(ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function cell(x, y) {
    var cx = Math.floor(x / TILE);
    var cy = Math.floor(y / TILE);
    if (cx < 0 || cy < 0 || cx >= MAP || cy >= MAP) return 1;
    return map[cy][cx];
  }
  function blocked(x, y) {
    return cell(x, y) !== 0;
  }
  function buildMap() {
    map = [];
    var y, x, row;
    for (y = 0; y < MAP; y += 1) {
      row = [];
      for (x = 0; x < MAP; x += 1) {
        if (x === 0 || y === 0 || x === MAP - 1 || y === MAP - 1) row.push(1);
        else if ((x % 5 === 0 && y % 4 === 0) || (x === 8 && y > 4 && y < 12)) row.push(2);
        else if (Math.random() < 0.08) row.push(3);
        else row.push(0);
      }
      map.push(row);
    }
    for (y = 1; y < 4; y += 1) {
      for (x = 1; x < 4; x += 1) map[y][x] = 0;
    }
  }
  function emptySpot(minDist) {
    var n = 0;
    while (n < 80) {
      var x = 1 + Math.floor(Math.random() * (MAP - 2));
      var y = 1 + Math.floor(Math.random() * (MAP - 2));
      if (map[y][x] === 0) {
        var px = x * TILE + TILE / 2;
        var py = y * TILE + TILE / 2;
        if (dist(player.x, player.y, px, py) >= (minDist || 180)) return { x: px, y: py };
      }
      n += 1;
    }
    return { x: (MAP - 3) * TILE, y: (MAP - 3) * TILE };
  }
  function spawnWave(n) {
    foes = [];
    pickups = [];
    var count = 3 + n * 2;
    var i;
    for (i = 0; i < count; i += 1) {
      var p = emptySpot(220);
      foes.push({
        x: p.x,
        y: p.y,
        hp: 40 + n * 12,
        speed: 1.4 + n * 0.15,
        hit: 0,
        kind: Math.random() > 0.75 ? "heavy" : "scout"
      });
    }
    for (i = 0; i < 2; i += 1) {
      p = emptySpot(140);
      pickups.push({
        x: p.x,
        y: p.y,
        kind: Math.random() > 0.5 ? "health" : "ammo",
        live: true
      });
    }
    wave = n;
    hud();
  }
  function hud() {
    var hf = el("health-fill");
    if (hf) hf.style.width = Math.max(0, player.hp) + "%";
    setText("health-text", String(Math.max(0, Math.floor(player.hp))));
    setText("ammo-count", String(player.ammo));
    setText("ammo-reserve", String(player.reserve));
    setText("score-display", "SCORE: " + score);
    setText("wave-display", "WAVE: " + wave);
    setText("weapon-name", player.reload > 0 ? "RELOADING" : "PLASMA RIFLE");
    var sf = el("shield-fill");
    if (sf) sf.style.width = "0%";
  }
  function feed(msg) {
    var box = el("kill-feed");
    if (!box) return;
    var row = document.createElement("div");
    row.className = "kill-msg";
    row.textContent = msg;
    box.appendChild(row);
    setTimeout(function () {
      row.remove();
    }, 2400);
  }
  function burst(x, y, color, n) {
    var i;
    for (i = 0; i < n; i += 1) {
      parts.push({
        x: x,
        y: y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6,
        life: 0.35 + Math.random() * 0.25,
        color: color
      });
    }
  }
  function hurt(amount) {
    player.hp -= amount;
    shake = 8;
    var overlay = el("damage-overlay");
    if (overlay) {
      overlay.style.borderColor = "rgba(255,0,60,0.85)";
      setTimeout(function () {
        overlay.style.borderColor = "transparent";
      }, 120);
    }
    hud();
    if (player.hp <= 0) gameOver();
  }
  function gameOver() {
    running = false;
    paused = false;
    setText("final-score", "Score: " + score);
    show(el("menu-gameover") || el("game-over-screen"));
    try {
      document.exitPointerLock();
    } catch (err) {}
  }
  function startGame() {
    resize();
    running = true;
    paused = false;
    score = 0;
    wave = 1;
    player.x = 2.5 * TILE;
    player.y = 2.5 * TILE;
    player.a = 0;
    player.hp = 100;
    player.ammo = 30;
    player.reserve = 90;
    player.cool = 0;
    player.reload = 0;
    parts = [];
    buildMap();
    spawnWave(1);
    hideMenus();
    hud();
    try {
      canvas.requestPointerLock();
    } catch (err) {}
    if (!anim) loop(performance.now());
  }
  function togglePause() {
    if (!running) return;
    paused = !paused;
    var pane = el("menu-pause") || el("pause-screen");
    if (paused) {
      show(pane);
      try {
        document.exitPointerLock();
      } catch (err) {}
    } else {
      hide(pane);
      try {
        canvas.requestPointerLock();
      } catch (err) {}
    }
  }
  function tryReload() {
    if (player.reload > 0 || player.ammo >= 30 || player.reserve <= 0) return;
    player.reload = 1.2;
  }
  function shoot() {
    if (!running || paused || player.reload > 0 || player.cool > 0) return;
    if (player.ammo <= 0) {
      tryReload();
      return;
    }
    player.ammo -= 1;
    player.cool = 0.12;
    hud();
    var cos = Math.cos(player.a);
    var sin = Math.sin(player.a);
    var hit = null;
    var best = 1e9;
    foes.forEach(function (e) {
      if (e.hp <= 0) return;
      var dx = e.x - player.x;
      var dy = e.y - player.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var ang = Math.atan2(dy, dx) - player.a;
      while (ang < -Math.PI) ang += Math.PI * 2;
      while (ang > Math.PI) ang -= Math.PI * 2;
      if (Math.abs(ang) < 0.12 && d < best && d < 900) {
        var wall = cast(player.x, player.y, cos, sin);
        if (d < wall) {
          best = d;
          hit = e;
        }
      }
    });
    var marker = el("hit-marker");
    if (hit) {
      hit.hp -= 34;
      burst(hit.x, hit.y, "#ff003c", 8);
      if (marker) {
        marker.classList.remove("hidden");
        setTimeout(function () {
          marker.classList.add("hidden");
        }, 120);
      }
      if (hit.hp <= 0) {
        score += hit.kind === "heavy" ? 150 : 100;
        feed("Hostile down");
        hud();
      }
    } else {
      var w = cast(player.x, player.y, cos, sin);
      burst(player.x + cos * Math.min(w, 400), player.y + sin * Math.min(w, 400), "#dff", 4);
    }
  }
  function cast(x, y, cos, sin) {
    var i;
    for (i = 0; i < 18 * TILE; i += 4) {
      if (blocked(x + cos * i, y + sin * i)) return i;
    }
    return 18 * TILE;
  }
  function update(dt) {
    if (!running || paused) return;
    var speed = keys.ShiftLeft ? 4.6 : 3.1;
    var mx = 0;
    var my = 0;
    if (keys.KeyW || keys.ArrowUp) {
      mx += Math.cos(player.a) * speed;
      my += Math.sin(player.a) * speed;
    }
    if (keys.KeyS || keys.ArrowDown) {
      mx -= Math.cos(player.a) * speed;
      my -= Math.sin(player.a) * speed;
    }
    if (keys.KeyA) {
      mx += Math.cos(player.a - Math.PI / 2) * speed;
      my += Math.sin(player.a - Math.PI / 2) * speed;
    }
    if (keys.KeyD) {
      mx += Math.cos(player.a + Math.PI / 2) * speed;
      my += Math.sin(player.a + Math.PI / 2) * speed;
    }
    if (keys.ArrowLeft || keys.KeyQ) player.a -= 0.045;
    if (keys.ArrowRight || keys.KeyE) player.a += 0.045;
    var nx = player.x + mx;
    var ny = player.y + my;
    if (!blocked(nx, player.y)) player.x = nx;
    if (!blocked(player.x, ny)) player.y = ny;
    if (mx || my) bob += dt * 12;
    if (player.cool > 0) player.cool -= dt;
    if (player.reload > 0) {
      player.reload -= dt;
      if (player.reload <= 0) {
        var need = 30 - player.ammo;
        var take = Math.min(need, player.reserve);
        player.ammo += take;
        player.reserve -= take;
        hud();
      }
    }
    if (keys.KeyR) tryReload();
    if (shake > 0) shake -= dt * 20;
    var live = 0;
    foes.forEach(function (e) {
      if (e.hp <= 0) return;
      live += 1;
      var d = dist(player.x, player.y, e.x, e.y);
      if (d < 520) {
        var ang = Math.atan2(player.y - e.y, player.x - e.x);
        var spd = e.speed * (e.kind === "heavy" ? 0.7 : 1);
        var ex = e.x + Math.cos(ang) * spd;
        var ey = e.y + Math.sin(ang) * spd;
        if (!blocked(ex, e.y)) e.x = ex;
        if (!blocked(e.x, ey)) e.y = ey;
      }
      if (d < 42 && performance.now() - e.hit > 800) {
        e.hit = performance.now();
        hurt(e.kind === "heavy" ? 14 : 9);
      }
    });
    if (live === 0 && foes.length) {
      wave += 1;
      spawnWave(wave);
      feed("Wave " + wave);
    }
    pickups.forEach(function (pk) {
      if (!pk.live) return;
      if (dist(player.x, player.y, pk.x, pk.y) < 28) {
        pk.live = false;
        if (pk.kind === "health") player.hp = Math.min(100, player.hp + 28);
        else player.reserve += 24;
        hud();
      }
    });
    var i;
    for (i = parts.length - 1; i >= 0; i -= 1) {
      parts[i].x += parts[i].vx;
      parts[i].y += parts[i].vy;
      parts[i].life -= dt;
      if (parts[i].life <= 0) parts.splice(i, 1);
    }
  }
  function wallColor(kind, shade) {
    var c =
      kind === 3 ? [0, 210, 255] : kind === 2 ? [180, 40, 220] : [70, 80, 120];
    var k = Math.max(0.18, 1 - shade);
    return (
      "rgb(" +
      Math.floor(c[0] * k) +
      "," +
      Math.floor(c[1] * k) +
      "," +
      Math.floor(c[2] * k) +
      ")"
    );
  }
  function draw() {
    resize();
    var w = canvas.width;
    var h = canvas.height;
    var ox = (Math.random() - 0.5) * shake;
    var oy = Math.sin(bob) * 3 + (Math.random() - 0.5) * shake;
    ctx.fillStyle = "#12122a";
    ctx.fillRect(0, 0, w, h / 2);
    ctx.fillStyle = "#070712";
    ctx.fillRect(0, h / 2, w, h / 2);
    var col;
    var step = Math.max(2, Math.floor(w / 280));
    for (col = 0; col < w; col += step) {
      var ang = player.a - FOV / 2 + (col / w) * FOV;
      var cos = Math.cos(ang);
      var sin = Math.sin(ang);
      var d = 0;
      var hit = 0;
      var side = 0;
      var px = player.x;
      var py = player.y;
      while (d < 16 * TILE) {
        d += 4;
        var wx = px + cos * d;
        var wy = py + sin * d;
        hit = cell(wx, wy);
        if (hit) {
          side = Math.abs(wx / TILE - Math.floor(wx / TILE) - 0.5) >
            Math.abs(wy / TILE - Math.floor(wy / TILE) - 0.5)
            ? 1
            : 0;
          break;
        }
      }
      var corr = d * Math.cos(ang - player.a);
      var wallH = Math.min(h * 1.8, (TILE * 1.15 * h) / Math.max(8, corr));
      ctx.fillStyle = wallColor(hit, d / (12 * TILE) + side * 0.18);
      ctx.fillRect(col + ox, (h - wallH) / 2 + oy, step + 1, wallH);
    }
    var sprites = foes
      .filter(function (e) {
        return e.hp > 0;
      })
      .concat(
        pickups.filter(function (p) {
          return p.live;
        })
      );
    sprites.sort(function (a, b) {
      return dist(player.x, player.y, b.x, b.y) - dist(player.x, player.y, a.x, a.y);
    });
    sprites.forEach(function (s) {
      var dx = s.x - player.x;
      var dy = s.y - player.y;
      var ang = Math.atan2(dy, dx) - player.a;
      while (ang < -Math.PI) ang += Math.PI * 2;
      while (ang > Math.PI) ang -= Math.PI * 2;
      if (Math.abs(ang) > FOV) return;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (cast(player.x, player.y, Math.cos(player.a + ang), Math.sin(player.a + ang)) < d - 8)
        return;
      var size = Math.min(h, (TILE * 1.4 * h) / Math.max(20, d));
      var sx = w / 2 + (ang / FOV) * w - size / 2 + ox;
      var sy = h / 2 - size / 2 + oy;
      ctx.fillStyle = s.kind === "ammo" ? "#00f3ff" : s.kind === "health" ? "#0aff00" : s.kind === "heavy" ? "#ff5a7a" : "#ff003c";
      ctx.fillRect(sx, sy, size * 0.7, size);
      if (s.hp) {
        ctx.fillStyle = "#0aff00";
        ctx.fillRect(sx, sy - 8, size * 0.7 * Math.max(0, s.hp / (40 + wave * 12)), 4);
      }
    });
    parts.forEach(function (p) {
      var dx = p.x - player.x;
      var dy = p.y - player.y;
      var ang = Math.atan2(dy, dx) - player.a;
      while (ang < -Math.PI) ang += Math.PI * 2;
      while (ang > Math.PI) ang -= Math.PI * 2;
      if (Math.abs(ang) > FOV) return;
      var d = Math.sqrt(dx * dx + dy * dy);
      var sx = w / 2 + (ang / FOV) * w;
      var sy = h / 2;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillRect(sx, sy, 3, 3);
      ctx.globalAlpha = 1;
    });
    ctx.strokeStyle = "rgba(255,0,255,0.8)";
    ctx.beginPath();
    ctx.moveTo(w / 2 - 8, h / 2);
    ctx.lineTo(w / 2 + 8, h / 2);
    ctx.moveTo(w / 2, h / 2 - 8);
    ctx.lineTo(w / 2, h / 2 + 8);
    ctx.stroke();
  }
  function loop(now) {
    anim = requestAnimationFrame(loop);
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    update(dt);
    draw();
  }
  function bind(id, fn) {
    var node = el(id);
    if (!node || node.getAttribute("data-desk-game")) return;
    node.setAttribute("data-desk-game", "1");
    node.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
  }

  window.startGame = startGame;
  window.endGame = gameOver;
  window.togglePause = togglePause;
  window.init = startGame;

  bind("btn-start", startGame);
  bind("start-btn", startGame);
  bind("play-btn", startGame);
  bind("btn-retry", startGame);
  bind("restart-btn", startGame);
  bind("btn-restart", startGame);
  bind("btn-resume", togglePause);
  bind("resume-btn", togglePause);
  document.querySelectorAll("button").forEach(function (btn) {
    if (btn.getAttribute("data-desk-game")) return;
    var blob = ((btn.id || "") + " " + (btn.textContent || "")).toLowerCase();
    btn.setAttribute("data-desk-game", "1");
    if (/resume/.test(blob)) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        togglePause();
      });
    } else if (/start|retry|initialize|play|reboot/.test(blob)) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        startGame();
      });
    } else {
      btn.removeAttribute("data-desk-game");
    }
  });

  window.addEventListener("keydown", function (e) {
    keys[e.code] = true;
    if (e.code === "Space" || e.code.indexOf("Arrow") === 0) e.preventDefault();
    if (e.code === "KeyP") {
      if (running) togglePause();
    }
  });
  window.addEventListener("keyup", function (e) {
    keys[e.code] = false;
  });
  canvas.addEventListener("click", function () {
    if (!running) {
      startGame();
      return;
    }
    if (paused) return;
    try {
      canvas.requestPointerLock();
    } catch (err) {}
    shoot();
  });
  document.addEventListener("pointerlockchange", function () {
    mouse.locked = document.pointerLockElement === canvas;
  });
  document.addEventListener("mousemove", function (e) {
    if (running && !paused && mouse.locked) player.a += e.movementX * 0.0022;
  });
  window.addEventListener("resize", resize);
  resize();
  draw();
})();
