// stage-effects.js
;(() => {
  // Дым на первом экране: маленький WebGL-холст, растянутый CSS.
  // Рисуется не чаще 30 раз в секунду и только пока первый экран виден.
  const stage = document.querySelector('.hero-sticky');
  const hero = stage.closest('.hero-scroll');
  const smoke = stage.querySelector('.stage-smoke');
  const splice = stage.querySelector('.lens-splice');
  const screening = document.querySelector('#screening');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const phone = matchMedia('(max-width: 700px) and (orientation: portrait)');
  const shallowVertex = `
    attribute vec2 position;
    varying mediump vec2 uv;
    void main() {
      uv = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }`;

  const smokeFragment = `
    precision mediump float;
    uniform float clock;
    uniform float swell;
    uniform float ratio;
    varying mediump vec2 uv;

    float hash(vec2 p) {
      p = mod(p, 251.0);
      return fract(sin(dot(p, vec2(17.41, 181.71))) * 10497.17);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),
        mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
    }
    float smoke(vec2 p) {
      return noise(p)*0.53 + noise(p*2.07+8.0)*0.26 +
        noise(p*4.29-4.0)*0.14 + noise(p*8.57+13.0)*0.07;
    }

    void main() {
      float t = mod(clock, 800.0);
      vec2 p = vec2(uv.x * max(1.0, ratio), uv.y);
      vec2 flow = vec2(smoke(p*2.2 + vec2(-t*.105,t*.025)),
        smoke(p*2.7 + vec2(t*.036,-t*.089))) - .52;
      float layer = smoke(p*vec2(3.5,6.3) + flow*3.2 + vec2(-t*.33,-t*.18));
      float swellHeight = .20 + swell*.38 + flow.x*.22;
      float floorFog = 1.0 - smoothstep(.018,swellHeight,uv.y);
      float arc = exp(-7.5*abs(uv.y - (.30 + flow.y*.50 + swell*.20)));
      float fog = smoothstep(.30,.72,layer) * floorFog * .51;
      fog += arc * smoothstep(.42,.79,layer) * swell * .60;
      fog *= smoothstep(0.0,.035,uv.y);
      // The warm beam lights the density field from the right edge.
      float lit = smoothstep(.29,.77,uv.x + flow.x*.7);
      float beamY = 0.20 + (1.0 - uv.x) * .58 + flow.y * .13;
      float beam = exp(-8.5 * abs(uv.y - beamY)) * smoothstep(.40, .88, uv.x);
      float amber = clamp(beam * (.25 + swell * 1.6), 0.0, 1.0);
      fog += beam * swell * smoothstep(.50,.75,layer) * .37;
      vec3 color = mix(vec3(.43,.44,.68), vec3(.84,.69,.54),lit);
      color = mix(color, vec3(1.0,.54,.26), amber);
      float alpha = clamp(fog, 0.0, .72);
      gl_FragColor = vec4(color * alpha, alpha);
    }`;

  const smooth = (a, b, value) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  function atmosphere() {
    const gl = smoke.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('WebGL unavailable');
    const program = gl.createProgram();
    [[gl.VERTEX_SHADER, shallowVertex], [gl.FRAGMENT_SHADER, smokeFragment]].forEach(([kind, code]) => {
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
    const clock = gl.getUniformLocation(program, 'clock');
    const swell = gl.getUniformLocation(program, 'swell');
    const ratio = gl.getUniformLocation(program, 'ratio');
    return {
      resize() {
        // Туман мягкий, поэтому хватает небольшого холста.
        const width = Math.min(420, Math.max(200, Math.round(stage.clientWidth * 0.3)));
        const aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
        const height = Math.min(320, Math.round(width / Math.max(0.55, aspect)));
        if (smoke.width !== width || smoke.height !== height) { smoke.width = width; smoke.height = height; }
        gl.viewport(0, 0, width, height);
        gl.uniform1f(ratio, aspect);
      },
      draw(time, intensity) {
        if (gl.isContextLost()) return;
        gl.uniform1f(clock, time);
        gl.uniform1f(swell, intensity);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        stage.classList.add('has-live-fog');
      }
    };
  }

  let fog = null;
  let visible = true;
  let progress = 0;
  let clock = 0;
  let previous = 0;
  let frame = 0;
  let cutLatched = false;
  const paused = () => motion.matches || stage.classList.contains('is-paused') || screening.open;

  function wake() {
    if (!frame && fog && visible && !document.hidden) frame = requestAnimationFrame(draw);
  }

  function draw(now) {
    frame = 0;
    if (!fog || !visible || document.hidden) return;
    const still = paused();
    if (still || !previous || now - previous >= 33) {
      if (!still && previous) clock += Math.min(66, now - previous) / 1000;
      previous = still ? 0 : now;
      const shown = still ? 0 : progress;
      fog.draw(still ? 0 : clock, smooth(.29, .58, shown) * (1 - smooth(.72, 1, shown)));
    }
    if (!still) wake();
  }

  stage.addEventListener('blur:frame', ({ detail }) => {
    progress = detail;
    if (detail < .68) cutLatched = false;
    if (detail > .87 && !cutLatched && !paused()) {
      splice.animate([
        { opacity: 0, transform: 'translateX(-4%)' },
        { opacity: .44, transform: 'translateX(2%)', offset: .24 },
        { opacity: .24, transform: 'translateX(-1%)', offset: .55 },
        { opacity: 0 },
      ], { duration: 330, easing: 'steps(5,end)' });
      cutLatched = true;
    }
    wake();
  });

  smoke.addEventListener('webglcontextlost', () => { fog = null; stage.classList.remove('has-live-fog'); });
  document.addEventListener('visibilitychange', () => { previous = 0; wake(); });
  document.addEventListener('screeningchange', wake);
  motion.addEventListener('change', wake);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; previous = 0; wake(); }).observe(hero);

  // На телефоне туман почти прозрачный (opacity .32), а стоит дорого — там его заменяет CSS-подсветка.
  if (!phone.matches) {
    try { fog = atmosphere(); } catch { fog = null; }
  }
  if (fog) {
    new ResizeObserver(() => { fog?.resize(); wake(); }).observe(stage);
    fog.resize();
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
      if (element.matches('.cast-card, .film')) element.classList.add('cut-reveal');
      observer.unobserve(element);
    }
  }, { threshold: 0.14 });

  document.querySelectorAll('[data-live-cut], [data-wedding-reveal], .cast-card, .live-grid .film').forEach(element => {
    if (element.hasAttribute('data-wedding-reveal')) {
      element.classList.add('wedding-reveal-ready');
    }
    chapterEntrance.observe(element);
  });
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
  const hero = document.querySelector('#home');
  const stage = hero.querySelector('.hero-sticky');
  const film = hero.querySelector('#scene-film');
  const intro = hero.querySelector('.hero-intro');
  const actor = hero.querySelector('.actor-cutout');
  const grade = hero.querySelector('.hero-grade');
  const timeline = hero.querySelector('.hero-timeline span');
  const toggle = hero.querySelector('#motion-toggle');
  const screening = document.querySelector('#screening');
  const optics = hero.querySelector('.hero-optics');
  const ring = hero.querySelector('.lens-focus');
  // Размеры фигуры меряем только при изменении окна, а не в каждом кадре:
  // точка объектива совпадает с transform-origin и не смещается при зуме.
  let box = { left: 0, top: 0, height: 0 };
  function measure() {
    box = { left: actor.offsetLeft, top: actor.offsetTop, height: actor.offsetHeight };
  }
  actor.addEventListener('load', () => { measure(); wake(); });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const interpolate = (start, end, position) => start + (end - start) * position;
  const smooth = (position, start, end) => {
    const t = clamp((position - start) / (end - start));
    return t * t * (3 - 2 * t);
  };

  let visible = true;
  let paused = reducedMotion.matches;
  let frame = 0;
  let progress = 0;
  let previous = 0;

  function observeFilm() {
    if (paused || !visible || document.hidden || screening.open) {
      film.pause();
      return;
    }
    film.play().catch(() => {
      // The browser can require a tap to start even a muted background.
      if (!paused && visible && !document.hidden && !screening.open) {
        updateControl();
      }
    });
  }

  function updateControl() {
    const play = paused || film.paused;
    toggle.innerHTML = play
      ? '<span aria-hidden="true">▶</span> Включить видео'
      : '<span aria-hidden="true">Ⅱ</span> Пауза';
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
    const scrollDistance = Math.max(1, hero.offsetHeight - stage.offsetHeight);
    const target = paused ? 0 : clamp(-hero.getBoundingClientRect().top / scrollDistance);
    if (paused || Math.abs(target - progress) < 0.002) {
      progress = target;
    } else {
      progress = interpolate(progress, target, 1 - Math.exp(-elapsed / 44));
    }

    const textOut = smooth(progress, 0.04, 0.32);
    const push = smooth(progress, 0.42, 0.85);
    const portrait = stage.clientWidth <= 700 && stage.clientHeight > stage.clientWidth;
    intro.style.opacity = 1 - textOut;
    intro.style.transform = `translateY(${-12 * textOut}px)`;
    intro.inert = textOut >= 0.95;
    grade.style.opacity = 1 - 0.83 * smooth(progress, 0.38, 0.89);
    film.style.transform = `scale(${1 + 0.045 * push})`;
    actor.style.setProperty('--hero-zoom', String(1 + Math.pow(Math.min(1, progress / 0.85), 1.7) * (portrait ? 2.7 : 3.9)));
    actor.style.setProperty('--hero-shift', `${progress * (portrait ? -3 : 23)}vh`);

    actor.style.setProperty('--hero-pan', `${portrait ? -14 * push : 0}vw`);

    // Точка объектива: левый край блока + сдвиги, верх + 26,9% высоты.
    const shiftPx = progress * (portrait ? -3 : 23) * innerHeight / 100;
    const panPx = (portrait ? -14 * push : 0) * innerWidth / 100;
    const focusX = box.left + panPx;
    const focusY = box.top + box.height * .269 + shiftPx;

    const ringIntensity = Math.max(0, 1 - Math.abs(progress - .43) / .13);
    ring.style.setProperty('--focus-opacity', String(ringIntensity * .65));
    if (ringIntensity) {
      ring.style.left = `${focusX}px`;
      ring.style.top = `${focusY}px`;
      ring.style.setProperty('--focus-scale', String(1.2 - ringIntensity * .2));
    }

    if (portrait) {
      const opening = smooth(progress, .50, .93);
      optics.classList.toggle('iris-open', opening > 0);
      optics.style.setProperty('--focus-x', `${focusX}px`);
      optics.style.setProperty('--focus-y', `${focusY}px`);
      optics.style.setProperty('--iris-radius', `${opening * Math.hypot(stage.clientWidth, stage.clientHeight) * 1.2}px`);
      optics.style.setProperty('--iris-feather', '24px');
    } else {
      optics.classList.remove('iris-open');
    }

    timeline.style.transform = `scaleX(${progress})`;
    stage.style.setProperty('--clear-stage', smooth(progress, 0.76, 1));
    stage.dispatchEvent(new CustomEvent('blur:frame', { detail: progress }));

    if (progress !== target) wake();
  }

  function setPaused(value) {
    paused = value;
    // Collapse only when motion is disabled; preserve viewport position below the intro.
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
  document.addEventListener('visibilitychange', () => {
    observeFilm();
    previous = 0;
    wake();
  });
  window.addEventListener('scroll', wake, { passive: true });
  window.addEventListener('resize', () => { measure(); wake(); }, { passive: true });
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    observeFilm();
    previous = 0;
    wake();
  }).observe(hero);

  measure();
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
