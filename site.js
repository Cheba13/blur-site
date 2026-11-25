// stage-effects.js
;(() => {
  // Дым на первом экране (WebGL). Холст маленький и растягивается CSS —
  // туман мягкий, поэтому это незаметно, зато очень дёшево для видеокарты.
  // Рисуется не чаще 30 раз в секунду и только пока первый экран виден.
  // Курсор (или медленно блуждающий «прожектор» на телефоне) подсвечивает дым
  // и раздвигает его; при прокрутке дым поднимается и заполняет экран.
  const stage = document.querySelector('.hero-sticky');
  const hero = stage.closest('.hero-scroll');
  const smoke = stage.querySelector('.stage-smoke');
  const screening = document.querySelector('#screening');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

  const vertex = `
    attribute vec2 position;
    varying mediump vec2 uv;
    void main() {
      uv = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }`;

  const fragment = `
    precision mediump float;
    uniform float clock;
    uniform float swell;
    uniform float ratio;
    uniform vec2 pointer;
    uniform float hover;
    varying mediump vec2 uv;

    float hash(vec2 p) {
      p = mod(p, 289.0);
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
      return v;
    }

    void main() {
      float t = mod(clock, 600.0);
      vec2 p = vec2(uv.x * ratio, uv.y);
      vec2 cursor = vec2(pointer.x * ratio, pointer.y);
      vec2 d = p - cursor;
      float r2 = dot(d, d);
      // Курсор раздвигает дым
      float push = hover * exp(-r2 * 10.0);
      p += d * push * 0.9;

      // Клубы поднимаются вверх, закручиваясь
      vec2 q = vec2(fbm(p * 1.5 + vec2(0.0, -t * 0.11)),
                    fbm(p * 1.5 + vec2(5.2, -t * 0.09)));
      vec2 r = vec2(fbm(p * 2.2 + q * 2.4 + vec2(1.7 - t * 0.05, 9.2 - t * 0.15)),
                    fbm(p * 2.2 + q * 2.4 + vec2(8.3 + t * 0.04, 2.8 - t * 0.13)));
      float n = fbm(p * 1.9 + r * 1.7 + vec2(0.0, -t * 0.19));

      // Плотнее у пола; с прокруткой дым поднимается и затягивает экран
      float ceiling = 0.42 + swell * 0.85;
      float floorFog = 1.0 - smoothstep(ceiling - 0.42, ceiling + 0.08, uv.y + (q.x - 0.5) * 0.3);
      float density = smoothstep(0.38, 0.86, n) * floorFog;
      density += smoothstep(0.5, 0.95, n) * swell * 0.7;
      density *= 1.0 - push * 0.75;

      // Свет: тёплый справа, холодный слева, плюс луч у курсора
      float side = smoothstep(0.15, 0.95, uv.x + (r.x - 0.5) * 0.7);
      vec3 color = mix(vec3(0.42, 0.40, 0.70), vec3(0.86, 0.66, 0.52), side);
      float beam = hover * exp(-r2 * 3.2);
      color = color * (0.55 + 0.7 * n) + vec3(1.0, 0.92, 0.82) * beam * 0.75;
      float alpha = clamp(density * (0.7 + swell * 0.25) + beam * density * 0.35, 0.0, 0.88);
      gl_FragColor = vec4(color * alpha, alpha);
    }`;

  const smooth = (a, b, value) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  function createSmoke() {
    const gl = smoke.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('WebGL unavailable');
    const program = gl.createProgram();
    [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]].forEach(([kind, code]) => {
      const shader = gl.createShader(kind);
      gl.shaderSource(shader, code);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    });
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    const position = gl.getAttribLocation(program, 'position');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const u = name => gl.getUniformLocation(program, name);
    const uniforms = { clock: u('clock'), swell: u('swell'), ratio: u('ratio'), pointer: u('pointer'), hover: u('hover') };
    return {
      resize() {
        const w = stage.clientWidth, h = Math.max(1, stage.clientHeight);
        const scale = w < 700 ? 0.42 : 0.3;
        const width = Math.round(Math.min(440, Math.max(150, w * scale)));
        const height = Math.round(Math.min(360, Math.max(120, h * scale)));
        if (smoke.width !== width || smoke.height !== height) { smoke.width = width; smoke.height = height; }
        gl.viewport(0, 0, width, height);
        gl.uniform1f(uniforms.ratio, w / h);
      },
      draw(time, swell, px, py, hover) {
        if (gl.isContextLost()) return;
        gl.uniform1f(uniforms.clock, time);
        gl.uniform1f(uniforms.swell, swell);
        gl.uniform2f(uniforms.pointer, px, py);
        gl.uniform1f(uniforms.hover, hover);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    };
  }

  let fog = null;
  let visible = true;
  let progress = 0;
  let clock = 0;
  let previous = 0;
  let frame = 0;
  // Положение «прожектора» в координатах холста (0..1, y снизу вверх)
  let px = 0.62, py = 0.35, tx = 0.62, ty = 0.35, hover = 0.35, targetHover = 0.35;
  let lastPointer = 0;
  const paused = () => motion.matches || stage.classList.contains('is-paused') || screening.open;

  function wake() {
    if (!frame && fog && visible && !document.hidden) frame = requestAnimationFrame(draw);
  }

  function draw(now) {
    frame = 0;
    if (!fog || !visible || document.hidden) return;
    const still = paused();
    if (still || !previous || now - previous >= 33) {
      const dt = previous ? Math.min(66, now - previous) / 1000 : 0;
      previous = still ? 0 : now;
      if (!still) clock += dt;
      // Без мыши (или на телефоне) свет медленно блуждает сам
      if (!finePointer.matches || now - lastPointer > 2500) {
        tx = 0.5 + 0.32 * Math.sin(clock * 0.21);
        ty = 0.34 + 0.16 * Math.sin(clock * 0.33 + 1.3);
        targetHover = 0.4;
      }
      const ease = 1 - Math.exp(-dt * 6);
      px += (tx - px) * ease;
      py += (ty - py) * ease;
      hover += (targetHover - hover) * ease;
      const shown = still ? 0 : progress;
      fog.draw(clock, smooth(0.08, 0.7, shown), px, py, hover);
    }
    if (!still) wake();
  }

  stage.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    const box = stage.getBoundingClientRect();
    tx = (event.clientX - box.left) / box.width;
    ty = 1 - (event.clientY - box.top) / box.height;
    targetHover = 1;
    lastPointer = performance.now();
    wake();
  }, { passive: true });
  stage.addEventListener('pointerleave', () => { lastPointer = 0; });
  stage.addEventListener('blur:frame', ({ detail }) => { progress = detail; wake(); });

  smoke.addEventListener('webglcontextlost', () => { fog = null; smoke.hidden = true; });
  document.addEventListener('visibilitychange', () => { previous = 0; wake(); });
  document.addEventListener('screeningchange', wake);
  motion.addEventListener('change', wake);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; previous = 0; wake(); }).observe(hero);

  try { fog = createSmoke(); } catch { fog = null; }
  if (fog) {
    new ResizeObserver(() => { fog?.resize(); wake(); }).observe(stage);
    fog.resize();
    wake();
  } else {
    smoke.hidden = true;
  }
})();

