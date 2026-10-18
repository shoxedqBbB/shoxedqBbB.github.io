(function () {
  'use strict';

  var players = [];
  var activePlayer = null;
  var playerByElement = new WeakMap();
  var playerSequence = 0;

  function element(tag, attributes, children) {
    var node = document.createElement(tag);
    Object.keys(attributes || {}).forEach(function (key) {
      if (key === 'class') node.className = attributes[key];
      else node.setAttribute(key, attributes[key]);
    });
    (Array.isArray(children) ? children : [children]).forEach(function (child) {
      if (child == null) return;
      node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function makeVideo(file, label) {
    var video = element('video', {
      'data-src': file, poster: file.replace(/\.mp4$/i, '.jpg'),
      preload: 'none', muted: '', playsinline: '', 'aria-label': label
    });
    video.muted = true;
    return video;
  }

  function formatTime(seconds) {
    var safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    return Math.floor(safe / 60) + ':' + String(safe % 60).padStart(2, '0');
  }

  function cancelled() {
    return new DOMException('Playback request cancelled.', 'AbortError');
  }

  // Video sources are attached only after the visitor presses Play.
  function prepareVideo(video, signal) {
    return new Promise(function (resolve, reject) {
      var timer;
      var settled = false;
      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener('canplay', ready);
        video.removeEventListener('loadeddata', ready);
        video.removeEventListener('error', failed);
        signal.removeEventListener('abort', aborted);
        if (error) reject(error);
        else resolve();
      }
      function ready() { if (video.readyState >= 3) finish(); }
      function failed() { finish(new Error('This video could not be loaded.')); }
      function aborted() { finish(cancelled()); }
      if (signal.aborted) { finish(cancelled()); return; }
      video.addEventListener('canplay', ready);
      video.addEventListener('loadeddata', ready);
      video.addEventListener('error', failed);
      signal.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(function () {
        finish(new Error('Loading is taking longer than expected.'));
      }, 20000);
      if (video.getAttribute('src') !== video.dataset.src || video.error) {
        video.preload = 'auto';
        video.src = video.dataset.src;
        video.load();
      }
      ready();
    });
  }

  function createPlayer(root) {
    var videos = Array.from(root.querySelectorAll('video'));
    if (!videos.length) return;
    root.classList.add('manual-player');
    var state = 'idle';
    var generation = 0;
    var pendingLoad = null;
    var frame = 0;
    var statusId = 'playback-status-' + (++playerSequence);
    var button = element('button', {
      type: 'button', class: 'playback-toggle', 'aria-describedby': statusId
    });
    var icon = element('span', { class: 'playback-icon', 'aria-hidden': 'true' }, '\u25b6');
    var label = element('span', { class: 'playback-label' }, 'Play');
    button.append(icon, label);
    var time = element('span', { class: 'playback-time' }, '0:00 / 0:00');
    var status = element('p', { class: 'playback-status', id: statusId, 'aria-live': 'polite' });
    var controls = element('div', { class: 'playback-controls' }, [button, time]);
    var media = root.querySelector('.teaser-row-video, .grid, .video-stack');
    media.after(controls, status);

    function duration() {
      var durations = videos.map(function (video) { return video.duration; });
      return durations.every(function (value) { return Number.isFinite(value) && value > 0; })
        ? Math.min.apply(null, durations) : 0;
    }

    function updateTime() {
      var total = duration();
      var position = Math.min(videos[0].currentTime || 0, total || 0);
      time.textContent = formatTime(position) + ' / ' + formatTime(total);
    }

    function updateControls(message) {
      root.dataset.state = state;
      root.setAttribute('aria-busy', String(state === 'loading'));
      icon.textContent = state === 'playing' ? '\u275a\u275a' : '\u25b6';
      label.textContent = state === 'loading' ? 'Cancel' : state === 'playing' ? 'Pause'
        : state === 'ended' ? 'Replay' : 'Play';
      status.textContent = message || '';
      updateTime();
    }

    function seekTo(position) {
      videos.forEach(function (video) {
        if (video.readyState < 1 || Math.abs(video.currentTime - position) < 0.005) return;
        try { video.currentTime = position; } catch (_) { /* Wait for metadata on retry. */ }
      });
      updateTime();
    }

    function pause(message, nextState) {
      var position = videos[0].currentTime || 0;
      ++generation;
      if (pendingLoad) pendingLoad.abort();
      pendingLoad = null;
      cancelAnimationFrame(frame);
      frame = 0;
      state = nextState || 'paused';
      videos.forEach(function (video) {
        video.pause();
        video.playbackRate = 1;
      });
      // All motion strengths remain on the same frame even while paused.
      seekTo(position);
      if (activePlayer === api) activePlayer = null;
      updateControls(message);
    }

    function finish() {
      var total = duration();
      pause(null, 'ended');
      if (total) seekTo(total);
    }

    function tick() {
      if (state !== 'playing') return;
      var master = videos[0];
      var total = duration();
      if (total && master.currentTime >= total - 0.025) {
        finish();
        return;
      }
      videos.slice(1).forEach(function (video) {
        if (video.seeking || master.seeking || video.readyState < 3 || master.readyState < 3) return;
        var drift = video.currentTime - master.currentTime;
        if (Math.abs(drift) > 0.10) {
          video.currentTime = master.currentTime;
          video.playbackRate = 1;
        } else {
          video.playbackRate = Math.abs(drift) > 0.025 ? (drift > 0 ? 0.97 : 1.03) : 1;
        }
      });
      updateTime();
      frame = requestAnimationFrame(tick);
    }

    async function start() {
      if (state === 'loading' || state === 'playing') {
        pause();
        return;
      }
      if (document.hidden || root.hidden) return;
      if (activePlayer && activePlayer !== api) activePlayer.pause();
      var replay = state === 'ended';
      pause(null);
      activePlayer = api;
      var request = generation;
      var controller = new AbortController();
      pendingLoad = controller;
      state = 'loading';
      updateControls();
      try {
        await Promise.all(videos.map(function (video) { return prepareVideo(video, controller.signal); }));
        if (request !== generation || document.hidden || root.hidden) return;
        pendingLoad = null;
        var total = duration();
        var position = videos[0].currentTime || 0;
        if (replay || (total && position >= total - 0.05)) position = 0;
        seekTo(position);
        state = 'playing';
        updateControls('');
        // Playback starts only here, from an explicit Play or Replay click.
        await Promise.all(videos.map(function (video) { return video.play(); }));
        if (request !== generation || state !== 'playing') return;
        frame = requestAnimationFrame(tick);
      } catch (error) {
        if (request !== generation || error.name === 'AbortError') return;
        pause('Unable to play. Check your connection and select Play to retry.', 'error');
      }
    }

    var api = {
      root: root,
      pause: pause,
      isEngaged: function () { return state === 'loading' || state === 'playing'; }
    };
    button.addEventListener('click', start);
    videos.forEach(function (video) {
      video.addEventListener('loadedmetadata', updateTime);
      video.addEventListener('timeupdate', updateTime);
      video.addEventListener('ended', function () {
        if (state === 'playing' && video.ended) finish();
      });
      video.addEventListener('waiting', function () {
        if (state === 'playing' && !video.seeking && video.readyState < 3) {
          pause();
        }
      });
      video.addEventListener('error', function () {
        if (state === 'playing') pause('Unable to load this video. Select Play to retry.', 'error');
      });
      video.addEventListener('play', function () {
        if (state !== 'playing' || document.hidden || root.hidden) video.pause();
      });
      video.addEventListener('pause', function () {
        // A queued pause event from an earlier request must not cancel Replay.
        if (state === 'playing' && video.paused && !video.ended) pause();
      });
    });
    updateControls('');
    players.push(api);
    playerByElement.set(root, api);
  }

  function metaBadges(parts) {
    return element('div', { class: 'meta-badges' }, parts.filter(Boolean).map(function (part) {
      return element('span', { class: 'badge' }, part);
    }));
  }

  function promptCaption(prompt) {
    return element('div', { class: 'cap-line cap-prompt' },
      element('span', { class: 'prompt-text' }, '\u201c' + prompt + '\u201d'));
  }

  function renderDynamic(container, items) {
    items.forEach(function (item) {
      var figure = element('figure', { class: 'method-compare' });
      var grid = element('div', { class: 'grid grid-3' });
      ['base', 'alg', 'ours'].forEach(function (key) {
        var label = key === 'base' ? 'Base' : key === 'alg' ? 'ALG' : 'Ours';
        grid.appendChild(element('div', { class: 'compare-col' }, [
          element('div', { class: 'video-cell' }, makeVideo(item.files[key], label + ': ' + item.prompt)),
          element('div', { class: 'cell-label' + (key === 'ours' ? ' cell-label-ours' : '') }, label)
        ]));
      });
      var caption = [metaBadges([
        'Model: ' + item.model,
        'Dataset: ' + item.dataset + (item.vid ? ' ' + item.vid : '')
      ])];
      if (item.prompt) caption.push(promptCaption(item.prompt));
      figure.append(grid, element('figcaption', {}, caption));
      container.appendChild(figure);
      createPlayer(figure);
    });
  }

  function renderContinuous(container, items) {
    items.forEach(function (item) {
      var steps = item.steps || [];
      if (!steps.length) return;
      var selected = steps.findIndex(function (step) { return /g\s*=\s*0\.0\b/.test(step.label); });
      if (selected < 0) selected = Math.floor((steps.length - 1) / 2);
      var slider = element('div', { class: 'video-slider' });
      var stack = element('div', { class: 'video-stack' });
      var videos = steps.map(function (step, index) {
        var video = makeVideo(step.file, step.label + ': ' + item.prompt);
        video.dataset.videoIndex = String(index);
        video.classList.toggle('hidden', index !== selected);
        video.setAttribute('aria-hidden', String(index !== selected));
        stack.appendChild(video);
        return video;
      });
      slider.appendChild(stack);
      if (item.prompt) slider.appendChild(element('div', { class: 'slider-caption' }, promptCaption(item.prompt)));
      var input = element('input', {
        type: 'range', min: 0, max: steps.length - 1, step: 1, value: selected,
        class: 'slider-input', 'aria-label': 'Motion strength: ' + item.prompt,
        'aria-valuetext': steps[selected].label
      });
      slider.appendChild(element('div', { class: 'slider-row' }, [
        element('span', { class: 'end-label end-label-static' }, 'Static'),
        element('div', { class: 'slider-track-wrapper' }, input),
        element('span', { class: 'end-label end-label-dynamic' }, 'Dynamic')
      ]));
      input.addEventListener('input', function () {
        var next = Number(input.value);
        if (!steps[next] || next === selected) return;
        videos[selected].classList.add('hidden');
        videos[selected].setAttribute('aria-hidden', 'true');
        videos[next].classList.remove('hidden');
        videos[next].setAttribute('aria-hidden', 'false');
        selected = next;
        input.setAttribute('aria-valuetext', steps[next].label);
        // All five videos already share one playback clock. Switching strength
        // only changes which video is visible, at the existing playback time.
      });
      container.appendChild(slider);
      createPlayer(slider);
    });
  }

  function initialize() {
    var data = window.PAGE_DATA || {};
    var dynamic = document.getElementById('dynamic-container');
    var continuous = document.getElementById('continuous-container');
    document.querySelectorAll('.teaser-block').forEach(function (root) { createPlayer(root); });
    if (dynamic) renderDynamic(dynamic, data.dynamic || []);
    if (continuous) renderContinuous(continuous, data.continuous || []);
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) return;
          var player = playerByElement.get(entry.target);
          if (player && player.isEngaged()) player.pause();
        });
      }, { threshold: 0 });
      // Observe cards, never individual videos hidden by the motion slider.
      players.forEach(function (player) { observer.observe(player.root); });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && activePlayer) activePlayer.pause();
    });
    window.addEventListener('pagehide', function () {
      if (activePlayer) activePlayer.pause();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
