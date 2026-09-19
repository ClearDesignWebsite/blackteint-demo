(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(pointer: fine)');
  const activeAnimations = new Set();
  const elementAnimations = new WeakMap();
  const ease = 'cubic-bezier(.22,.72,.16,1)';
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const canMove = () => !reduce.matches && typeof Element.prototype.animate === 'function';
  const ordinaryClick = event => event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;

  // The early head bootstrap hides pending content before first paint.
  // Each reveal releases its own element; reduced motion and a failed script
  // leave the ordinary document readable through the bootstrap watchdog.
  function motion(element, frames, options = {}, retain = false) {
    if (!element || !canMove()) return Promise.resolve();
    const previous = elementAnimations.get(element);
    if (previous) { previous.cancel(); activeAnimations.delete(previous); }
    let animation;
    try {
      animation = element.animate(frames, { duration: 800, easing: ease, fill: 'both', ...options });
    } catch (_) { return Promise.resolve(); }
    activeAnimations.add(animation);
    elementAnimations.set(element, animation);
    return animation.finished.catch(() => {}).then(() => {
      if (!retain) {
        animation.cancel();
        activeAnimations.delete(animation);
        if (elementAnimations.get(element) === animation) elementAnimations.delete(element);
      }
    });
  }
  function resetMotion() {
    activeAnimations.forEach(animation => animation.cancel());
    activeAnimations.clear();
  }

  // Split by words, preserving the original heading as its accessible name.
  document.querySelectorAll('[data-split]').forEach(heading => {
    heading.setAttribute('aria-label', heading.textContent.replace(/\s+/g, ' ').trim());
    heading.querySelectorAll('.title-line').forEach(line => {
      const words = line.textContent.split(/(\s+)/);
      line.textContent = '';
      line.setAttribute('aria-hidden', 'true');
      words.forEach(word => {
        if (!word.trim()) { line.append(document.createTextNode(word)); return; }
        const clip = document.createElement('span');
        const inner = document.createElement('span');
        clip.className = 'word-clip';
        inner.className = 'motion-word';
        inner.textContent = word;
        clip.append(inner);
        line.append(clip);
      });
    });
  });

  const revealTargets = new Set(document.querySelectorAll('[data-split],[data-enter],[data-photo]'));
  let entranceObserver;
  let entranceHeight = 0;
  function reveal(element, immediate = false) {
    if (element.classList.contains('is-revealed') || (document.hidden && !immediate)) return;
    element.classList.add('is-revealed');
    revealTargets.delete(element);
    entranceObserver?.unobserve(element);
    if (immediate || !canMove()) return;
    const delay = Number(element.dataset.delay) || 0;
    if (element.hasAttribute('data-split')) {
      element.querySelectorAll('.motion-word').forEach((word, index) => {
        motion(word, [
          { transform: 'translateY(108%) rotate(2deg)', opacity: 0, filter: 'blur(3px)' },
          { transform: 'translateY(0) rotate(0)', opacity: 1, filter: 'blur(0)' }
        ], { duration: 950, delay: delay + index * 65 });
      });
    } else if (element.hasAttribute('data-photo')) {
      const windowElement = element.querySelector('.image-window');
      const radius = getComputedStyle(windowElement).borderRadius || '30px';
      motion(windowElement, [
        { clipPath: 'inset(9% 5% round 45px)', opacity: 0, transform: 'scale(.965)' },
        { clipPath: `inset(0% 0% round ${radius})`, opacity: 1, transform: 'scale(1)' }
      ], { duration: 1100 });
      motion(element.querySelector('figcaption'), [
        { transform: 'translateY(16px)', opacity: 0 },
        { transform: 'translateY(0)', opacity: 1 }
      ], { duration: 750, delay: 180 });
    } else if (element.dataset.revealKind === 'fade') {
      motion(element, [{ opacity: 0 }, { opacity: 1 }], { duration: 1100, delay });
    } else {
      motion(element, [
        { transform: 'translateY(26px)', opacity: 0, filter: 'blur(2px)' },
        { transform: 'translateY(0)', opacity: 1, filter: 'blur(0)' }
      ], { duration: 800, delay });
    }
  }
  function connectEntranceObserver() {
    if (!('IntersectionObserver' in window)) return;
    entranceObserver?.disconnect();
    entranceHeight = innerHeight;
    entranceObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !entry.target.hidden) reveal(entry.target);
      });
    }, { threshold: 0, rootMargin: `0px 0px -${Math.round(innerHeight * .12)}px 0px` });
    revealTargets.forEach(element => entranceObserver.observe(element));
  }
  connectEntranceObserver();
  function revealVisibleTargets() {
    if (document.hidden) return;
    revealTargets.forEach(element => {
      if (element.hidden) return;
      const rect = element.getBoundingClientRect();
      if (rect.width && rect.height && rect.top < innerHeight * .88 && rect.bottom > 0) reveal(element);
    });
  }
  document.addEventListener('focusin', event => {
    // Keyboard focus reveals its target immediately, including nested groups.
    let element = event.target;
    while (element && element !== document.body) {
      if (revealTargets.has(element)) reveal(element, true);
      element = element.parentElement;
    }
  });
  document.addEventListener('visibilitychange', revealVisibleTargets);

  const paletteStops = [...document.querySelectorAll('[data-palette-step]')];
  const palettes = new Set(['graphite','inkblue','espresso','pine','plum','oxblood','ivory','ice','sand','sage','rose']);
  const header = document.querySelector('.site-header');
  const heroSection = document.querySelector('.hero');
  function syncPageState() {
    let palette = document.body.dataset.basePalette || 'graphite';
    const crossingLine = innerHeight * .55;
    for (const stop of paletteStops) {
      if (stop.getBoundingClientRect().top <= crossingLine) palette = stop.dataset.paletteStep;
      else break;
    }
    if (palettes.has(palette) && document.body.dataset.palette !== palette) document.body.dataset.palette = palette;
    if (header) {
      const visible = !heroSection || heroSection.getBoundingClientRect().bottom <= 0;
      header.classList.toggle('nav-visible', visible);
      header.inert = !visible;
      if (visible) header.removeAttribute('aria-hidden');
      else header.setAttribute('aria-hidden','true');
    }
  }

  // Image drift and exit are reversible with the real scroll position. Only
  // visible photos are measured, and there is no permanent animation loop.
  const photos = [...document.querySelectorAll('[data-photo]')];
  const visiblePhotos = new Set();
  let photoFrame = 0;
  function paintPhotos() {
    photoFrame = 0;
    if (document.hidden) return;
    if (innerHeight !== entranceHeight) connectEntranceObserver();
    syncPageState();
    if (reduce.matches) return;
    const height = window.innerHeight;
    visiblePhotos.forEach(figure => {
      if (figure.hidden) return;
      const rect = figure.getBoundingClientRect();
      if (!rect.height) return;
      const progress = clamp((height - rect.top) / (height + rect.height), 0, 1);
      const leaving = clamp((-rect.top / rect.height - .55) / .45, 0, 1);
      const drift = figure.querySelector('.photo-drift');
      drift.style.transform = `translateY(${((.5 - progress) * 24).toFixed(2)}px) scale(${(1 - leaving * .025).toFixed(4)})`;
      drift.style.opacity = String(1 - leaving);
    });
  }
  function requestPhotoFrame() {
    if (!photoFrame && !document.hidden) photoFrame = requestAnimationFrame(paintPhotos);
  }
  if ('IntersectionObserver' in window) {
    const photoObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) visiblePhotos.add(entry.target);
        else visiblePhotos.delete(entry.target);
      });
      requestPhotoFrame();
    }, { rootMargin: '15% 0px' });
    photos.forEach(photo => photoObserver.observe(photo));
  }
  addEventListener('scroll', requestPhotoFrame, { passive: true });
  addEventListener('resize', requestPhotoFrame, { passive: true });
  document.addEventListener('visibilitychange', requestPhotoFrame);
  syncPageState();
  requestPhotoFrame();

  const menu = document.getElementById('mobile-menu');
  const menuToggle = document.getElementById('menu-toggle');
  const lightbox = document.getElementById('lightbox');
  const syncDialogs = () => document.body.classList.toggle('dialog-open', Boolean(menu?.open || lightbox?.open));
  const closingDialogs = new WeakMap();
  function closeDialog(dialog) {
    if (!dialog?.open) return Promise.resolve();
    if (closingDialogs.has(dialog)) return closingDialogs.get(dialog);
    const closing = motion(dialog, [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(12px)' }
    ], { duration: 180 }, true).then(() => {
      dialog.close();
      const animation = elementAnimations.get(dialog);
      if (animation) { animation.cancel(); activeAnimations.delete(animation); elementAnimations.delete(dialog); }
      closingDialogs.delete(dialog);
    });
    closingDialogs.set(dialog, closing);
    return closing;
  }
  [menu, lightbox].filter(Boolean).forEach(dialog => {
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog); });
    dialog.addEventListener('close', syncDialogs);
  });
  if (menu && typeof menu.showModal === 'function') {
    menuToggle.addEventListener('click', () => {
      if (menu.open) return;
      menu.showModal();
      menuToggle.setAttribute('aria-expanded', 'true');
      syncDialogs();
      motion(menu, [{ opacity: 0, transform: 'translateY(-20px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 450 });
      menu.querySelectorAll('nav>a').forEach((link, index) => {
        motion(link, [{ opacity: 0, transform: 'translateY(28px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 650, delay: 50 + index * 55 });
      });
    });
    document.getElementById('menu-close').addEventListener('click', () => closeDialog(menu));
    menu.addEventListener('close', () => menuToggle.setAttribute('aria-expanded', 'false'));
    menu.querySelectorAll('a:not([data-page])').forEach(link => link.addEventListener('click', () => closeDialog(menu)));
    const wide = matchMedia('(min-width: 851px)');
    wide.addEventListener('change', () => { if (wide.matches) closeDialog(menu); });
    document.documentElement.classList.add('enhanced');
  }

  // Real document navigation, with a short exit. The cancelable event is only
  // consumed by the separately delivered, offline preview's page router.
  let navigating = false;
  document.addEventListener('click', async event => {
    const link = event.target.closest('a[data-page]');
    if (!link || event.defaultPrevented || !ordinaryClick(event) || link.target === '_blank' || link.hasAttribute('download')) return;
    event.preventDefault();
    if (navigating) return;
    if (link.dataset.page === document.body.dataset.page) {
      await closeDialog(menu);
      window.scrollTo({ top: 0, behavior: reduce.matches ? 'instant' : 'smooth' });
      return;
    }
    navigating = true;
    await Promise.all([
      closeDialog(menu),
      motion(document.querySelector('.page-shell'), [
        { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' },
        { opacity: 0, transform: 'translateY(-14px)', filter: 'blur(3px)' }
      ], { duration: 240 }, true)
    ]);
    const navigation = new CustomEvent('blackteint:navigate', {
      cancelable: true, detail: { page: link.dataset.page, href: link.getAttribute('href') }
    });
    if (window.dispatchEvent(navigation)) location.assign(link.href);
  });
  addEventListener('pageshow', event => {
    navigating = false;
    if (event.persisted) resetMotion();
    syncPageState();
    revealVisibleTargets();
    requestPhotoFrame();
  });

  // Gallery filters keep the ordinary, unfiltered gallery usable without JS.
  const filterBar = document.querySelector('.gallery-filters');
  const galleryItems = [...document.querySelectorAll('.gallery-item')];
  if (filterBar) {
    const buttons = [...filterBar.querySelectorAll('[data-filter]')];
    let filtering = false;
    buttons.forEach(button => button.addEventListener('click', async () => {
      if (filtering || button.getAttribute('aria-pressed') === 'true') return;
      filtering = true;
      const category = button.dataset.filter;
      buttons.forEach(item => { item.disabled = true; item.setAttribute('aria-pressed', String(item === button)); });
      const wanted = item => category === 'all' || item.dataset.category === category;
      await Promise.all(galleryItems.filter(item => !item.hidden && !wanted(item)).map(item => motion(item,
        [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.97)' }], { duration: 180 })));
      const incoming = galleryItems.filter(item => item.hidden && wanted(item));
      galleryItems.forEach(item => { item.hidden = !wanted(item); });
      incoming.filter(item => item.classList.contains('is-revealed')).forEach((item, index) => motion(item,
        [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 650, delay: index * 65 }));
      const count = galleryItems.filter(item => !item.hidden).length;
      document.getElementById('gallery-status').textContent = `${count} photographies affichées`;
      buttons.forEach(item => { item.disabled = false; });
      filtering = false;
      revealVisibleTargets();
      requestPhotoFrame();
    }));
    filterBar.hidden = false;
  }

  if (lightbox && typeof lightbox.showModal === 'function') {
    const image = document.getElementById('lightbox-image');
    const caption = document.getElementById('lightbox-caption');
    const counter = document.getElementById('lightbox-count');
    const links = [...document.querySelectorAll('[data-lightbox]')];
    const visibleLinks = () => links.filter(link => !link.closest('.gallery-item')?.hidden);
    let currentLink;
    function showPhoto(link) {
      currentLink = link;
      const available = visibleLinks();
      image.src = link.href;
      image.alt = link.querySelector('img').alt;
      caption.textContent = link.dataset.caption;
      counter.textContent = `${available.indexOf(link) + 1} / ${available.length}`;
      motion(image, [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 450 });
    }
    function movePhoto(direction) {
      const available = visibleLinks();
      if (!available.length) return;
      showPhoto(available[(available.indexOf(currentLink) + direction + available.length) % available.length]);
    }
    links.forEach(link => link.addEventListener('click', event => {
      if (!ordinaryClick(event)) return;
      event.preventDefault();
      showPhoto(link);
      lightbox.showModal();
      syncDialogs();
      motion(lightbox, [{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
    }));
    document.getElementById('lightbox-close').addEventListener('click', () => closeDialog(lightbox));
    document.getElementById('lightbox-prev').addEventListener('click', () => movePhoto(-1));
    document.getElementById('lightbox-next').addEventListener('click', () => movePhoto(1));
    lightbox.addEventListener('keydown', event => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault(); movePhoto(event.key === 'ArrowRight' ? 1 : -1);
      }
    });
    lightbox.addEventListener('click', event => { if (event.target === lightbox) closeDialog(lightbox); });
  }

  document.querySelectorAll('.faq-list details').forEach(details => {
    const summary = details.querySelector('summary');
    const answer = details.querySelector('.answer');
    let changing = false;
    summary.addEventListener('click', async event => {
      if (!canMove()) return; // Native keyboard and reduced-motion behaviour.
      event.preventDefault();
      if (changing) return;
      changing = true;
      const opening = !details.open;
      if (opening) details.open = true;
      const height = answer.scrollHeight;
      await motion(answer, opening ? [
        { height: '0px', opacity: 0 }, { height: `${height}px`, opacity: 1 }
      ] : [
        { height: `${height}px`, opacity: 1 }, { height: '0px', opacity: 0 }
      ], { duration: 330 });
      if (!opening) details.open = false;
      changing = false;
    });
  });

  document.querySelectorAll('[data-magnetic]').forEach(button => {
    button.addEventListener('pointermove', event => {
      if (!finePointer.matches || reduce.matches || event.pointerType === 'touch') return;
      const rect = button.getBoundingClientRect();
      const x = clamp((event.clientX - rect.left - rect.width / 2) * .055, -5, 5);
      const y = clamp((event.clientY - rect.top - rect.height / 2) * .13, -4, 4);
      button.style.transform = `translate(${x}px,${y}px)`;
    });
    const restore = () => { button.style.transform = ''; };
    button.addEventListener('pointerleave', restore);
    button.addEventListener('blur', restore);
  });
  reduce.addEventListener('change', () => {
    if (reduce.matches) {
      document.documentElement.classList.remove('motion-pending');
      [...revealTargets].forEach(element => reveal(element, true));
    }
    resetMotion();
    photos.forEach(photo => {
      const drift = photo.querySelector('.photo-drift');
      drift.style.transform = ''; drift.style.opacity = '';
    });
    document.querySelectorAll('[data-magnetic]').forEach(button => { button.style.transform = ''; });
    requestPhotoFrame();
  });

  clearTimeout(window.__btMotionTimer);
  delete window.__btMotionTimer;

  const video = document.getElementById('hero-video');
  const toggle = document.getElementById('video-toggle');
  if (!video || !toggle) return;
  const hero = video.closest('.hero');
  const saveData = Boolean(navigator.connection?.saveData);
  let wantsPlayback = !reduce.matches && !saveData;
  let inView = true;
  let failed = false;
  let playPending = false;
  function updateControl() {
    const playing = !video.paused && !video.ended;
    toggle.textContent = playing ? 'Mettre en pause' : 'Lire la vidéo';
    toggle.setAttribute('aria-label', playing ? 'Mettre la vidéo d’ambiance en pause' : 'Lire la vidéo d’ambiance');
  }
  function loadSource() {
    if (video.hasAttribute('src')) return;
    video.muted = true;
    video.src = matchMedia('(min-width: 1200px)').matches ? video.dataset.wideSrc : video.dataset.src;
    video.preload = 'auto';
    video.load();
  }
  async function tryPlay(retryAfterInterruption = true) {
    if (failed || playPending || !wantsPlayback || !inView || document.hidden) return;
    playPending = true;
    let interrupted = false;
    try {
      loadSource();
      await video.play();
      if (!wantsPlayback || !inView || document.hidden) video.pause();
    } catch (error) {
      interrupted = error.name === 'AbortError';
      if (!interrupted) wantsPlayback = false;
    } finally {
      playPending = false;
      updateControl();
      if (interrupted && retryAfterInterruption) tryPlay(false);
    }
  }
  function pausePlayback() { video.pause(); updateControl(); }
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    if (video.paused) { wantsPlayback = true; tryPlay(); }
    else { wantsPlayback = false; pausePlayback(); }
  });
  video.addEventListener('playing', () => { hero.classList.add('has-video'); updateControl(); });
  video.addEventListener('pause', updateControl);
  video.addEventListener('ended', updateControl);
  video.addEventListener('error', () => {
    failed = true; wantsPlayback = false;
    hero.classList.remove('has-video'); toggle.hidden = true;
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pausePlayback(); else tryPlay(); });
  reduce.addEventListener('change', () => { if (reduce.matches) { wantsPlayback = false; pausePlayback(); } });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting;
      if (inView) tryPlay(); else pausePlayback();
    }, { threshold: 0 }).observe(hero);
  } else tryPlay();
})();