// editions.js
;(() => {
  if (!('IntersectionObserver' in window)) return;

  const motionOff = matchMedia('(prefers-reduced-motion: reduce)');
  const intro = document.querySelector('.hero-intro');
  if (!motionOff.matches) {
    requestAnimationFrame(() => intro.classList.add('cut-in'));
  }

  for (const id of ['projects', 'pasha', 'artists', 'services', 'formats', 'weddings', 'voices', 'contact']) {
    const section = document.getElementById(id);
    if (!section) continue;
    section.classList.add('has-signal');
    section.dataset.liveCut = '';
    if (id === 'weddings' || section.querySelector('.signal-type')) continue;
    const accent = section.querySelector('h2 em');
    if (!accent) continue;
    accent.classList.add('signal-type', 'cut-word');
    accent.dataset.signal = accent.textContent.trim();
  }

  const shots = [...document.querySelectorAll('.cast-card, .live-grid .film')];
  shots.forEach((shot, index) => {
    const frame = shot.querySelector('.cast-photo, .film-image');
    const glare = document.createElement('span');
    glare.className = 'shot-light';
    glare.setAttribute('aria-hidden', 'true');
    frame.append(glare);
    shot.style.setProperty('--shot-delay', `${(index % 3) * 55}ms`);
    shot.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch' || motionOff.matches) return;
      const bounds = frame.getBoundingClientRect();
      shot.style.setProperty('--aim-x', `${100 * (event.clientX - bounds.left) / bounds.width}%`);
      shot.style.setProperty('--aim-y', `${100 * (event.clientY - bounds.top) / bounds.height}%`);
    }, { passive: true });
  });

  const chapterEntrance = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const element = entry.target;
      if (element.hasAttribute('data-wedding-reveal')) {
        element.classList.add('wedding-in');
      } else if (element.hasAttribute('data-live-cut')) {
        element.classList.add('cut-in');
      }
      observer.unobserve(element);
    }
  }, { threshold: 0.14 });

  document.querySelectorAll('[data-live-cut], [data-wedding-reveal], .cast-card, .live-grid .film').forEach(element => {
    if (element.hasAttribute('data-wedding-reveal')) {
      element.classList.add('wedding-reveal-ready');
    }
    chapterEntrance.observe(element);
  });

  if (motionOff.matches) return;

  const framesByHost = new Map();
  // Кадры раскрываются «шторкой» снизу, картинка внутри плавно отъезжает.
  // Заголовки разделов проявляются из размытия — как наводка на резкость.
  const reveal = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      observer.unobserve(el);
      if (el.classList.contains('fi')) { el.classList.add('fi-in'); continue; }
      // Следим за карточкой вокруг кадра: полностью закрытый шторкой кадр браузер «не видит».
      const frame = framesByHost.get(el);
      if (!frame) continue;
      frame.classList.add('mr-in');
      const delay = parseFloat(frame.style.getPropertyValue('--mr-delay')) || 0;
      setTimeout(() => frame.classList.remove('mr', 'mr-in'), 1900 + delay);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

  document.querySelectorAll('.film-image, .work-frame, .cast-photo, .portrait > img:first-child, .photo-grid .project-media')
    .forEach((el, i) => {
      const host = el.parentElement;
      if (framesByHost.has(host)) return;
      framesByHost.set(host, el);
      el.classList.add('mr');
      el.style.setProperty('--mr-delay', `${(i % 3) * 90}ms`);
      reveal.observe(host);
    });
  document.querySelectorAll('main section:not(#home) h2').forEach(h => {
    if (h.closest('[data-wedding-reveal]')) return;
    h.classList.add('fi');
    reveal.observe(h);
  });

  // Бегущая строка останавливается, когда её не видно.
  const marquee = document.querySelector('.works-marquee');
  if (marquee) new IntersectionObserver(([e]) => marquee.classList.toggle('is-off', !e.isIntersecting)).observe(marquee);
})();

