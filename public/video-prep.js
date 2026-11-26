/* Kandi video prep: if a clip already fits the upload cap, send the original
   .mov/.mp4 (iOS WKWebView transcode often drops AAC). Larger files are
   shrunk in the browser to ~720p H.264, trimmed to the first N seconds, with
   a poster frame. Shared by posts, stories, chat and profile video:
   window.KandiVideo.prepare(file, opts). */
(function () {
  "use strict";
  const TARGET_LONG = 1280;          // 720p (long side)
  const FPS = 30;
  const VIDEO_BPS = 2000000;         // ~2 Mbps video
  const AUDIO_BPS = 128000;          // 128 kbps AAC
  const PASSTHROUGH_BYTES = 60 * 1024 * 1024; // upload originals that already fit; iOS transcode drops audio
  const STALL_MS = 25000;

  let audioCtx = null;
  function getCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) { try { audioCtx = new AC(); } catch (_) { return null; } }
    return audioCtx;
  }
  // Call from a tap (e.g. the Add video button) so iOS lets us capture the clip's sound later.
  function unlock() {
    const c = getCtx();
    if (c && c.state === "suspended") { try { c.resume().catch(() => {}); } catch (_) {} }
  }

  function isVideoFile(file) {
    if (!file) return false;
    const typ = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    return typ.startsWith("video/") || /\.(mov|mp4|m4v|webm|qt|3gp)$/.test(name);
  }

  function makeVideoEl(url) {
    const v = document.createElement("video");
    v.preload = "auto";
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "true");
    v.crossOrigin = "anonymous";
    v.dataset.src = url; // caller sets src after muted/attach so playback setup is final first
    return v;
  }

  function waitFor(v, evt, ms) {
    return new Promise((resolve, reject) => {
      if (evt === "loadedmetadata" && v.readyState >= 1) return resolve();
      if (evt === "loadeddata" && v.readyState >= 2) return resolve();
      const t = setTimeout(() => { cleanup(); reject(new Error("Couldn't read that video. Try another one from your library.")); }, ms || 20000);
      const ok = () => { cleanup(); resolve(); };
      const bad = () => { cleanup(); try { console.warn("KandiVideo: load error", v.error && v.error.code, v.error && v.error.message); } catch (_) {} reject(new Error("Couldn't read that video. Try another one from your library.")); };
      function cleanup() { clearTimeout(t); v.removeEventListener(evt, ok); v.removeEventListener("error", bad); }
      v.addEventListener(evt, ok);
      v.addEventListener("error", bad);
    });
  }

  function fitSize(vw, vh) {
    vw = vw || 1280; vh = vh || 720;
    const scale = Math.min(1, TARGET_LONG / Math.max(vw, vh));
    const even = (n) => Math.max(2, Math.round(n / 2) * 2);
    return { w: even(vw * scale), h: even(vh * scale) };
  }

  function canvasToBlob(canvas, type, q) {
    return new Promise((resolve) => {
      try { canvas.toBlob((b) => resolve(b || null), type, q); } catch (_) { resolve(null); }
    });
  }

  // True when a canvas is (almost) all black: the frame wasn't decoded yet.
  function looksBlank(c) {
    try {
      const s = document.createElement("canvas");
      s.width = 16; s.height = 16;
      const g = s.getContext("2d");
      g.drawImage(c, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i], d[i + 1], d[i + 2]);
      return max < 8;
    } catch (_) { return false; }
  }
  async function posterFromCanvas(c) {
    if (looksBlank(c)) return null; // let the server pick a frame instead of saving a black poster
    return canvasToBlob(c, "image/jpeg", 0.85);
  }
  async function grabPoster(v) {
    try {
      const { w, h } = fitSize(v.videoWidth, v.videoHeight);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(v, 0, 0, w, h);
      return await posterFromCanvas(c);
    } catch (_) { return null; }
  }

  // Duration, size and a poster frame without decoding the whole clip. Retries: a WebView can briefly
  // refuse a new decoder while the previous one shuts down.
  async function probe(file) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1200));
      try { return await probeOnce(file); } catch (err) { lastErr = err; }
    }
    throw lastErr;
  }
  async function probeOnce(file) {
    const url = URL.createObjectURL(file);
    const v = makeVideoEl(url);
    v.muted = true;
    v.preload = "auto";
    v.src = url;
    try {
      await waitFor(v, "loadedmetadata", 20000);
      const duration = Number.isFinite(v.duration) ? v.duration : 0;
      let poster = null;
      try {
        await new Promise((resolve) => {
          const t = setTimeout(resolve, 6000);
          v.addEventListener("seeked", () => { clearTimeout(t); resolve(); }, { once: true });
          try { v.currentTime = Math.min(0.15, duration ? duration / 4 : 0.1); } catch (_) { clearTimeout(t); resolve(); }
        });
        if (typeof v.requestVideoFrameCallback === "function" && v.readyState < 2) {
          await new Promise((resolve) => { const t = setTimeout(resolve, 1500); v.requestVideoFrameCallback(() => { clearTimeout(t); resolve(); }); });
        }
        if (v.readyState >= 2) poster = await grabPoster(v);
      } catch (_) {}
      return { duration, width: v.videoWidth || 0, height: v.videoHeight || 0, poster };
    } finally {
      try { v.removeAttribute("src"); v.load(); } catch (_) {}
      URL.revokeObjectURL(url);
    }
  }

  let muxerLoading = null;
  function loadMuxer() {
    if (window.Mp4Muxer) return Promise.resolve(window.Mp4Muxer);
    if (!muxerLoading) {
      muxerLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "/vendor/mp4-muxer.js";
        s.onload = () => (window.Mp4Muxer ? resolve(window.Mp4Muxer) : reject(new Error("muxer missing")));
        s.onerror = () => { muxerLoading = null; reject(new Error("muxer failed to load")); };
        document.head.appendChild(s);
      });
    }
    return muxerLoading;
  }

  async function pickAvcConfig(w, h) {
    if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
    for (const codec of ["avc1.640028", "avc1.4D0028", "avc1.42E028", "avc1.42001F"]) {
      const cfg = { codec, width: w, height: h, bitrate: VIDEO_BPS, framerate: FPS, avc: { format: "avc" } };
      try {
        const r = await VideoEncoder.isConfigSupported(cfg);
        if (r && r.supported) return cfg;
      } catch (_) {}
    }
    return null;
  }

  async function pickAacConfig(sampleRate) {
    if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return null;
    const cfg = { codec: "mp4a.40.2", sampleRate, numberOfChannels: 2, bitrate: AUDIO_BPS };
    try {
      const r = await AudioEncoder.isConfigSupported(cfg);
      return r && r.supported ? cfg : null;
    } catch (_) { return null; }
  }

  function pickRecorderMime() {
    if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") return null;
    const list = ["video/mp4;codecs=avc1.42E01F,mp4a.40.2", "video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp8,opus", "video/webm"];
    for (const m of list) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) {} }
    return null;
  }

  function abortErr() { const e = new Error("Cancelled"); e.name = "AbortError"; return e; }

  // Plays the clip once (hidden) and re-encodes it. Real time: a 60s clip takes about 60s.
  async function transcode(file, opts) {
    const maxSeconds = opts.maxSeconds;
    const onProgress = opts.onProgress || (() => {});
    const signal = opts.signal;
    const url = URL.createObjectURL(file);
    const v = makeVideoEl(url);
    v.muted = Boolean(opts.skipAudio);
    v.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1";
    document.body.appendChild(v);
    v.src = url;
    const cleanups = [() => { try { v.pause(); v.removeAttribute("src"); v.load(); } catch (_) {} v.remove(); URL.revokeObjectURL(url); }];
    const cleanup = () => { while (cleanups.length) { try { cleanups.pop()(); } catch (_) {} } };
    let forcedMute = false;
    try {
      let loaded = false;
      for (let attempt = 0; attempt < 3 && !loaded; attempt++) {
        try {
          if (attempt) {
            // The decoder from the preview/probe may still be shutting down; give it a moment, and on the
            // last try open the clip silently (some WebViews refuse when sound is routed).
            await new Promise((r) => setTimeout(r, 1500));
            if (attempt === 2) { forcedMute = true; v.muted = true; }
            v.src = url;
          }
          await waitFor(v, "loadedmetadata", 30000);
          loaded = true;
        } catch (loadErr) {
          if (attempt === 2) throw loadErr;
        }
      }
      if (signal && signal.aborted) throw abortErr();
      const srcDuration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : maxSeconds;
      const limit = Math.min(srcDuration, maxSeconds);
      const { w, h } = fitSize(v.videoWidth, v.videoHeight);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const g = canvas.getContext("2d", { alpha: false });

      const ctx = getCtx();
      if (ctx && ctx.state === "suspended") { try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 800))]); } catch (_) {} }
      const ctxRunning = Boolean(ctx && ctx.state === "running");
      let srcNode = null;
      if (ctxRunning && !forcedMute && !opts.skipAudio) {
        try {
          srcNode = ctx.createMediaElementSource(v);
          cleanups.push(() => { try { srcNode.disconnect(); } catch (_) {} });
        } catch (_) { srcNode = null; }
      }
      if (!srcNode) v.muted = true; // never play the hidden copy out loud

      const avc = await pickAvcConfig(w, h);
      const aac = srcNode ? await pickAacConfig(ctx.sampleRate) : null;
      const recMime = pickRecorderMime();
      let mode;
      if (avc && aac) mode = "webcodecs";
      else if (recMime && /mp4/.test(recMime)) mode = "recorder";
      else if (avc) mode = "webcodecs";
      else if (recMime) mode = "recorder";
      else {
        const e = new Error("This phone can't shrink videos in the app. Try a clip under 60 MB.");
        e.code = "unsupported";
        throw e;
      }
      let Mux = null;
      if (mode === "webcodecs") {
        try { Mux = await loadMuxer(); } catch (err) {
          if (recMime) mode = "recorder"; else throw new Error("Couldn't load the video tools. Check your connection and try again.");
        }
      }

      let failed = null;
      let finishRec = null;
      const stopped = new Promise((resolve, reject) => { finishRec = { resolve, reject }; });
      const fail = (err) => { if (!failed) { failed = err || new Error("Couldn't prepare that video."); try { v.pause(); } catch (_) {} finishRec.reject(failed); } };

      let lastProgressAt = Date.now();
      let lastTime = -1;
      let playStartedAt = 0;
      let doneDrawing = false;
      let noAudio = !srcNode;
      let posterPromise = null;
      const posterAt = Math.min(0.5, limit / 2);
      const maybePoster = (mediaTime) => {
        if (!posterPromise && mediaTime >= posterAt && !looksBlank(canvas)) posterPromise = canvasToBlob(canvas, "image/jpeg", 0.85);
      };
      let outputMime = "video/mp4";
      let finalize;

      if (mode === "webcodecs") {
        const target = new Mux.ArrayBufferTarget();
        const muxer = new Mux.Muxer({
          target,
          video: { codec: "avc", width: w, height: h, frameRate: FPS },
          audio: aac ? { codec: "aac", numberOfChannels: 2, sampleRate: ctx.sampleRate } : undefined,
          fastStart: "in-memory",
          firstTimestampBehavior: "offset",
        });
        const frameUs = Math.round(1e6 / FPS);
        const venc = new VideoEncoder({
          output: (chunk, meta) => {
            try {
              if (chunk.duration == null || !(chunk.duration >= 0)) {
                // Some WebKit builds leave duration empty; give the muxer one frame's worth.
                const data = new Uint8Array(chunk.byteLength);
                chunk.copyTo(data);
                muxer.addVideoChunkRaw(data, chunk.type, chunk.timestamp, frameUs, meta);
              } else {
                muxer.addVideoChunk(chunk, meta);
              }
            } catch (e) { fail(e); }
          },
          error: fail,
        });
        venc.configure(avc);
        let aenc = null;
        let audioChunks = 0;
        if (aac) {
          aenc = new AudioEncoder({ output: (chunk, meta) => { try { muxer.addAudioChunk(chunk, meta); audioChunks += 1; } catch (e) { fail(e); } }, error: fail });
          aenc.configure(aac);
          const sp = ctx.createScriptProcessor(4096, 2, 2);
          const mute = ctx.createGain();
          mute.gain.value = 0;
          srcNode.connect(sp); sp.connect(mute); mute.connect(ctx.destination);
          cleanups.push(() => { try { sp.disconnect(); mute.disconnect(); } catch (_) {} sp.onaudioprocess = null; });
          let samples = 0;
          sp.onaudioprocess = (ev) => {
            if (doneDrawing || failed || v.paused || aenc.state !== "configured") return;
            const ib = ev.inputBuffer;
            const n = ib.length;
            const L = ib.getChannelData(0);
            const R = ib.numberOfChannels > 1 ? ib.getChannelData(1) : L;
            const data = new Float32Array(n * 2);
            data.set(L, 0); data.set(R, n);
            try {
              const ad = new AudioData({ format: "f32-planar", sampleRate: ib.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((samples / ib.sampleRate) * 1e6), data });
              aenc.encode(ad);
              ad.close();
            } catch (e) { fail(e); }
            samples += n;
          };
        } else {
          noAudio = true;
        }
        let lastTs = -1;
        let frames = 0;
        const minGap = 1 / FPS * 0.9;
        const onFrame = (mediaTime) => {
          if (doneDrawing || failed) return;
          if (lastTs >= 0 && mediaTime - lastTs < minGap) return;
          if (venc.encodeQueueSize > 8) return; // encoder busy: drop this frame rather than pile up memory
          lastTs = mediaTime;
          try {
            g.drawImage(v, 0, 0, w, h);
            maybePoster(mediaTime);
            const frame = new VideoFrame(canvas, { timestamp: Math.round(mediaTime * 1e6), duration: frameUs });
            venc.encode(frame, { keyFrame: frames % (FPS * 2) === 0 });
            frame.close();
            frames++;
          } catch (e) { fail(e); }
        };
        finalize = async () => {
          await venc.flush();
          if (aenc) { try { await aenc.flush(); } catch (_) {} }
          if (!frames) throw new Error("Couldn't read the frames in that video. Try another one.");
          muxer.finalize();
          try { venc.close(); } catch (_) {}
          try { aenc && aenc.close(); } catch (_) {}
          if (aenc && audioChunks === 0) noAudio = true;
          return new Blob([target.buffer], { type: "video/mp4" });
        };
        startFrameLoop(onFrame);
        stopped.catch(() => {});
        cleanups.push(() => { try { if (venc.state !== "closed") venc.close(); } catch (_) {} try { if (aenc && aenc.state !== "closed") aenc.close(); } catch (_) {} });
      } else {
        const stream = canvas.captureStream(FPS);
        if (srcNode) {
          try {
            const dest = ctx.createMediaStreamDestination();
            srcNode.connect(dest);
            dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
            cleanups.push(() => { try { dest.disconnect(); } catch (_) {} });
          } catch (_) { noAudio = true; }
        }
        outputMime = recMime.split(";")[0];
        const rec = new MediaRecorder(stream, { mimeType: recMime, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS });
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onerror = (e) => fail((e && e.error) || new Error("Recording failed"));
        const recStopped = new Promise((resolve) => { rec.onstop = resolve; });
        cleanups.push(() => { stream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} }); if (rec.state !== "inactive") { try { rec.stop(); } catch (_) {} } });
        g.drawImage(v, 0, 0, w, h);
        rec.start(1000);
        startFrameLoop((mt) => { if (!doneDrawing && !failed) { try { g.drawImage(v, 0, 0, w, h); maybePoster(mt); } catch (_) {} } });
        finalize = async () => {
          if (rec.state !== "inactive") rec.stop();
          await recStopped;
          return new Blob(chunks, { type: outputMime });
        };
      }

      function startFrameLoop(onFrame) {
        if (typeof v.requestVideoFrameCallback === "function") {
          const tick = (_now, meta) => {
            if (doneDrawing || failed) return;
            onFrame(meta && Number.isFinite(meta.mediaTime) ? meta.mediaTime : v.currentTime);
            v.requestVideoFrameCallback(tick);
          };
          v.requestVideoFrameCallback(tick);
        } else {
          const tick = () => {
            if (doneDrawing || failed) return;
            onFrame(v.currentTime);
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      }

      const finishPlayback = () => {
        if (doneDrawing) return;
        doneDrawing = true;
        try { v.pause(); } catch (_) {}
        finishRec.resolve();
      };
      v.addEventListener("ended", finishPlayback);
      v.addEventListener("error", () => fail(new Error("Couldn't play that video to shrink it. Try another one.")));
      const watcher = setInterval(() => {
        if (doneDrawing || failed) return;
        if (signal && signal.aborted) { fail(abortErr()); return; }
        const t = v.currentTime;
        if (t > lastTime + 0.01) { lastTime = t; lastProgressAt = Date.now(); }
        onProgress(Math.min(99, Math.round((t / limit) * 100)));
        if (t >= limit - 0.02) finishPlayback();
        else if (srcNode && playStartedAt && t < 0.01 && Date.now() - playStartedAt > 5000) {
          const e = new Error("Playback with sound stalled"); e.code = "audio_stall"; fail(e);
        }
        else if (Date.now() - lastProgressAt > STALL_MS) fail(new Error("Your video stopped while getting ready. Keep Kandi open and try again."));
        else if (v.paused && !v.ended) { v.play().catch(() => {}); }
      }, 200);
      cleanups.push(() => clearInterval(watcher));

      try {
        await v.play();
        playStartedAt = Date.now();
      } catch (err) {
        // Autoplay with sound blocked: fall back to silent playback so the video still goes up.
        v.muted = true;
        noAudio = true;
        await v.play();
        playStartedAt = Date.now();
      }
      await stopped;
      onProgress(99);
      const blob = await finalize();
      onProgress(100);
      const poster = posterPromise ? await posterPromise.catch(() => null) : null;
      return { blob, poster, mime: outputMime, trimmed: srcDuration > maxSeconds + 0.5, duration: limit, noAudio, mode, width: w, height: h };
    } finally {
      cleanup();
    }
  }

  async function prepare(file, opts) {
    opts = Object.assign({ maxSeconds: 60, passthroughBytes: PASSTHROUGH_BYTES, maxBytes: 60 * 1024 * 1024 }, opts || {});
    if (!isVideoFile(file)) throw new Error("Choose a video from your library.");
    let meta = opts.meta && opts.meta.duration ? opts.meta : null;
    if (!meta) {
      try { meta = await probe(file); } catch (_) { meta = { duration: 0, poster: null }; } // transcode still tries
    }
    const typ = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    const playableContainer = !/webm/.test(typ) && !/\.webm$/.test(name);
    const tooLong = meta.duration > opts.maxSeconds + 0.5;
    const passLimit = Math.max(Number(opts.passthroughBytes) || 0, Number(opts.maxBytes) || 0);
    const fitsUpload = playableContainer && file.size > 0 && file.size <= passLimit;
    // Prefer the original whenever it already fits. Client transcode in iOS
    // WKWebView (WebCodecs + MediaElementSource, or MediaRecorder on a muted
    // canvas stream) often yields no audio or a 0-channel AAC track. The
    // server remuxes with ffmpeg -c copy (trim + faststart) and keeps AAC.
    if (fitsUpload && !opts.forceTranscode) {
      if (opts.onProgress) opts.onProgress(100);
      return { file, poster: meta.poster, duration: meta.duration, trimmed: tooLong, transcoded: false, noAudio: false, mode: "original" };
    }
    function originalOk() {
      return { file, poster: meta.poster, duration: meta.duration, trimmed: tooLong, transcoded: false, noAudio: false, mode: "original" };
    }
    function audioLost() {
      const e = new Error("Couldn't keep the sound while shrinking that video. Trim it in Photos to under a minute and try again.");
      e.code = "audio_lost";
      return e;
    }
    let out;
    try {
      try {
        out = await transcode(file, opts);
        if (out && out.noAudio && !opts.skipAudio) {
          if (fitsUpload) return originalOk();
          throw audioLost();
        }
      } catch (first) {
        if (!first || first.code !== "audio_stall") throw first;
        if (fitsUpload) return originalOk();
        throw audioLost();
      }
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      try { console.warn("KandiVideo: shrink failed", err && (err.message || err)); } catch (_) {}
      // Could not shrink it here: a small enough original can still go up as is.
      if (fitsUpload) return originalOk();
      throw err;
    }
    if (out.blob.size > opts.maxBytes) throw new Error("That video is still too big after shrinking it. Try a shorter clip.");
    const ext = out.mime === "video/webm" ? ".webm" : ".mp4";
    const base = (String(file.name || "clip").replace(/\.[^.]+$/, "") || "clip").slice(0, 40);
    let outFile;
    try { outFile = new File([out.blob], base + ext, { type: out.mime }); } catch (_) { outFile = out.blob; outFile.name = base + ext; }
    return { file: outFile, poster: out.poster || meta.poster, duration: out.duration, trimmed: out.trimmed, transcoded: true, noAudio: out.noAudio, mode: out.mode, originalBytes: file.size };
  }

  // XHR upload with progress and friendly errors (fetch has no upload progress).
  function upload(url, formData, onProgress, timeoutMs) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.withCredentials = true;
      xhr.timeout = timeoutMs || 10 * 60 * 1000;
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText || "{}"); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
        let msg = body.error;
        if (!msg) {
          if (xhr.status === 413) msg = "That video is too big to send. Try a shorter clip.";
          else if (xhr.status === 401) msg = "Your session ended. Log in again.";
          else if (xhr.status >= 502) msg = "Kandi is waking up. Wait a few seconds and tap Post again.";
          else msg = "Upload failed. Try again.";
        }
        const err = new Error(msg);
        err.status = xhr.status;
        reject(err);
      };
      xhr.onerror = () => reject(new Error(navigator.onLine === false ? "You're offline. Reconnect and try again." : "Upload failed. Check your connection and try again."));
      xhr.ontimeout = () => reject(new Error("The upload took too long. Check your connection and try again."));
      xhr.send(formData);
    });
  }

  window.KandiVideo = { prepare, probe, upload, unlock, isVideoFile, PASSTHROUGH_BYTES };
})();
