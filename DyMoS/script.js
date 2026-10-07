(function () {
  // Log load problems to the console only; never draw them on the page.
  function diag(msg) {
    console.warn('[DyMoS] ' + msg);
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'class') n.className = attrs[k];
        else if (attrs[k] === true) n.setAttribute(k, '');
        else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
      }
    }
    if (children != null) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c == null || c === false) return;
        if (typeof c === 'string' || typeof c === 'number') n.appendChild(document.createTextNode(c));
        else n.appendChild(c);
      });
    }
    return n;
  }

  function makeVideo(src, opts) {
    opts = opts || {};
    var v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = opts.preload || 'metadata';
    if (opts.autoplay !== false) v.autoplay = true;
    v.setAttribute('muted', '');
    v.setAttribute('loop', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    if (opts.autoplay !== false) v.setAttribute('autoplay', '');
    v.src = src;
    v.addEventListener('error', function () { diag('video error: ' + src); }, { once: true });
    return v;
  }

  var syncGroups = {};
  var syncGroupSeq = 0;
  function makeSyncGroup() {
    var id = '__sg' + (++syncGroupSeq);
    syncGroups[id] = { videos: [], intersectingCount: 0, started: false };
    return id;
  }
  function addToSyncGroup(id, v) {
    var g = syncGroups[id];
    if (!g) return;
    g.videos.push(v);
    v.dataset.syncGroup = id;
    v.classList.add('sync-pending');   // hide until the whole group is ready
    var onReady = function () {
      v.removeEventListener('canplay', onReady);
      tryPlaySyncGroup(g);
    };
    if (v.readyState >= 3) tryPlaySyncGroup(g);
    else v.addEventListener('canplay', onReady);
  }
  function tryPlaySyncGroup(g) {
    if (g.started || g.intersectingCount === 0) return;
    if (!g.videos.every(function (v) { return v.readyState >= 3; })) return;
    g.started = true;
    g.videos.forEach(function (v) {
      try { v.currentTime = 0; } catch (_) {}
      v.classList.remove('sync-pending');
      v.classList.add('sync-ready');
      var p = v.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    });
  }
  function pauseSyncGroup(g) {
    g.started = false;
    g.videos.forEach(function (v) {
      if (!v.paused) v.pause();
    });
  }

  function metaBadges(parts) {
    var children = parts.filter(Boolean).map(function (p) {
      return el('span', { class: 'badge' }, p);
    });
    return el('div', { class: 'meta-badges' }, children);
  }

  var io = null;
  function initObserver() {
    if (!('IntersectionObserver' in window)) return null;
    io = new IntersectionObserver(function (entries) {
      var touched = {};
      entries.forEach(function (e) {
        var v = e.target;
        var gid = v.dataset.syncGroup;
        if (gid) {
          var g = syncGroups[gid];
          if (!g) return;
          if (e.isIntersecting && !v.__inSync) {
            v.__inSync = true;
            g.intersectingCount++;
          } else if (!e.isIntersecting && v.__inSync) {
            v.__inSync = false;
            g.intersectingCount--;
          }
          touched[gid] = g;
        } else {
          if (e.isIntersecting) {
            if (v.paused) {
              var p = v.play();
              if (p && typeof p.catch === 'function') p.catch(function () {});
            }
          } else {
            if (!v.paused) v.pause();
          }
        }
      });
      Object.keys(touched).forEach(function (gid) {
        var g = touched[gid];
        if (g.intersectingCount > 0) tryPlaySyncGroup(g);
        else pauseSyncGroup(g);
      });
    }, { rootMargin: '200px 0px', threshold: 0.05 });
  }
  function observeAllVideos(root) {
    if (!io) return;
    root.querySelectorAll('video').forEach(function (v) {
      if (v.dataset.carouselManaged === '1') return;
      io.observe(v);
    });
  }

  function buildCarousel(slides, slideGroups, opts) {
    opts = opts || {};
    var carousel = document.createElement('div');
    carousel.className = 'teaser-carousel';

    var track = document.createElement('div');
    track.className = 'teaser-carousel-track';
    slides.forEach(function (s) {
      s.classList.add('teaser-slide');
      track.appendChild(s);
    });
    carousel.appendChild(track);

    var prevBtn = el('button', {
      class: 'carousel-arrow carousel-arrow-prev',
      type: 'button',
      'aria-label': 'Previous',
    }, '‹');
    var nextBtn = el('button', {
      class: 'carousel-arrow carousel-arrow-next',
      type: 'button',
      'aria-label': 'Next',
    }, '›');
    carousel.appendChild(prevBtn);
    carousel.appendChild(nextBtn);

    var dots = el('div', { class: 'carousel-dots' });
    slides.forEach(function (_, i) {
      var d = el('button', {
        class: 'carousel-dot',
        type: 'button',
        'aria-label': 'Slide ' + (i + 1),
      });
      d.dataset.idx = String(i);
      dots.appendChild(d);
    });

    var currentIdx = 0;
    var carouselVisible = false;

    function updateUI() {
      track.style.transform = 'translateX(-' + (currentIdx * 100) + '%)';
      slides.forEach(function (s, i) {
        s.classList.toggle('is-active', i === currentIdx);
      });
      Array.prototype.forEach.call(dots.children, function (d, i) {
        d.classList.toggle('is-active', i === currentIdx);
      });
    }

    function setActive(newIdx) {
      if (newIdx < 0) newIdx = slides.length - 1;
      if (newIdx >= slides.length) newIdx = 0;
      if (newIdx === currentIdx) return;
      var oldG = syncGroups[slideGroups[currentIdx]];
      if (oldG) {
        pauseSyncGroup(oldG);
        oldG.intersectingCount = 0;
        oldG.videos.forEach(function (v) { try { v.currentTime = 0; } catch (_) {} });
      }
      currentIdx = newIdx;
      updateUI();
      var newG = syncGroups[slideGroups[currentIdx]];
      if (newG && carouselVisible) {
        newG.intersectingCount = newG.videos.length;
        newG.videos.forEach(function (v) { try { v.currentTime = 0; } catch (_) {} });
        tryPlaySyncGroup(newG);
      }
    }

    prevBtn.addEventListener('click', function () { setActive(currentIdx - 1); });
    nextBtn.addEventListener('click', function () { setActive(currentIdx + 1); });
    dots.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('.carousel-dot');
      if (!t) return;
      setActive(parseInt(t.dataset.idx, 10));
    });

    if ('IntersectionObserver' in window) {
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting === carouselVisible) return;
          carouselVisible = e.isIntersecting;
          var g = syncGroups[slideGroups[currentIdx]];
          if (!g) return;
          if (carouselVisible) {
            g.intersectingCount = g.videos.length;
            tryPlaySyncGroup(g);
          } else {
            g.intersectingCount = 0;
            pauseSyncGroup(g);
          }
        });
      }, { rootMargin: '200px 0px', threshold: 0.05 });
      cio.observe(carousel);
    } else {
      carouselVisible = true;
      var g0 = syncGroups[slideGroups[0]];
      if (g0) {
        g0.intersectingCount = g0.videos.length;
        tryPlaySyncGroup(g0);
      }
    }

    updateUI();

    if (slides.length <= 1) {
      prevBtn.style.display = 'none';
      nextBtn.style.display = 'none';
      dots.style.display = 'none';
    }

    return { root: carousel, dots: dots };
  }

  function renderTeaser(container, t) {
    if (!t) return;
    var wrap = el('div', { class: 'teaser-grid' });

    var aPanel = el('div', { class: 'teaser-panel teaser-a' });
    var aBody = el('div', { class: 'teaser-a-body' });
    var aSlides = [];
    var aGroups = [];
    (t.dynamic || []).forEach(function (item) {
      var block = el('div', { class: 'teaser-dyn-block' });
      var rows = el('div', { class: 'teaser-dyn-rows' });
      var aGroupId = makeSyncGroup();
      aGroups.push(aGroupId);

      var vBase = makeVideo(item.files.baseline, { autoplay: false, preload: 'auto' });
      vBase.dataset.carouselManaged = '1';
      addToSyncGroup(aGroupId, vBase);
      rows.appendChild(el('div', { class: 'teaser-row' }, [
        el('div', { class: 'row-label row-label-vertical' },
           el('span', null, item.model)),
        el('div', { class: 'video-cell' }, [vBase]),
      ]));

      var vOurs = makeVideo(item.files.ours, { autoplay: false, preload: 'auto' });
      vOurs.dataset.carouselManaged = '1';
      addToSyncGroup(aGroupId, vOurs);
      rows.appendChild(el('div', { class: 'teaser-row' }, [
        el('div', { class: 'row-label row-label-vertical row-label-ours' },
           el('span', null, 'Ours')),
        el('div', { class: 'video-cell' }, [vOurs]),
      ]));

      block.appendChild(rows);
      block.appendChild(el('div', { class: 'teaser-prompt' }, item.prompt));
      aSlides.push(block);
    });
    var aCar = buildCarousel(aSlides, aGroups);
    aBody.appendChild(aCar.root);
    aBody.appendChild(aCar.dots);
    aPanel.appendChild(aBody);
    aPanel.appendChild(el('div', { class: 'panel-caption' }, '(a) Dynamic image-to-video generation'));
    wrap.appendChild(aPanel);

    var c = t.continuous;
    var bPanel = el('div', { class: 'teaser-panel teaser-b' });
    if (c) {
      var bBody = el('div', { class: 'teaser-b-body' });

      bBody.appendChild(el('div', { class: 'static-dynamic-arrow' }, [
        el('span', { class: 'sd-static' }, 'Static'),
        el('div', { class: 'sd-bar' }),
        el('span', { class: 'sd-dynamic' }, 'Dynamic'),
      ]));

      var row = el('div', { class: 'teaser-cont-row' });
      var bGroupId = makeSyncGroup();
      (c.rows || []).forEach(function (r) {
        var block = el('div', { class: 'teaser-cont-block' });
        var v = makeVideo(r.file, { autoplay: false, preload: 'auto' });
        addToSyncGroup(bGroupId, v);
        block.appendChild(el('div', { class: 'video-cell' }, [v]));
        block.appendChild(el('div', { class: 'teaser-cont-label' }, r.label));
        row.appendChild(block);
      });
      bBody.appendChild(row);
      bBody.appendChild(el('div', { class: 'teaser-prompt' }, c.prompt));
      bPanel.appendChild(bBody);
    }
    bPanel.appendChild(el('div', { class: 'panel-caption' }, '(b) Continuous control over motion dynamics'));
    wrap.appendChild(bPanel);

    container.appendChild(wrap);
  }

  function renderDynamic(container, items) {
    items.forEach(function (it) {
      var fig = el('figure', { class: 'method-compare' });
      var grid = el('div', { class: 'grid grid-3' });
      var groupId = makeSyncGroup();
      ['base', 'alg', 'ours'].forEach(function (k) {
        var label = k === 'base' ? 'Base' : k === 'alg' ? 'ALG' : 'Ours';
        var v = makeVideo(it.files[k], { autoplay: false, preload: 'auto' });
        addToSyncGroup(groupId, v);
        var labelClass = 'cell-label' + (k === 'ours' ? ' cell-label-ours' : '');
        var col = el('div', { class: 'compare-col' }, [
          el('div', { class: 'video-cell' }, [v]),
          el('div', { class: labelClass }, label),
        ]);
        grid.appendChild(col);
      });
      fig.appendChild(grid);

      var captionChildren = [];
      captionChildren.push(metaBadges([
        'Model: ' + it.model,
        'Dataset: ' + it.dataset + (it.vid ? ' ' + it.vid : ''),
      ]));
      if (it.prompt) {
        captionChildren.push(el('div', { class: 'cap-line cap-prompt' },
          el('span', { class: 'prompt-text' }, '“' + it.prompt + '”')));
      }
      fig.appendChild(el('figcaption', null, captionChildren));
      container.appendChild(fig);
    });
  }

  function renderContinuous(container, items) {
    items.forEach(function (it) { container.appendChild(buildSlider(it)); });
  }

  function buildSlider(item) {
    var steps = item.steps;
    var n = steps.length;
    var defaultIdx = Math.floor((n - 1) / 2);
    var slider = el('div', { class: 'video-slider' });

    var stack = el('div', { class: 'video-stack' });
    var videos = [];
    steps.forEach(function (s, i) {
      var v = makeVideo(s.file, { preload: 'auto', autoplay: i === defaultIdx });
      v.dataset.videoIndex = String(i);
      if (i !== defaultIdx) v.classList.add('hidden');
      stack.appendChild(v);
      videos.push(v);
    });
    slider.appendChild(stack);

    var captionChildren = [];
    if (item.prompt) {
      captionChildren.push(el('div', { class: 'cap-line cap-prompt' },
        el('span', { class: 'prompt-text' }, '“' + item.prompt + '”')));
    }
    if (captionChildren.length) {
      slider.appendChild(el('div', { class: 'slider-caption' }, captionChildren));
    }

    var input = el('input', {
      type: 'range', min: 0, max: n - 1, step: 1, value: defaultIdx,
      class: 'slider-input', 'aria-label': 'Motion strength',
    });
    var trackWrap = el('div', { class: 'slider-track-wrapper' }, [input]);
    slider.appendChild(el('div', { class: 'slider-row' }, [
      el('span', { class: 'end-label end-label-static' }, 'Static'),
      trackWrap,
      el('span', { class: 'end-label end-label-dynamic' }, 'Dynamic'),
    ]));

    var currentIdx = defaultIdx;
    input.addEventListener('input', function (e) {
      var newIdx = parseInt(e.target.value, 10);
      if (isNaN(newIdx) || newIdx === currentIdx) return;
      var cur = videos[currentIdx]; var next = videos[newIdx];
      if (!cur || !next) return;
      try { cur.pause(); cur.currentTime = 0; } catch (_) {}
      try { next.currentTime = 0; } catch (_) {}
      cur.classList.add('hidden');
      next.classList.remove('hidden');
      var p = next.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
      currentIdx = newIdx;
    });

    return slider;
  }

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    if (!window.PAGE_DATA) {
      diag('PAGE_DATA missing — data.js failed to load.');
      return;
    }
    var data = window.PAGE_DATA;
    var teaserContainer = document.getElementById('teaser-container');
    var dyn = document.getElementById('dynamic-container');
    var cont = document.getElementById('continuous-container');
    if (teaserContainer && data.teaser) renderTeaser(teaserContainer, data.teaser);
    if (dyn) renderDynamic(dyn, data.dynamic || []);
    if (cont) renderContinuous(cont, data.continuous || []);

    initObserver();
    observeAllVideos(document);

    var n = document.querySelectorAll('video').length;
    if (n === 0) diag('No <video> elements rendered. Check data.js content.');
  });
})();