// archive.js
;(() => {
  const modal = document.querySelector('#screening');
  const player = modal.querySelector('video');
  let origin;

  document.querySelectorAll('[data-film]').forEach(link => link.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !modal.showModal) return;
    event.preventDefault(); origin = link;
    const title = link.dataset.film;
    modal.querySelector('h3').textContent = title;
    player.setAttribute('aria-label', title); player.poster = link.querySelector('img').src; player.src = link.href;
    modal.showModal(); document.dispatchEvent(new Event('screeningchange')); document.body.style.overflow = 'hidden'; player.play().catch(() => {});
  }));
  modal.querySelector('button').addEventListener('click', () => modal.close());
  modal.addEventListener('click', event => { if (event.target !== modal) return; const r=modal.getBoundingClientRect(); if (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) modal.close(); });
  modal.addEventListener('close', () => { player.pause(); player.removeAttribute('src'); player.load(); document.body.style.overflow = ''; origin?.focus({preventScroll:true}); document.dispatchEvent(new Event('screeningchange')); });

  // Превью при наведении: ролик подгружается только когда на него навели мышь.
  const canHover = matchMedia('(hover: hover) and (pointer: fine)');
  document.querySelectorAll('[data-preview]').forEach(video => {
    const host = video.closest('a');
    host.addEventListener('pointerenter', () => {
      if (!canHover.matches) return;
      if (!video.src) video.src = video.dataset.preview;
      video.currentTime = 0;
      video.play().then(() => host.classList.add('is-previewing')).catch(() => {});
    });
    host.addEventListener('pointerleave', () => { video.pause(); host.classList.remove('is-previewing'); });
  });
})();

// script.js
;document.documentElement.classList.add('js');
const menu=document.querySelector('.menu-button'),nav=document.querySelector('#navigation');
menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',open);menu.setAttribute('aria-label',open?'Закрыть меню':'Открыть меню');nav.classList.toggle('open',open);});
nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('open');menu.setAttribute('aria-expanded','false');}));
const reveals=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');reveals.unobserve(e.target);}}),{threshold:.08});document.querySelectorAll('.reveal').forEach(e=>reveals.observe(e));
const assets = {
  'film-set': ['film-set', 'backstage-blue', 'camera-work'],
  'live-stage': ['live-stage', 'live-desk'],
  'live-screen': ['editorial/stage-feed', 'editorial/interview'],
  hockey: ['editorial/hockey-a', 'editorial/hockey-b'],
};
const gallery=document.querySelector('#gallery');let photos=[],index=0,opener;
function showPhoto(){gallery.querySelector('img').src=`assets/${photos[index]}.jpg`;gallery.querySelector('img').alt=`Съёмочная площадка BLUR — фотография ${index+1}`;document.querySelector('#gallery-count').textContent=`${String(index+1).padStart(2,'0')} / ${String(photos.length).padStart(2,'0')}`;}
document.querySelectorAll('[data-gallery]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();opener=b;photos=assets[b.dataset.gallery];index=0;showPhoto();gallery.showModal();document.body.style.overflow='hidden';}));
function next(d){index=(index+d+photos.length)%photos.length;showPhoto();}gallery.querySelector('.gallery-next').addEventListener('click',()=>next(1));gallery.querySelector('.gallery-prev').addEventListener('click',()=>next(-1));gallery.querySelector('.gallery-close').addEventListener('click',()=>gallery.close());gallery.addEventListener('close',()=>{document.body.style.overflow='';opener?.focus();});gallery.addEventListener('click',e=>{if(e.target===gallery){const r=gallery.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)gallery.close();}});gallery.addEventListener('keydown',e=>{if(e.key==='ArrowRight')next(1);if(e.key==='ArrowLeft')next(-1);});
document.querySelectorAll('[data-service]').forEach(a=>a.addEventListener('click',()=>{document.querySelector('textarea').value=a.dataset.service+'\n';}));
document.querySelector('#brief-form').addEventListener('submit',async e=>{e.preventDefault();const data=new FormData(e.target);const text=`Заявка на съёмку BLUR\nИмя: ${data.get('name')}\nКонтакт: ${data.get('contact')}\nПроект: ${data.get('message')||'Обсудим детали'}`;const status=document.querySelector('#form-status');try{await navigator.clipboard.writeText(text);status.textContent='Текст заявки скопирован. Заявка ещё не отправлена.';}catch{const blob=new Blob([text],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='BLUR-заявка.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Заявка сохранена в файл. Она ещё не отправлена.';}});

// hero-motion.js
;(() => {
  // Первый экран: видео + текст по центру. При прокрутке текст уходит из фокуса,
  // видео приближается, а раздел «Наши работы» наезжает сверху (см. hero.css).
  const hero = document.querySelector('#home');
  const stage = hero.querySelector('.hero-sticky');
  const film = hero.querySelector('#scene-film');
  const intro = hero.querySelector('.hero-intro');
  const grade = hero.querySelector('.hero-grade');
  const finder = hero.querySelector('.hero-viewfinder');
  const timecode = hero.querySelector('.vf-tc');
  const timeline = hero.querySelector('.hero-timeline span');
  const toggle = hero.querySelector('#motion-toggle');
  const screening = document.querySelector('#screening');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const smooth = (position, start, end) => {
    const t = clamp((position - start) / (end - start));
    return t * t * (3 - 2 * t);
  };

  let visible = true;
  let paused = reducedMotion.matches;
  let frame = 0;
  let progress = 0;
  let previous = 0;
  let clockTimer = 0;
  const started = performance.now();
  const KICK_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll'];
  let kickArmed = false;

  function observeFilm() {
    if (paused || !visible || document.hidden || screening.open) {
      film.pause();
    } else {
      film.muted = true;
      film.play().catch(() => {
        // Некоторые браузеры (особенно внутри фрейма Craftum) не дают видео стартовать само —
        // тогда запускаем его при первом касании, прокрутке или нажатии клавиши.
        updateControl();
        if (kickArmed) return;
        kickArmed = true;
        const kick = () => {
          kickArmed = false;
          KICK_EVENTS.forEach(type => removeEventListener(type, kick));
          if (!paused && visible && !document.hidden && !screening.open) film.play().catch(() => {});
        };
        KICK_EVENTS.forEach(type => addEventListener(type, kick, { passive: true }));
      });
    }
    runClock();
  }

  function updateControl() {
    const play = paused || film.paused;
    toggle.innerHTML = play
      ? '<span aria-hidden="true">▶</span> Включить видео'
      : '<span aria-hidden="true">Ⅱ</span> Пауза';
  }

  // Тайм-код видоискателя: обновляется 12 раз в секунду, только пока экран виден.
  const pad = n => String(Math.floor(n)).padStart(2, '0');
  function tick() {
    const s = (performance.now() - started) / 1000;
    timecode.textContent = `${pad(s / 3600)}:${pad(s / 60 % 60)}:${pad(s % 60)}:${pad(s * 24 % 24)}`;
  }
  function runClock() {
    const on = !paused && visible && !document.hidden;
    if (on && !clockTimer) clockTimer = setInterval(tick, 84);
    if (!on && clockTimer) { clearInterval(clockTimer); clockTimer = 0; }
  }

  function wake() {
    if (frame || !visible || document.hidden) return;
    frame = requestAnimationFrame(draw);
  }

  function draw(now) {
    frame = 0;
    if (!visible || document.hidden) return;

    const elapsed = previous ? Math.min(now - previous, 40) : 16;
    previous = now;
    const distance = Math.max(1, hero.offsetHeight - stage.offsetHeight);
    const target = paused ? 0 : clamp(-hero.getBoundingClientRect().top / distance);
    progress = Math.abs(target - progress) < 0.002
      ? target
      : progress + (target - progress) * (1 - Math.exp(-elapsed / 60));

    const out = smooth(progress, 0.02, 0.4);
    intro.style.opacity = String(1 - out);
    intro.style.filter = out > 0.002 ? `blur(${(out * 16).toFixed(2)}px)` : '';
    intro.style.transform = out > 0.002 ? `translateY(${(-60 * out).toFixed(1)}px) scale(${(1 + 0.07 * out).toFixed(4)})` : '';
    intro.inert = out > 0.95;

    film.style.transform = `scale(${(1 + 0.16 * smooth(progress, 0, 1)).toFixed(4)})`;
    grade.style.opacity = String(1 - 0.35 * smooth(progress, 0.25, 0.7));
    finder.style.opacity = String(0.6 * (1 - out));
    finder.style.transform = `scale(${(1 - 0.05 * out).toFixed(4)})`;
    timeline.style.transform = `scaleX(${progress.toFixed(4)})`;
    stage.dispatchEvent(new CustomEvent('blur:frame', { detail: progress }));

    if (progress !== target) wake();
  }

  function setPaused(value) {
    paused = value;
    const before = hero.getBoundingClientRect();
    stage.classList.toggle('is-paused', paused);
    hero.classList.toggle('is-static', paused);
    if (before.bottom <= 0) {
      window.scrollBy({ top: hero.getBoundingClientRect().bottom - before.bottom, behavior: 'instant' });
    } else if (paused && before.top < 0) {
      window.scrollTo({ top: window.scrollY + before.top, behavior: 'instant' });
    }
    observeFilm();
    updateControl();
    wake();
  }

  toggle.addEventListener('click', () => setPaused(!paused && !film.paused));
  film.addEventListener('playing', updateControl);
  film.addEventListener('pause', updateControl);
  reducedMotion.addEventListener('change', event => setPaused(event.matches));
  document.addEventListener('screeningchange', observeFilm);
  document.addEventListener('visibilitychange', () => { observeFilm(); previous = 0; wake(); });
  window.addEventListener('scroll', wake, { passive: true });
  window.addEventListener('resize', wake, { passive: true });
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    observeFilm();
    previous = 0;
    wake();
  }).observe(hero);

  tick();
  setPaused(paused);
})();

// polish.js
;(() => {
  const header = document.querySelector('.header');
  const menu = header.querySelector('.menu-button');
  const nav = header.querySelector('nav');
  const hero = document.querySelector('#home');
  const stage = hero.querySelector('.hero-sticky');
  let lastY = window.scrollY;
  let scheduled = false;
  function updateHeader() {
    scheduled = false;
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 40);
    header.classList.toggle('is-away', y > hero.offsetHeight - 80 && y > lastY + 2 && menu.getAttribute('aria-expanded') !== 'true');
    if (Math.abs(y - lastY) > 2) lastY = y;
  }
  window.addEventListener('scroll', () => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(updateHeader); }
  }, {passive:true});
  function closeMenu() {
    menu.setAttribute('aria-expanded','false');
    menu.setAttribute('aria-label','Открыть меню');
    nav.classList.remove('open');
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && nav.classList.contains('open')) { closeMenu(); menu.focus(); }
  });
  document.addEventListener('click', event => { if (!header.contains(event.target)) closeMenu(); });
  const links = [...nav.querySelectorAll('a[href^="#"]')];
  const sections = links.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  const active = new IntersectionObserver(entries => {
    const section = entries.find(entry => entry.isIntersecting);
    if (!section) return;
    links.forEach(link => {
      if (link.hash === `#${section.target.id}`) link.setAttribute('aria-current','location');
      else link.removeAttribute('aria-current');
    });
  }, {rootMargin:'-15% 0px -55% 0px',threshold:0});
  sections.forEach(section => active.observe(section));
  active.observe(hero);
  updateHeader();
})();
