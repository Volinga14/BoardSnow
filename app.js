/* Formigal Session AI PWA v1 */
(() => {
  "use strict";

  // ---------- Constants ----------
  const STATIONS = [
    { id: "formigal", name: "Formigal", lat: 42.7604, lon: -0.3655, zoom: 13 },
    { id: "panticosa", name: "Panticosa", lat: 42.7230, lon: -0.2822, zoom: 13 },
    { id: "baqueira", name: "Baqueira Beret", lat: 42.6992, lon: 0.9351, zoom: 13 },
    { id: "candanchu", name: "Candanchú", lat: 42.7889, lon: -0.5252, zoom: 13 }
  ];
  const DEFAULT_STATION = "formigal";

  const SPEED_SPIKE_KMH = 120;
  const MOVING_SPEED_KMH = 4; // above = moving
  const STOP_SPEED_KMH = 1.5;
  const MIN_RUN_POINTS = 6;
  const DRAFT_KEY = "formigalSessionDraft";
  const PREFS_KEY = "formigalSessionPrefs";

  // ---------- Simple helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const fmt2 = (n) => (n < 10 ? "0" + n : "" + n);
  const msToHMS = (ms = 0) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return `${fmt2(hh)}:${fmt2(mm)}:${fmt2(ss)}`;
  };
  const round = (n, d = 1) => Number.isFinite(n) ? Number(n.toFixed(d)) : 0;
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const nowIso = () => new Date().toISOString();
  const timeStr = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = (ts) => new Date(ts).toLocaleString();
  const haversineM = (a, b) => {
    const R = 6371000;
    const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLon / 2);
    const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function downloadFile(name, mime, content) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- IndexedDB ----------
  const DB = {
    db: null,
    open() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("formigal-session-ai", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          const sessions = db.createObjectStore("sessions", { keyPath: "id" });
          sessions.createIndex("byEnd", "endedAt");
          const media = db.createObjectStore("media", { keyPath: "id" });
          media.createIndex("bySession", "sessionId");
        };
        req.onsuccess = () => { this.db = req.result; resolve(); };
        req.onerror = () => reject(req.error);
      });
    },
    tx(store, mode = "readonly") {
      return this.db.transaction(store, mode).objectStore(store);
    },
    put(store, value) {
      return new Promise((res, rej) => {
        const req = this.tx(store, "readwrite").put(value);
        req.onsuccess = () => res(value);
        req.onerror = () => rej(req.error);
      });
    },
    get(store, key) {
      return new Promise((res, rej) => {
        const req = this.tx(store).get(key);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    },
    getAll(store) {
      return new Promise((res, rej) => {
        const req = this.tx(store).getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => rej(req.error);
      });
    },
    getAllByIndex(store, index, value) {
      return new Promise((res, rej) => {
        const req = this.tx(store).index(index).getAll(value);
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => rej(req.error);
      });
    },
    delete(store, key) {
      return new Promise((res, rej) => {
        const req = this.tx(store, "readwrite").delete(key);
        req.onsuccess = () => res();
        req.onerror = () => rej(req.error);
      });
    },
    clear(store) {
      return new Promise((res, rej) => {
        const req = this.tx(store, "readwrite").clear();
        req.onsuccess = () => res();
        req.onerror = () => rej(req.error);
      });
    }
  };

  // ---------- App state ----------
  const state = {
    active: null,          // active session object in memory
    tracking: { geoWatchId: null, timer: null, motionActive: false, wakeLock: null, lastPointTs: 0, gpsWatchdog: null, wakeRequestedBySession: false },
    motion: {
      lastAccelMag: null,
      lastRotMag: null,
      recent: [],
      calibratedNoise: null,
      jumpCandidateStart: null,
      lastMotionEventTs: 0,
      lastImpactTs: 0,
    },
    ui: {
      deferredInstall: null,
      liveMap: null,
      historyMap: null,
      liveLayers: { route: null, speedSegments: [], markers: [], currentMarker: null, accuracyCircle: null },
      historyLayers: { route: null, speedSegments: [] },
      selectedHistoryId: null,
      recordingVoice: null,
      mediaRecorder: null,
      mediaChunks: [],
      weatherData: null
    },
    cache: {
      sessions: [],
      media: []
    }
  };

  // ---------- Default session ----------
  function newSessionDraft() {
    const st = stationById($("#stationSelect")?.value || DEFAULT_STATION);
    return {
      id: uid(),
      name: ($("#sessionName")?.value || "").trim() || `Formigal ${new Date().toLocaleDateString()}`,
      tripName: ($("#tripName")?.value || "").trim(),
      type: $("#sessionType")?.value || "Snowboard",
      stationId: st.id,
      stationName: st.name,
      config: {
        gpsMode: $("#gpsMode")?.value || "balanced",
        phonePlacement: $("#phonePlacement")?.value || "jacket",
        snowCondition: $("#snowCondition")?.value || "polvo",
        visibility: $("#visibility")?.value || "buena",
        windLevel: $("#windLevel")?.value || "bajo",
        jumpEnabled: ($("#jumpToggle")?.value || "on") === "on"
      },
      startedAt: Date.now(),
      endedAt: null,
      status: "active",
      points: [],           // {ts,lat,lon,alt,acc,speedKmh,rawSpeedKmh}
      motionPoints: [],     // {ts, accelMag, rotMag, intensity}
      events: [],           // {id, ts, type, label, ...}
      notes: [],            // {id, ts, text}
      mediaRefs: [],        // {id, ts, kind, name}
      metrics: {
        distanceM: 0,
        movingMs: 0,
        pausedMs: 0,
        ascentM: 0,
        descentM: 0,
        maxSpeedKmh: 0,
        avgSpeedKmh: 0,
        jumps: 0
      },
      runs: [],
      summary: null,
      weather: null
    };
  }

  function stationById(id) {
    return STATIONS.find(s => s.id === id) || STATIONS[0];
  }

  // ---------- UI init ----------
  function initStations() {
    const select = $("#stationSelect");
    select.innerHTML = STATIONS.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
    select.value = DEFAULT_STATION;
    select.addEventListener("change", () => {
      const st = stationById(select.value);
      $("#stationLabel").textContent = st.name;
      if (state.ui.liveMap) state.ui.liveMap.setView([st.lat, st.lon], st.zoom);
      savePrefs();
      renderMeteoSessionContext();
    });
    $("#stationLabel").textContent = stationById(select.value).name;
  }

  function initTabs() {
    $$(".tab").forEach(btn => btn.addEventListener("click", () => {
      $$(".tab").forEach(b => b.classList.remove("active"));
      $$(".tab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      $("#tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "history") {
        setTimeout(() => {
          state.ui.historyMap?.invalidateSize();
        }, 50);
      }
      if (btn.dataset.tab === "live") {
        setTimeout(() => {
          state.ui.liveMap?.invalidateSize();
        }, 50);
      }
      if (btn.dataset.tab === "meteo") {
        renderWeatherBox();
        renderMeteoSessionContext();
      }
    }));
  }

  function initThemeControls() {
    $("#themeBtn").addEventListener("click", () => {
      const root = $("#app");
      root.classList.toggle("theme-light");
      root.classList.toggle("theme-dark");
      savePrefs();
    });
    $("#contrastBtn").addEventListener("click", () => {
      $("#app").classList.toggle("high-contrast");
      savePrefs();
    });
  }

  function savePrefs() {
    const prefs = {
      themeLight: $("#app").classList.contains("theme-light"),
      highContrast: $("#app").classList.contains("high-contrast"),
      station: $("#stationSelect").value,
      gpsMode: $("#gpsMode").value,
      phonePlacement: $("#phonePlacement").value,
      wakeOnStart: $("#wakeOnStart")?.checked ?? true,
      followMap: $("#followMapToggle")?.checked ?? true,
      calibration: state.motion.calibratedNoise || null
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }

  function loadPrefs() {
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (prefs.themeLight) {
        $("#app").classList.add("theme-light");
        $("#app").classList.remove("theme-dark");
      }
      if (prefs.highContrast) $("#app").classList.add("high-contrast");
      if (prefs.station) $("#stationSelect").value = prefs.station;
      if (prefs.gpsMode) $("#gpsMode").value = prefs.gpsMode;
      if (prefs.phonePlacement) $("#phonePlacement").value = prefs.phonePlacement;
      if (typeof prefs.wakeOnStart === "boolean" && $("#wakeOnStart")) $("#wakeOnStart").checked = prefs.wakeOnStart;
      if (typeof prefs.followMap === "boolean" && $("#followMapToggle")) $("#followMapToggle").checked = prefs.followMap;
      if (prefs.calibration) {
        state.motion.calibratedNoise = prefs.calibration;
        $("#calibrationState").textContent = `sí (${round(prefs.calibration.accelMean || 0,2)} ± ${round(prefs.calibration.accelSd || 0,2)})`;
      }
      $("#stationLabel").textContent = stationById($("#stationSelect").value).name;
    } catch {}
  }

  // ---------- Leaflet ----------
  function initMaps() {
    const st = stationById($("#stationSelect").value);
    state.ui.liveMap = L.map("map", { zoomControl: true }).setView([st.lat, st.lon], st.zoom);
    state.ui.historyMap = L.map("historyMap", { zoomControl: true }).setView([st.lat, st.lon], st.zoom);
    [state.ui.liveMap, state.ui.historyMap].forEach(map => {
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap"
      }).addTo(map);
      const skiIcon = L.divIcon({
        className: "ski-marker",
        html: `<div style="background:#111827;color:white;border:1px solid #fff;border-radius:999px;padding:2px 6px;font-size:11px">⛷️</div>`
      });
      L.marker([st.lat, st.lon], { icon: skiIcon }).addTo(map).bindPopup(st.name);
    });
    setTimeout(() => {
      state.ui.liveMap?.invalidateSize();
      state.ui.historyMap?.invalidateSize();
    }, 120);
  }

  function clearLiveRouteLayers() {
    const m = state.ui.liveMap;
    if (!m) return;
    if (state.ui.liveLayers.route) { m.removeLayer(state.ui.liveLayers.route); state.ui.liveLayers.route = null; }
    state.ui.liveLayers.speedSegments.forEach(seg => m.removeLayer(seg));
    state.ui.liveLayers.speedSegments = [];
    state.ui.liveLayers.markers.forEach(marker => m.removeLayer(marker));
    state.ui.liveLayers.markers = [];
  }

  function drawRouteOnMap(map, layersObj, points, colorBySpeed) {
    if (!map) return;
    if (layersObj.route) { map.removeLayer(layersObj.route); layersObj.route = null; }
    (layersObj.speedSegments || []).forEach(s => map.removeLayer(s));
    layersObj.speedSegments = [];
    if (!points || points.length < 2) return;
    const latlngs = points.map(p => [p.lat, p.lon]);

    if (!colorBySpeed) {
      layersObj.route = L.polyline(latlngs, { color: "#56b6ff", weight: 4, opacity: 0.9 }).addTo(map);
    } else {
      for (let i = 1; i < points.length; i++) {
        const p0 = points[i - 1], p1 = points[i];
        const sp = p1.speedKmh || 0;
        const color = speedToColor(sp);
        const seg = L.polyline([[p0.lat, p0.lon], [p1.lat, p1.lon]], { color, weight: 4, opacity: 0.95 });
        seg.addTo(map);
        layersObj.speedSegments.push(seg);
      }
    }
  }

  function speedToColor(kmh) {
    // blue -> green -> yellow -> orange -> red
    if (kmh < 10) return "#3b82f6";
    if (kmh < 20) return "#22c55e";
    if (kmh < 35) return "#eab308";
    if (kmh < 50) return "#f97316";
    return "#ef4444";
  }

  function fitMapToPoints(map, points) {
    if (!map || !points || points.length < 2) return;
    const bounds = L.latLngBounds(points.map(p => [p.lat, p.lon]));
    map.fitBounds(bounds.pad(0.1));
  }


  function updateLiveLocationMarker(point) {
    const map = state.ui.liveMap;
    if (!map || !point) return;
    const latlng = [point.lat, point.lon];
    if (!state.ui.liveLayers.currentMarker) {
      state.ui.liveLayers.currentMarker = L.circleMarker(latlng, {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: "#2563eb",
        fillOpacity: 0.95
      }).addTo(map).bindPopup("Tu ubicación");
    } else {
      state.ui.liveLayers.currentMarker.setLatLng(latlng);
      state.ui.liveLayers.currentMarker.bringToFront();
    }
    if (!state.ui.liveLayers.accuracyCircle) {
      state.ui.liveLayers.accuracyCircle = L.circle(latlng, {
        radius: point.acc || 8,
        color: "#60a5fa",
        weight: 1,
        opacity: 0.75,
        fillOpacity: 0.08
      }).addTo(map);
    } else {
      state.ui.liveLayers.accuracyCircle.setLatLng(latlng);
      if (point.acc) state.ui.liveLayers.accuracyCircle.setRadius(point.acc);
    }
    state.ui.lastKnownPosition = { lat: point.lat, lon: point.lon, acc: point.acc || null, ts: point.ts };
  }

  function centerOnCurrentLocation() {
    const p = state.active?.points?.[state.active.points.length - 1] || state.ui.lastKnownPosition;
    if (p && state.ui.liveMap) {
      state.ui.liveMap.setView([p.lat, p.lon], Math.max(state.ui.liveMap.getZoom(), 15));
      return;
    }
    if (!navigator.geolocation) {
      setWarning("Geolocalización no soportada.");
      return;
    }
    navigator.geolocation.getCurrentPosition((pos) => {
      const c = pos.coords;
      const point = { lat: c.latitude, lon: c.longitude, acc: Number.isFinite(c.accuracy) ? c.accuracy : null, ts: pos.timestamp || Date.now() };
      updateLiveLocationMarker(point);

    const followOn = $("#followMapToggle")?.checked ?? true;
      state.ui.liveMap?.setView([point.lat, point.lon], 15);
    }, (err) => {
      setWarning("No se pudo centrar en tu ubicación: " + (err.message || err));
    }, { enableHighAccuracy: false, timeout: 10000 });
  }

  function fitCurrentTrack() {
    const pts = state.active?.points || [];
    if (pts.length >= 2) {
      fitMapToPoints(state.ui.liveMap, pts);
    } else {
      centerOnCurrentLocation();
    }
  }

  function openPisteFullscreen() {
    const modal = $("#pisteFullscreenModal");
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closePisteFullscreen() {
    const modal = $("#pisteFullscreenModal");
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  // ---------- Permissions ----------
  async function requestLocationPermission() {
    try {
      setWarning("Solicitando permiso de ubicación…");
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 10000 });
      });
      $("#gpsStatus").textContent = "GPS: OK";
      setWarning("Ubicación activada.");
    } catch (err) {
      $("#gpsStatus").textContent = "GPS: error";
      setWarning("No se pudo obtener ubicación: " + (err.message || err));
    }
  }

  async function requestMotionPermission() {
    try {
      // iOS pattern (Android usually not required, but harmless)
      if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== "granted") throw new Error("Permiso movimiento denegado");
      }
      state.tracking.motionActive = true;
      $("#motionStatus").textContent = "Movimiento: OK";
      setWarning("Permiso de movimiento listo.");
    } catch (err) {
      $("#motionStatus").textContent = "Movimiento: error";
      setWarning("No se pudo activar movimiento: " + (err.message || err));
    }
  }

  async function requestMicPermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      $("#micStatus").textContent = "Mic: OK";
      stream.getTracks().forEach(t => t.stop());
      setWarning("Micrófono activado.");
    } catch (err) {
      $("#micStatus").textContent = "Mic: error";
      setWarning("Micrófono no disponible: " + (err.message || err));
    }
  }

  // ---------- Session controls ----------
  function bindControlButtons() {
    $("#startBtn").addEventListener("click", startSession);
    $("#pauseResumeBtn").addEventListener("click", togglePauseResume);
    $("#stopBtn").addEventListener("click", stopSession);
    $("#markerBtn").addEventListener("click", () => addEvent("marker", "Marcador rápido"));
    $("#generateSummaryBtn").addEventListener("click", generateRecapText);
    $("#shareTextBtn").addEventListener("click", shareSummaryText);
    $("#summaryImageBtn").addEventListener("click", downloadSummaryImage);
    $("#weatherBtn").addEventListener("click", fetchWeatherForSelectedStation);
    $("#calibrateBtn").addEventListener("click", calibrateSensors);
    $("#permLocation").addEventListener("click", requestLocationPermission);
    $("#permMotion").addEventListener("click", requestMotionPermission);
    $("#permMic")?.addEventListener("click", requestMicPermission);
    $("#wakeBtn").addEventListener("click", toggleWakeLock);
    $("#weatherTabRefreshBtn")?.addEventListener("click", fetchWeatherForSelectedStation);
    $("#centerMapBtn")?.addEventListener("click", centerOnCurrentLocation);
    $("#fitTrackBtn")?.addEventListener("click", fitCurrentTrack);
    $("#openPisteFullscreenBtn")?.addEventListener("click", openPisteFullscreen);
    $("#closePisteFullscreenBtn")?.addEventListener("click", closePisteFullscreen);
    $("#closePisteFullscreenBackdrop")?.addEventListener("click", closePisteFullscreen);
    $("#formigalPisteMapImg")?.addEventListener("click", openPisteFullscreen);

    $("#gpsMode").addEventListener("change", savePrefs);
    $("#phonePlacement").addEventListener("change", savePrefs);
    $("#wakeOnStart")?.addEventListener("change", savePrefs);
    $("#followMapToggle")?.addEventListener("change", savePrefs);
    $("#restartGpsBtn")?.addEventListener("click", () => restartGeoWatchIfActive("manual"));

    $("#addNoteBtn")?.addEventListener("click", () => {
      const noteInput = $("#noteText");
      const text = noteInput?.value.trim();
      if (!text) return;
      if (!state.active) {
        setWarning("Empieza una sesión para añadir notas al timeline.");
        return;
      }
      const note = { id: uid(), ts: Date.now(), text };
      state.active.notes.push(note);
      state.active.events.push({ id: uid(), ts: note.ts, type: "note", label: text });
      noteInput.value = "";
      renderTimeline();
      saveDraft();
    });

    $("#recordVoiceBtn")?.addEventListener("click", startVoiceNote);
    $("#stopVoiceBtn")?.addEventListener("click", stopVoiceNote);
    $("#mediaPicker")?.addEventListener("change", handleMediaPicked);

    $("#speedColorToggle").addEventListener("change", () => {
      if (state.active?.points?.length) drawRouteOnMap(state.ui.liveMap, state.ui.liveLayers, state.active.points, $("#speedColorToggle").checked);
    });
  }

  function togglePauseResume() {
    if (!state.active) return;
    if (state.active.status === "active") return pauseSession();
    if (state.active.status === "paused") return resumeSession();
  }

  function setSessionButtons(mode) {
    const started = mode === "started";
    const paused = mode === "paused";
    const stopped = mode === "stopped";
    $("#startBtn").disabled = started || paused;
    const pr = $("#pauseResumeBtn");
    pr.disabled = !(started || paused);
    pr.classList.remove("warn", "ok");
    if (started) {
      pr.classList.add("warn");
      pr.textContent = "⏸ Pause";
    } else if (paused) {
      pr.classList.add("ok");
      pr.textContent = "⏵ Resume";
    } else {
      pr.classList.add("warn");
      pr.textContent = "⏸ Pause";
    }
    $("#stopBtn").disabled = !(started || paused);
  }

  async function startSession() {
    if (state.active && state.active.status !== "stopped") {
      setWarning("Ya hay una sesión activa.");
      return;
    }
    state.active = newSessionDraft();
    state.active.events.push({ id: uid(), ts: Date.now(), type: "session", label: "Inicio de sesión" });
    clearLiveRouteLayers();
    state.ui.liveMap.setView([stationById(state.active.stationId).lat, stationById(state.active.stationId).lon], stationById(state.active.stationId).zoom);

    startGeoWatch();
    startMotionCapture();
    startSessionTimer();
    startGpsWatchdog();
    if ($("#wakeOnStart")?.checked && !state.tracking.wakeLock) {
      state.tracking.wakeRequestedBySession = true;
      await requestWakeLockSafe(true);
    } else {
      state.tracking.wakeRequestedBySession = false;
    }
    setSessionButtons("started");
    setWarning("Sesión iniciada. Mantén la app en primer plano para mejor tracking.");
    renderAllLive();
    saveDraft();
  }

  async function pauseSession() {
    if (!state.active || state.active.status !== "active") return;
    state.active.status = "paused";
    state.active.events.push({ id: uid(), ts: Date.now(), type: "session", label: "Pausa" });
    stopGeoWatch();
    stopMotionCapture();
    stopSessionTimer();
    stopGpsWatchdog();
    if (state.tracking.wakeRequestedBySession && state.tracking.wakeLock) {
      try { await state.tracking.wakeLock.release(); } catch {}
    }
    state.tracking.wakeRequestedBySession = false;
    setSessionButtons("paused");
    saveDraft();
    renderTimeline();
  }

  async function resumeSession() {
    if (!state.active || state.active.status !== "paused") return;
    state.active.status = "active";
    state.active.events.push({ id: uid(), ts: Date.now(), type: "session", label: "Reanudada" });
    startGeoWatch();
    startMotionCapture();
    startSessionTimer();
    startGpsWatchdog();
    if ($("#wakeOnStart")?.checked && !state.tracking.wakeLock) {
      state.tracking.wakeRequestedBySession = true;
      await requestWakeLockSafe(true);
    } else {
      state.tracking.wakeRequestedBySession = false;
    }
    setSessionButtons("started");
    saveDraft();
    renderTimeline();
  }

  async function stopSession() {
    if (!state.active) return;
    stopGeoWatch();
    stopMotionCapture();
    stopSessionTimer();
    stopGpsWatchdog();
    if (state.tracking.wakeRequestedBySession && state.tracking.wakeLock) {
      try { await state.tracking.wakeLock.release(); } catch {}
    }
    state.tracking.wakeRequestedBySession = false;
    state.active.endedAt = Date.now();
    state.active.status = "stopped";
    state.active.events.push({ id: uid(), ts: Date.now(), type: "session", label: "Fin de sesión" });

    computeSessionMetrics(state.active);
    state.active.runs = detectRuns(state.active.points);
    state.active.summary = buildSummary(state.active);
    state.active.weather = state.ui.weatherData || state.active.weather || null;

    await DB.put("sessions", structuredClone(state.active));
    localStorage.removeItem(DRAFT_KEY);
    setSessionButtons("stopped");
    setWarning("Sesión guardada en historial.");
    await refreshCaches();
    await renderHistory();
    renderAllLive();
  }

  function addEvent(type, label, extra = {}) {
    if (!state.active) return;
    state.active.events.push({ id: uid(), ts: Date.now(), type, label, ...extra });
    if (type === "marker" && state.active.points.length) {
      const p = state.active.points[state.active.points.length - 1];
      const marker = L.marker([p.lat, p.lon]).addTo(state.ui.liveMap).bindPopup(label);
      state.ui.liveLayers.markers.push(marker);
    }
    renderTimeline();
    saveDraft();
  }

  // ---------- Geo tracking ----------
  function startGeoWatch() {
    if (!navigator.geolocation) {
      setWarning("Geolocalización no soportada.");
      return;
    }
    if (state.tracking.geoWatchId != null) {
      navigator.geolocation.clearWatch(state.tracking.geoWatchId);
      state.tracking.geoWatchId = null;
    }
    const gpsMode = $("#gpsMode").value;
    const opts = {
      enableHighAccuracy: gpsMode === "high",
      maximumAge: gpsMode === "high" ? 500 : 2000,
      timeout: 10000
    };
    state.tracking.geoWatchId = navigator.geolocation.watchPosition(onGeoPoint, onGeoError, opts);
    state.tracking.lastPointTs = Date.now();
    $("#gpsStatus").textContent = `GPS: tracking (${gpsMode})`;
    $("#batteryStatus").textContent = gpsMode === "high" ? "Batería: alta precisión" : "Batería: equilibrado";
  }

  function stopGeoWatch() {
    if (state.tracking.geoWatchId != null) {
      navigator.geolocation.clearWatch(state.tracking.geoWatchId);
      state.tracking.geoWatchId = null;
      state.tracking.lastPointTs = 0;
      $("#gpsStatus").textContent = "GPS: pausado";
    }
  }

  function onGeoError(err) {
    const msg = err?.message || "error desconocido";
    setWarning("Error GPS: " + msg + ". Si acabas de desbloquear el móvil, pulsa ‘Reintentar GPS’." );
    $("#gpsStatus").textContent = "GPS: error";
    if (state.active?.status === "active") {
      setTimeout(() => restartGeoWatchIfActive("error GPS"), 1200);
    }
  }

  function onGeoPoint(pos) {
    if (!state.active || state.active.status !== "active") return;
    const c = pos.coords;
    const point = {
      ts: pos.timestamp || Date.now(),
      lat: c.latitude,
      lon: c.longitude,
      alt: Number.isFinite(c.altitude) ? c.altitude : null,
      acc: Number.isFinite(c.accuracy) ? c.accuracy : null,
      rawSpeedKmh: Number.isFinite(c.speed) ? c.speed * 3.6 : null,
      speedKmh: 0
    };

    state.tracking.lastPointTs = point.ts;
    $("#gpsStatus").textContent = `GPS: tracking (${$("#gpsMode")?.value || "balanced"})`;

    // Filter low quality points
    if (point.acc && point.acc > 80) {
      return; // too noisy
    }

    const pts = state.active.points;
    if (pts.length) {
      const prev = pts[pts.length - 1];
      const dt = (point.ts - prev.ts) / 1000;
      if (dt <= 0.1) return;
      const d = haversineM(prev, point);
      let calcSpeed = (d / dt) * 3.6;
      let candidate = Number.isFinite(point.rawSpeedKmh) ? point.rawSpeedKmh : calcSpeed;
      // sanity compare and clamp
      if (Math.abs(calcSpeed - candidate) > 35) candidate = calcSpeed;
      // spike filtering
      const prevSpeed = prev.speedKmh || 0;
      const accel = Math.abs(candidate - prevSpeed) / Math.max(dt, 0.5); // kmh/s
      if (candidate > SPEED_SPIKE_KMH || accel > 40) {
        candidate = Math.min(calcSpeed, prevSpeed + 15); // softened
      }
      point.speedKmh = round(candidate, 1);

      // metrics incremental
      state.active.metrics.distanceM += d;
      if (point.speedKmh >= MOVING_SPEED_KMH) {
        state.active.metrics.movingMs += (point.ts - prev.ts);
      } else {
        state.active.metrics.pausedMs += (point.ts - prev.ts);
      }
      if (Number.isFinite(point.alt) && Number.isFinite(prev.alt)) {
        const da = point.alt - prev.alt;
        if (Math.abs(da) < 20) { // avoid alt spikes
          if (da > 0) state.active.metrics.ascentM += da;
          if (da < 0) state.active.metrics.descentM += Math.abs(da);
        }
      }
      state.active.metrics.maxSpeedKmh = Math.max(state.active.metrics.maxSpeedKmh, point.speedKmh);
      const movingPts = pts.filter(p => (p.speedKmh || 0) >= MOVING_SPEED_KMH).length + (point.speedKmh >= MOVING_SPEED_KMH ? 1 : 0);
      const sumSpeed = pts.reduce((s, p) => s + ((p.speedKmh || 0) >= MOVING_SPEED_KMH ? p.speedKmh : 0), 0) + (point.speedKmh >= MOVING_SPEED_KMH ? point.speedKmh : 0);
      state.active.metrics.avgSpeedKmh = movingPts ? sumSpeed / movingPts : 0;
    } else {
      point.speedKmh = 0;
      // first point marker
      const m = L.circleMarker([point.lat, point.lon], { radius: 5, color: "#22c55e" }).addTo(state.ui.liveMap).bindPopup("Inicio");
      state.ui.liveLayers.markers.push(m);
      state.ui.liveMap.setView([point.lat, point.lon], 15);
    }

    pts.push(point);
    updateLiveLocationMarker(point);

    const followOn = $("#followMapToggle")?.checked ?? true;

    // Detect state change events (stops, movement, lift/descent approximate)
    maybeEmitMovementEvents();

    drawRouteOnMap(state.ui.liveMap, state.ui.liveLayers, pts, $("#speedColorToggle").checked);
    if (followOn) {
      state.ui.liveMap.panTo([point.lat, point.lon], { animate: false });
    }
    updateLiveStats();
    renderTimelineThrottled();
    saveDraftThrottled();
  }

  let _draftSaveTimer = null, _timelineTimer = null;
  function saveDraftThrottled() {
    if (_draftSaveTimer) return;
    _draftSaveTimer = setTimeout(() => { _draftSaveTimer = null; saveDraft(); }, 2500);
  }
  function renderTimelineThrottled() {
    if (_timelineTimer) return;
    _timelineTimer = setTimeout(() => { _timelineTimer = null; renderTimeline(); }, 1000);
  }

  function maybeEmitMovementEvents() {
    const pts = state.active.points;
    if (pts.length < 2) return;
    const p = pts[pts.length - 1];
    const recent = pts.slice(-10);
    const avgAltDelta = recent.length > 1 && recent[0].alt != null && recent[recent.length - 1].alt != null
      ? (recent[recent.length - 1].alt - recent[0].alt) / (recent.length - 1)
      : 0;

    let mode = "stop";
    if (p.speedKmh >= MOVING_SPEED_KMH) {
      mode = avgAltDelta > 0.6 ? "lift" : "run";
    } else if (p.speedKmh > STOP_SPEED_KMH) {
      mode = "slow";
    }
    const lastMode = state.active._lastMode || null;
    if (mode !== lastMode) {
      state.active._lastMode = mode;
      const labels = {
        stop: "Parada",
        slow: "Movimiento suave",
        lift: "Remonte (aprox)",
        run: "Bajada (aprox)"
      };
      addEvent(mode, labels[mode], { speedKmh: p.speedKmh });
    }
  }

  function startSessionTimer() {
    stopSessionTimer();
    state.tracking.timer = setInterval(() => {
      updateLiveStats();
      saveDraftThrottled();
    }, 1000);
  }

  function stopSessionTimer() {
    if (state.tracking.timer) clearInterval(state.tracking.timer);
    state.tracking.timer = null;
  }

  // ---------- Motion sensors ----------
  function startMotionCapture() {
    if (state.tracking.motionActive) {
      // already okay
    }
    window.addEventListener("devicemotion", onDeviceMotion);
    state.tracking.motionActive = true;
    $("#motionStatus").textContent = "Movimiento: tracking";
  }
  function stopMotionCapture() {
    window.removeEventListener("devicemotion", onDeviceMotion);
    $("#motionStatus").textContent = "Movimiento: pausado";
  }

  function onDeviceMotion(ev) {
    const ts = Date.now();
    if (!state.active || state.active.status !== "active") return;

    // throttle ~8 Hz
    if (ts - state.motion.lastMotionEventTs < 120) return;
    state.motion.lastMotionEventTs = ts;

    const acc = ev.accelerationIncludingGravity || ev.acceleration || {};
    const rot = ev.rotationRate || {};
    const ax = Number(acc.x || 0), ay = Number(acc.y || 0), az = Number(acc.z || 0);
    const rx = Number(rot.alpha || 0), ry = Number(rot.beta || 0), rz = Number(rot.gamma || 0);

    const accelMag = Math.sqrt(ax * ax + ay * ay + az * az); // includes gravity typically
    const rotMag = Math.sqrt(rx * rx + ry * ry + rz * rz);
    state.motion.lastAccelMag = accelMag;
    state.motion.lastRotMag = rotMag;

    // derive intensity from deviation from calibrated baseline or gravity
    const baseline = state.motion.calibratedNoise?.accelMean ?? 9.8;
    const delta = Math.abs(accelMag - baseline);
    state.motion.recent.push({ ts, delta, rotMag });
    state.motion.recent = state.motion.recent.filter(r => ts - r.ts < 12000);
    const intensityScore = computeIntensity(state.motion.recent);
    const intensityLabel = intensityScore < 0.9 ? "suave" : intensityScore < 1.8 ? "medio" : "agresivo";

    $("#accelLive").textContent = `${round(accelMag,2)}`;
    $("#rotLive").textContent = `${round(rotMag,1)}`;
    $("#intensityLive").textContent = intensityLabel;

    // save motion point
    state.active.motionPoints.push({ ts, accelMag: round(accelMag, 3), rotMag: round(rotMag, 2), intensity: intensityScore });
    if (state.active.motionPoints.length % 6 === 0) {
      renderTimelineThrottled();
      saveDraftThrottled();
    }

    // action segment detection (yellow)
    if (delta > 2.2 || rotMag > 120) {
      const lastAction = [...state.active.events].reverse().find(e => e.type === "action");
      if (!lastAction || ts - lastAction.ts > 5000) {
        addEvent("action", `Tramo con acción (${intensityLabel})`, { intensity: intensityLabel });
      }
    }

    // jump estimation (very approximate)
    if (state.active.config.jumpEnabled) detectJump(accelMag, ts, intensityLabel);

    // possible fall (impact + movement)
    if (accelMag > 23 && ts - state.motion.lastImpactTs > 3000) {
      state.motion.lastImpactTs = ts;
      addEvent("fall", "Posible caída / impacto", { g: round(accelMag / 9.81, 1) });
    }
  }

  function computeIntensity(recent) {
    if (!recent.length) return 0;
    const avgDelta = recent.reduce((s, r) => s + r.delta, 0) / recent.length;
    const avgRot = recent.reduce((s, r) => s + r.rotMag, 0) / recent.length;
    return (avgDelta * 0.45) + (avgRot / 130);
  }

  function detectJump(accelMag, ts, intensityLabel) {
    const lowThresh = 5.5;
    const impactThresh = 17;
    if (accelMag < lowThresh && !state.motion.jumpCandidateStart) {
      state.motion.jumpCandidateStart = ts;
    }
    if (state.motion.jumpCandidateStart && ts - state.motion.jumpCandidateStart > 1200) {
      state.motion.jumpCandidateStart = null; // too long
    }
    if (state.motion.jumpCandidateStart && accelMag > impactThresh) {
      const airtimeMs = ts - state.motion.jumpCandidateStart;
      if (airtimeMs >= 120 && airtimeMs <= 1200) {
        state.active.metrics.jumps += 1;
        addEvent("jump", `Salto detectado (~${airtimeMs} ms airtime)`, { airtimeMs, intensity: intensityLabel });
      }
      state.motion.jumpCandidateStart = null;
    }
  }

  async function calibrateSensors() {
    setWarning("Calibrando sensores 5s… deja el móvil quieto.");
    const startTs = Date.now();
    const sample = [];
    const listener = (ev) => {
      const acc = ev.accelerationIncludingGravity || ev.acceleration || {};
      const ax = Number(acc.x || 0), ay = Number(acc.y || 0), az = Number(acc.z || 0);
      sample.push(Math.sqrt(ax*ax + ay*ay + az*az));
    };
    window.addEventListener("devicemotion", listener);
    await new Promise(r => setTimeout(r, 5000));
    window.removeEventListener("devicemotion", listener);

    if (!sample.length) {
      setWarning("No hubo datos de sensor. Comprueba permisos de movimiento.");
      return;
    }
    const mean = sample.reduce((a,b)=>a+b,0)/sample.length;
    const sd = Math.sqrt(sample.reduce((s,v)=>s+Math.pow(v-mean,2),0)/sample.length);
    state.motion.calibratedNoise = { accelMean: mean, accelSd: sd, ts: Date.now() };
    $("#calibrationState").textContent = `sí (${round(mean,2)} ± ${round(sd,2)})`;
    setWarning("Calibración guardada.");
    savePrefs();
    saveDraftThrottled();
  }

  // ---------- Voice notes + media ----------
  async function startVoiceNote() {
    if (!state.active) {
      setWarning("Empieza una sesión antes de grabar notas de voz.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      state.ui.mediaChunks = [];
      state.ui.mediaRecorder = rec;
      state.ui.recordingVoice = { stream, startedAt: Date.now() };
      rec.ondataavailable = (e) => { if (e.data.size) state.ui.mediaChunks.push(e.data); };
      rec.onstop = async () => {
        const blob = new Blob(state.ui.mediaChunks, { type: rec.mimeType || "audio/webm" });
        const mediaId = uid();
        const mediaObj = {
          id: mediaId,
          sessionId: state.active.id,
          kind: "audio",
          name: `voice-${new Date().toISOString().replace(/[:.]/g,'-')}.webm`,
          ts: state.ui.recordingVoice?.startedAt || Date.now(),
          blob
        };
        await DB.put("media", mediaObj);
        state.active.mediaRefs.push({ id: mediaId, ts: mediaObj.ts, kind: "audio", name: mediaObj.name });
        state.active.events.push({ id: uid(), ts: mediaObj.ts, type: "voice", label: "Nota de voz" });
        renderMediaPreview();
        renderTimeline();
        saveDraft();
        if (state.ui.recordingVoice?.stream) state.ui.recordingVoice.stream.getTracks().forEach(t => t.stop());
        state.ui.recordingVoice = null;
      };
      rec.start();
      if ($("#recordVoiceBtn")) $("#recordVoiceBtn").disabled = true;
      if ($("#stopVoiceBtn")) $("#stopVoiceBtn").disabled = false;
      setWarning("Grabando nota de voz…");
    } catch (err) {
      setWarning("No se pudo grabar audio: " + (err.message || err));
    }
  }

  function stopVoiceNote() {
    if (!state.ui.mediaRecorder) return;
    state.ui.mediaRecorder.stop();
    if ($("#recordVoiceBtn")) $("#recordVoiceBtn").disabled = false;
    if ($("#stopVoiceBtn")) $("#stopVoiceBtn").disabled = true;
    setWarning("Nota de voz guardada.");
  }

  async function handleMediaPicked(ev) {
    if (!$("#mediaPicker")) return;
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;
    if (!state.active) {
      setWarning("Empieza una sesión antes de añadir archivos.");
      ev.target.value = "";
      return;
    }
    for (const file of files) {
      const mediaId = uid();
      const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : "file";
      const ts = file.lastModified || Date.now();
      const mediaObj = { id: mediaId, sessionId: state.active.id, kind, name: file.name, ts, blob: file };
      await DB.put("media", mediaObj);
      state.active.mediaRefs.push({ id: mediaId, ts, kind, name: file.name });
      state.active.events.push({ id: uid(), ts, type: "media", label: `${kind === "image" ? "Foto" : "Vídeo"} añadid${kind === "image" ? "a" : "o"}: ${file.name}` });
    }
    ev.target.value = "";
    renderMediaPreview();
    renderTimeline();
    saveDraft();
    setWarning(`Añadidos ${files.length} archivo(s).`);
  }

  async function renderMediaPreview(session = state.active) {
    const box = $("#mediaPreview");
    if (!box) return;
    if (!session) { box.innerHTML = ""; return; }
    const refs = [...session.mediaRefs].sort((a,b)=>a.ts-b.ts);
    const all = await DB.getAllByIndex("media", "bySession", session.id);
    const byId = new Map(all.map(m => [m.id, m]));
    box.innerHTML = "";
    for (const ref of refs.slice(-24)) {
      const m = byId.get(ref.id);
      if (!m) continue;
      const card = document.createElement("div");
      card.className = "media-thumb";
      let mediaEl;
      if (m.kind === "image") {
        mediaEl = document.createElement("img");
        mediaEl.src = URL.createObjectURL(m.blob);
      } else if (m.kind === "video") {
        mediaEl = document.createElement("video");
        mediaEl.src = URL.createObjectURL(m.blob);
        mediaEl.controls = false;
        mediaEl.muted = true;
      } else if (m.kind === "audio") {
        mediaEl = document.createElement("div");
        mediaEl.style.padding = "10px";
        mediaEl.innerHTML = "🎙️ Nota de voz";
      } else {
        mediaEl = document.createElement("div");
        mediaEl.textContent = "📎 Archivo";
      }
      card.appendChild(mediaEl);
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${timeStr(ref.ts)} · ${ref.kind}`;
      card.appendChild(meta);
      box.appendChild(card);
    }
  }

  // ---------- Timeline ----------
  function combinedTimeline(session = state.active) {
    if (!session) return [];
    const items = [];
    for (const p of session.points) {
      if (items.length === 0 || (p.ts - (items[items.length-1]?.ts || 0) > 12000)) {
        items.push({ ts: p.ts, type: "gps", label: `GPS ${round(p.speedKmh,1)} km/h`, meta: `Acc ${p.acc ? round(p.acc,0)+'m' : '—'}` });
      }
    }
    for (const e of session.events) {
      items.push({ ts: e.ts, type: e.type, label: e.label, meta: eventMetaText(e) });
    }
    return items.sort((a,b)=>a.ts-b.ts);
  }

  function eventMetaText(e) {
    const parts = [];
    if (e.speedKmh) parts.push(`${round(e.speedKmh,1)} km/h`);
    if (e.airtimeMs) parts.push(`airtime ${e.airtimeMs}ms`);
    if (e.g) parts.push(`${e.g}g`);
    if (e.intensity) parts.push(e.intensity);
    return parts.join(" · ");
  }

  function renderTimeline() {
    const box = $("#timeline");
    const items = combinedTimeline();
    if (!items.length) {
      box.innerHTML = `<div class="timeline-item"><div class="label">Sin eventos aún.</div></div>`;
      return;
    }
    box.innerHTML = items.slice(-250).reverse().map(it => {
      const tag = timelineTag(it.type);
      return `<div class="timeline-item">
        <div class="t">${dateStr(it.ts)}</div>
        <div class="label"><span class="pill-mini">${tag}</span>${escapeHtml(it.label)}</div>
        <div class="t">${escapeHtml(it.meta || "")}</div>
      </div>`;
    }).join("");
  }

  function timelineTag(type) {
    const map = {
      gps: "GPS", jump: "JUMP", fall: "FALL", note: "NOTE", media: "MEDIA", voice: "VOICE",
      marker: "MARK", run: "RUN", lift: "LIFT", stop: "STOP", slow: "MOVE", action: "ACT", session: "SESS"
    };
    return map[type] || type.toUpperCase();
  }

  function escapeHtml(s = "") {
    return s.replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
  }

  // ---------- Metrics + summaries ----------
  function computeSessionMetrics(session) {
    // already mostly incremented live; recompute some derived metrics for consistency
    const pts = session.points;
    if (pts.length < 2) return;
    let dist = 0, movingMs = 0, pausedMs = 0, asc = 0, desc = 0, max = 0, sum = 0, cnt = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i-1], b = pts[i];
      const dtMs = Math.max(0, b.ts - a.ts);
      const d = haversineM(a,b);
      dist += d;
      const sp = b.speedKmh || 0;
      max = Math.max(max, sp);
      if (sp >= MOVING_SPEED_KMH) { movingMs += dtMs; sum += sp; cnt++; } else pausedMs += dtMs;
      if (Number.isFinite(a.alt) && Number.isFinite(b.alt)) {
        const da = b.alt - a.alt;
        if (Math.abs(da) < 20) { if (da > 0) asc += da; else desc += Math.abs(da); }
      }
    }
    session.metrics.distanceM = dist;
    session.metrics.movingMs = movingMs;
    session.metrics.pausedMs = pausedMs;
    session.metrics.ascentM = asc;
    session.metrics.descentM = desc;
    session.metrics.maxSpeedKmh = max;
    session.metrics.avgSpeedKmh = cnt ? sum/cnt : 0;
  }

  function detectRuns(points) {
    const runs = [];
    if (!points || points.length < 4) return runs;
    let cur = null;
    for (let i = 1; i < points.length; i++) {
      const p = points[i], prev = points[i-1];
      const moving = (p.speedKmh || 0) >= MOVING_SPEED_KMH;
      const altTrend = (Number.isFinite(p.alt) && Number.isFinite(prev.alt)) ? (p.alt - prev.alt) : 0;
      const isRunLike = moving && altTrend <= 2; // mostly flat/down
      if (isRunLike) {
        if (!cur) cur = { points: [prev], startedAt: prev.ts };
        cur.points.push(p);
      } else {
        if (cur && cur.points.length >= MIN_RUN_POINTS) runs.push(finalizeRun(cur));
        cur = null;
      }
    }
    if (cur && cur.points.length >= MIN_RUN_POINTS) runs.push(finalizeRun(cur));
    return runs;
  }

  function finalizeRun(run) {
    const pts = run.points;
    let dist = 0, max = 0, sum = 0, cnt = 0, drop = 0;
    for (let i = 1; i < pts.length; i++) {
      dist += haversineM(pts[i-1], pts[i]);
      max = Math.max(max, pts[i].speedKmh || 0);
      if ((pts[i].speedKmh || 0) >= MOVING_SPEED_KMH) { sum += pts[i].speedKmh; cnt++; }
      if (Number.isFinite(pts[i].alt) && Number.isFinite(pts[i-1].alt)) {
        const da = pts[i].alt - pts[i-1].alt;
        if (da < 0 && Math.abs(da) < 20) drop += Math.abs(da);
      }
    }
    return {
      id: uid(),
      startedAt: pts[0].ts,
      endedAt: pts[pts.length-1].ts,
      durationMs: pts[pts.length-1].ts - pts[0].ts,
      distanceM: dist,
      avgSpeedKmh: cnt ? sum/cnt : 0,
      maxSpeedKmh: max,
      dropM: drop
    };
  }

  function buildSummary(session) {
    const runs = session.runs || [];
    const topRun = [...runs].sort((a,b)=>b.maxSpeedKmh - a.maxSpeedKmh)[0] || null;
    const topIntensity = topIntensityMoment(session);
    const timeTotal = (session.endedAt || Date.now()) - session.startedAt;
    const moving = session.metrics.movingMs;
    const lifts = approxLiftTime(session);
    const stops = Math.max(0, timeTotal - moving - lifts);
    return {
      totalTimeMs: timeTotal,
      movingMs: moving,
      liftMs: lifts,
      stopMs: stops,
      topRun,
      topIntensity,
      runsCount: runs.length,
      topSpeedKmh: session.metrics.maxSpeedKmh,
      avgSpeedKmh: session.metrics.avgSpeedKmh,
      distanceKm: session.metrics.distanceM / 1000,
      ascentM: session.metrics.ascentM,
      descentM: session.metrics.descentM,
      jumps: session.metrics.jumps || 0
    };
  }

  function approxLiftTime(session) {
    // use events "lift" durations approximate from mode transitions
    const events = session.events.filter(e => ["lift","run","stop","slow"].includes(e.type)).sort((a,b)=>a.ts-b.ts);
    let liftMs = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i], nxt = events[i+1];
      if (e.type === "lift" && nxt) liftMs += Math.max(0, nxt.ts - e.ts);
    }
    return liftMs;
  }

  function topIntensityMoment(session) {
    if (!session.motionPoints?.length) return null;
    const win = [];
    let best = null;
    for (const mp of session.motionPoints) {
      win.push(mp);
      while (win.length && mp.ts - win[0].ts > 8000) win.shift();
      const score = win.reduce((s,v)=>s+(v.intensity||0),0) / win.length;
      if (!best || score > best.score) best = { ts: mp.ts, score };
    }
    if (!best) return null;
    return { ts: best.ts, score: round(best.score, 2), label: best.score < 0.9 ? "suave" : best.score < 1.8 ? "medio" : "agresivo" };
  }

  function updateLiveStats() {
    const s = state.active;
    if (!s) return;
    const now = Date.now();
    const last = s.points[s.points.length - 1];
    const totalMs = (s.status === "stopped" ? s.endedAt : now) - s.startedAt;
    $("#liveSpeed").textContent = `${round(last?.speedKmh || 0, 1)} km/h`;
    $("#liveMaxSpeed").textContent = `${round(s.metrics.maxSpeedKmh || 0, 1)} km/h`;
    $("#liveAvgSpeed").textContent = `${round(s.metrics.avgSpeedKmh || 0, 1)} km/h`;
    $("#liveDistance").textContent = `${round((s.metrics.distanceM || 0)/1000, 2)} km`;
    $("#liveDuration").textContent = msToHMS(totalMs);
    $("#liveMovingTime").textContent = msToHMS(s.metrics.movingMs || 0);
    $("#liveAsc").textContent = `${round(s.metrics.ascentM || 0, 0)} m`;
    $("#liveDesc").textContent = `${round(s.metrics.descentM || 0, 0)} m`;
    const runs = s.runs?.length ? s.runs : detectRuns(s.points);
    $("#liveRuns").textContent = `${runs.length}`;
    $("#liveJumps").textContent = `${s.metrics.jumps || 0}`;
    const topRun = runs.length ? runs.slice().sort((a,b)=>b.maxSpeedKmh-a.maxSpeedKmh)[0] : null;
    $("#liveTopRun").textContent = topRun ? `${round(topRun.maxSpeedKmh,1)} km/h` : "—";
    const topInt = topIntensityMoment(s);
    $("#liveTopIntensity").textContent = topInt ? `${topInt.label} (${topInt.score})` : "—";
  }

  function renderSummaryCards(session = state.active) {
    const box = $("#summaryCards");
    if (!session) { box.innerHTML = ""; return; }
    const summary = session.summary || buildSummary(session);
    const cards = [
      ["Distancia", `${round(summary.distanceKm,2)} km`],
      ["Tiempo total", msToHMS(summary.totalTimeMs)],
      ["Tiempo esquiando", msToHMS(summary.movingMs)],
      ["Remontes (aprox)", msToHMS(summary.liftMs)],
      ["Paradas (aprox)", msToHMS(summary.stopMs)],
      ["Velocidad máx", `${round(summary.topSpeedKmh,1)} km/h`],
      ["Velocidad media", `${round(summary.avgSpeedKmh,1)} km/h`],
      ["Desnivel + / -", `${round(summary.ascentM,0)}m / ${round(summary.descentM,0)}m`],
      ["Saltos", `${summary.jumps}`],
      ["Runs", `${summary.runsCount}`],
      ["Top run", summary.topRun ? `${round(summary.topRun.maxSpeedKmh,1)} km/h · ${round(summary.topRun.distanceM/1000,2)} km` : "—"],
      ["Momento intenso", summary.topIntensity ? `${summary.topIntensity.label} · ${timeStr(summary.topIntensity.ts)}` : "—"],
    ];
    box.innerHTML = cards.map(([k,v]) => `<div class="highlight"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(String(v))}</div></div>`).join("");
  }

  function generateRecapText() {
    if (!state.active) return;
    const s = state.active;
    const summary = s.summary || buildSummary(s);
    const station = s.stationName;
    const cond = `${s.config.snowCondition}, visibilidad ${s.config.visibility}, viento ${s.config.windLevel}`;
    const topRunTxt = summary.topRun ? `${round(summary.topRun.maxSpeedKmh,1)} km/h y ${round(summary.topRun.distanceM/1000,2)} km` : "sin runs detectados";
    const jumpsTxt = s.config.jumpEnabled ? `${summary.jumps} salto(s) detectados (estimado).` : "detección de saltos desactivada.";
    const weather = s.weather ? `\nMeteo auto: ${s.weather.summary}.` : "";

    $("#aiRecap").value =
`Recap ${s.type} · ${station}
Sesión: ${s.name}
Fecha: ${new Date(s.startedAt).toLocaleDateString()}
Condiciones: ${cond}${weather}

Hoy hiciste ${round(summary.distanceKm,2)} km en ${msToHMS(summary.totalTimeMs)} (tiempo en movimiento: ${msToHMS(summary.movingMs)}).
Velocidad máxima: ${round(summary.topSpeedKmh,1)} km/h · media: ${round(summary.avgSpeedKmh,1)} km/h.
Desnivel aprox: +${round(summary.ascentM,0)} m / -${round(summary.descentM,0)} m.
Runs detectados: ${summary.runsCount}. Top run: ${topRunTxt}.
${jumpsTxt}
Momento más intenso: ${summary.topIntensity ? `${summary.topIntensity.label} (${summary.topIntensity.score}) a las ${timeStr(summary.topIntensity.ts)}` : "no disponible"}.


Caption corto:
"${station} ✅ ${round(summary.distanceKm,1)} km · máx ${round(summary.topSpeedKmh,0)} km/h · ${summary.runsCount} runs · ${s.type.toLowerCase()} day 🔥"`;
  }

  async function shareSummaryText() {
    const txt = $("#aiRecap").value || "Genera primero el recap.";
    try {
      if (navigator.share) {
        await navigator.share({ title: "Formigal Session AI", text: txt });
      } else {
        await navigator.clipboard.writeText(txt);
        setWarning("Resumen copiado al portapapeles.");
      }
    } catch (err) {
      setWarning("No se pudo compartir: " + (err.message || err));
    }
  }

  function downloadSummaryImage() {
    if (!state.active) return;
    const s = state.active;
    const summary = s.summary || buildSummary(s);
    const canvas = document.createElement("canvas");
    canvas.width = 1200; canvas.height = 800;
    const ctx = canvas.getContext("2d");
    // background
    const g = ctx.createLinearGradient(0,0,0,800);
    g.addColorStop(0, "#0b1220"); g.addColorStop(1, "#0f1f3a");
    ctx.fillStyle = g; ctx.fillRect(0,0,1200,800);

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 44px Inter, Arial";
    ctx.fillText("🏂 Formigal Session AI", 50, 70);
    ctx.font = "600 30px Inter, Arial";
    ctx.fillText(s.name, 50, 120);
    ctx.fillStyle = "#b7c5e0";
    ctx.font = "22px Inter, Arial";
    ctx.fillText(`${s.type} · ${new Date(s.startedAt).toLocaleDateString()} · ${s.stationName}`, 50, 160);

    const cards = [
      ["Distancia", `${round(summary.distanceKm,2)} km`],
      ["Tiempo", msToHMS(summary.totalTimeMs)],
      ["Vel. máx", `${round(summary.topSpeedKmh,1)} km/h`],
      ["Vel. media", `${round(summary.avgSpeedKmh,1)} km/h`],
      ["Runs", `${summary.runsCount}`],
      ["Saltos", `${summary.jumps}`],
      ["Desnivel -", `${round(summary.descentM,0)} m`],
      ["Condición", s.config.snowCondition],
    ];
    let x = 50, y = 210;
    cards.forEach((c, idx) => {
      const col = idx % 2; const row = Math.floor(idx / 2);
      x = 50 + col * 550; y = 210 + row * 110;
      roundRect(ctx, x, y, 500, 90, 16, "#12233f", "#2a3f66");
      ctx.fillStyle = "#9db3d6"; ctx.font = "20px Inter, Arial"; ctx.fillText(c[0], x + 18, y + 32);
      ctx.fillStyle = "#fff"; ctx.font = "700 30px Inter, Arial"; ctx.fillText(c[1], x + 18, y + 68);
    });

    ctx.fillStyle = "#d7e2f7";
    ctx.font = "20px Inter, Arial";
    const recap = ($("#aiRecap").value || "").split("\n").slice(0, 6).join(" ");
    wrapText(ctx, recap || "Sesión guardada.", 50, 690, 1100, 28);

    canvas.toBlob((blob) => {
      if (!blob) return;
      downloadFile(`summary-${safeName(s.name)}.png`, "image/png", blob);
    }, "image/png");
  }

  function roundRect(ctx, x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke();
  }
  function wrapText(ctx, text, x, y, maxW, lineH) {
    const words = text.split(" ");
    let line = "";
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxW) {
        ctx.fillText(line, x, y);
        line = word; y += lineH;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, y);
  }
  function safeName(s) { return s.replace(/[^\w\-]+/g, "_"); }

  // ---------- Weather (Open-Meteo) ----------
  async function fetchWeatherForSelectedStation() {
    const st = stationById($("#stationSelect").value);
    try {
      setWarning("Cargando meteo automática…");
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${st.lat}&longitude=${st.lon}&current=temperature_2m,apparent_temperature,wind_speed_10m,weather_code,precipitation&hourly=temperature_2m,wind_speed_10m,snowfall,snow_depth&timezone=auto`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const current = data.current || {};
      const now = current.time;
      let snowDepth = null, snowfall = null;
      if (data.hourly && Array.isArray(data.hourly.time)) {
        const idx = data.hourly.time.indexOf(now);
        if (idx >= 0) {
          snowDepth = data.hourly.snow_depth ? data.hourly.snow_depth[idx] : null;
          snowfall = data.hourly.snowfall ? data.hourly.snowfall[idx] : null;
        }
      }
      const summary = `${st.name}: ${round(current.temperature_2m ?? 0,1)}°C, sensación ${round(current.apparent_temperature ?? 0,1)}°C, viento ${round(current.wind_speed_10m ?? 0,0)} km/h` +
        (snowDepth != null ? `, espesor nieve ${round(snowDepth,0)} cm` : "") +
        (snowfall != null ? `, nieve/h ${round(snowfall,1)} mm` : "");
      state.ui.weatherData = {
        stationId: st.id, ts: Date.now(), raw: data, summary, timezone: data.timezone || null,
        current: {
          tempC: current.temperature_2m, feelsC: current.apparent_temperature,
          windKmh: current.wind_speed_10m, weatherCode: current.weather_code, snowDepthCm: snowDepth, snowfall: snowfall
        }
      };
      if (state.active) state.active.weather = state.ui.weatherData;
      renderWeatherBox();
      setWarning("Meteo cargada.");
    } catch (err) {
      setWarning("No se pudo cargar meteo: " + (err.message || err));
    }
  }

  function renderWeatherBox() {
    const box = $("#weatherBox");
    const extraBox = $("#weatherExtraBox");
    const w = state.ui.weatherData;
    renderMeteoSessionContext();
    if (!w) {
      if (box) box.textContent = "Sin datos de meteo.";
      if (extraBox) extraBox.textContent = "Pulsa actualizar para cargar temperatura, viento y nieve estimada.";
      return;
    }
    const partBeta = partEstimateFromWeather(w.current);
    const weatherLabel = weatherCodeToLabel(w.current?.weatherCode);
    const temp = round(w.current?.tempC ?? 0, 1);
    const feels = round(w.current?.feelsC ?? 0, 1);
    const wind = round(w.current?.windKmh ?? 0, 0);
    const snowDepth = w.current?.snowDepthCm;
    const snowfall = w.current?.snowfall;

    if (box) {
      box.innerHTML = `
        <div><strong>${escapeHtml(w.summary)}</strong></div>
        <div style="margin-top:8px">Estado cielo (estimado): <strong>${escapeHtml(weatherLabel)}</strong></div>
        <div style="margin-top:6px"><strong>Parte estimado (beta)</strong>: ${escapeHtml(partBeta)}</div>
        <div class="small" style="margin-top:6px">Actualizado: ${dateStr(w.ts)}${w.timezone ? ` · ${escapeHtml(w.timezone)}` : ""}</div>
      `;
    }

    if (extraBox) {
      const hours = weatherHourlyPreview(w.raw);
      extraBox.innerHTML = `
        <div><strong>Detalle rápido</strong></div>
        <div class="small" style="margin-top:6px">🌡 ${temp}°C (sensación ${feels}°C) · 💨 ${wind} km/h</div>
        <div class="small">❄️ Espesor: ${snowDepth != null ? `${round(snowDepth,0)} cm` : "—"} · Nieve/h: ${snowfall != null ? `${round(snowfall,1)} mm` : "—"}</div>
        <div style="margin-top:8px"><strong>Próximas horas</strong></div>
        <div class="small" style="margin-top:4px">${hours}</div>
      `;
    }
  }

  function renderMeteoSessionContext() {
    const box = $("#meteoSessionContext");
    if (!box) return;
    const stationName = stationById($("#stationSelect")?.value || DEFAULT_STATION).name;
    const snow = $("#snowCondition")?.value || "—";
    const vis = $("#visibility")?.value || "—";
    const wind = $("#windLevel")?.value || "—";
    const gpsMode = $("#gpsMode")?.value || "balanced";
    box.innerHTML = `
      <div><strong>Estación</strong>: ${escapeHtml(stationName)}</div>
      <div style="margin-top:6px"><strong>Condiciones manuales</strong>: nieve ${escapeHtml(snow)} · visibilidad ${escapeHtml(vis)} · viento ${escapeHtml(wind)}</div>
      <div style="margin-top:6px" class="small">GPS: ${escapeHtml(gpsMode)} · Puedes cambiarlo en la pestaña Sesión.</div>
    `;
  }

  function weatherHourlyPreview(raw) {
    try {
      const times = raw?.hourly?.time || [];
      const temps = raw?.hourly?.temperature_2m || [];
      const winds = raw?.hourly?.wind_speed_10m || [];
      if (!times.length) return "Sin detalle horario.";
      const nowIso = raw?.current?.time;
      let idx = Math.max(0, times.indexOf(nowIso));
      if (idx < 0) idx = 0;
      const picks = [];
      for (let i = idx; i < Math.min(times.length, idx + 6); i += 2) {
        const t = new Date(times[i]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const temp = Number.isFinite(temps[i]) ? `${round(temps[i],0)}°C` : "—";
        const wind = Number.isFinite(winds[i]) ? `${round(winds[i],0)} km/h` : "—";
        picks.push(`${t}: ${temp}, ${wind}`);
      }
      return picks.join(" · ");
    } catch {
      return "Sin detalle horario.";
    }
  }

  function weatherCodeToLabel(code) {
    const map = {
      0: "despejado", 1: "poco nuboso", 2: "parcialmente nuboso", 3: "nuboso",
      45: "niebla", 48: "niebla con escarcha",
      51: "llovizna débil", 53: "llovizna", 55: "llovizna intensa",
      61: "lluvia débil", 63: "lluvia", 65: "lluvia intensa",
      71: "nieve débil", 73: "nieve", 75: "nieve intensa",
      77: "granitos de nieve", 80: "chubascos débiles", 81: "chubascos", 82: "chubascos intensos",
      85: "chubascos de nieve", 86: "chubascos de nieve intensos",
      95: "tormenta", 96: "tormenta con granizo", 99: "tormenta con granizo fuerte"
    };
    return map[code] || `código ${code ?? "—"}`;
  }

  function partEstimateFromWeather(c) {
    if (!c) return "No disponible";
    const wind = c.windKmh ?? 0;
    const temp = c.tempC ?? 0;
    const snowDepth = c.snowDepthCm ?? null;
    if (wind > 55) return "Viento fuerte. Posibles cierres parciales.";
    if (snowDepth != null && snowDepth > 120 && temp < -2) return "Muy buena base y frío. Condiciones de invierno sólidas.";
    if (temp > 2) return "Nieve más húmeda / primavera probable en cotas bajas.";
    if (temp < -5) return "Frío alto. Ojo con hielo a primera hora.";
    return "Condiciones variables. Confirmar parte oficial de estación.";
  }

  // ---------- History, compare, exports ----------
  async function refreshCaches() {
    state.cache.sessions = await DB.getAll("sessions");
    state.cache.sessions.sort((a,b)=> (b.endedAt||0) - (a.endedAt||0));
    state.cache.media = await DB.getAll("media");
  }

  async function renderHistory() {
    const list = $("#sessionList");
    const sessions = state.cache.sessions;
    if (!sessions.length) {
      list.innerHTML = `<div class="empty">No hay sesiones guardadas aún.</div>`;
      renderCompareSelects();
      renderRecords();
      renderStationStats();
      return;
    }
    list.innerHTML = sessions.map(s => {
      const sum = s.summary || buildSummary(s);
      const active = s.id === state.ui.selectedHistoryId ? "active" : "";
      return `<div class="list-item ${active}" data-id="${s.id}">
        <div class="title">${escapeHtml(s.name)}</div>
        <div class="meta">${escapeHtml(s.type)} · ${escapeHtml(s.stationName)} · ${new Date(s.startedAt).toLocaleDateString()}</div>
        <div class="meta">${round(sum.distanceKm,2)} km · máx ${round(sum.topSpeedKmh,1)} km/h · ${sum.runsCount} runs</div>
      </div>`;
    }).join("");

    list.querySelectorAll(".list-item").forEach(el => {
      el.addEventListener("click", () => selectHistorySession(el.dataset.id));
    });

    if (!state.ui.selectedHistoryId && sessions[0]) await selectHistorySession(sessions[0].id);
    renderCompareSelects();
    renderRecords();
    renderStationStats();
  }

  async function selectHistorySession(id) {
    state.ui.selectedHistoryId = id;
    await renderHistory();
    const s = state.cache.sessions.find(x => x.id === id);
    if (!s) return;
    $("#deleteSelectedBtn").disabled = false;
    $("#duplicateSessionBtn").disabled = false;
    $("#exportJsonBtn").disabled = false;
    $("#exportCsvBtn").disabled = false;
    $("#exportGpxBtn").disabled = false;
    const sum = s.summary || buildSummary(s);
    $("#historyDetail").innerHTML = `
      <div><strong>${escapeHtml(s.name)}</strong></div>
      <div class="small">${escapeHtml(s.type)} · ${escapeHtml(s.stationName)} · ${dateStr(s.startedAt)}</div>
      <table class="table">
        <tr><th>Distancia</th><td>${round(sum.distanceKm,2)} km</td></tr>
        <tr><th>Tiempo total</th><td>${msToHMS(sum.totalTimeMs)}</td></tr>
        <tr><th>Velocidad máx</th><td>${round(sum.topSpeedKmh,1)} km/h</td></tr>
        <tr><th>Velocidad media</th><td>${round(sum.avgSpeedKmh,1)} km/h</td></tr>
        <tr><th>Runs</th><td>${sum.runsCount}</td></tr>
        <tr><th>Saltos</th><td>${sum.jumps}</td></tr>
        <tr><th>Desnivel -</th><td>${round(sum.descentM,0)} m</td></tr>
        <tr><th>Top run</th><td>${sum.topRun ? `${round(sum.topRun.maxSpeedKmh,1)} km/h (${round(sum.topRun.distanceM/1000,2)} km)` : "—"}</td></tr>
      </table>
    `;
    drawRouteOnMap(state.ui.historyMap, state.ui.historyLayers, s.points, true);
    fitMapToPoints(state.ui.historyMap, s.points);
  }

  function renderRecords() {
    const box = $("#recordsBox");
    const sessions = state.cache.sessions;
    if (!sessions.length) { box.textContent = "Sin datos."; return; }
    const records = {
      topSpeed: null, longest: null, mostDrop: null
    };
    for (const s of sessions) {
      const sum = s.summary || buildSummary(s);
      if (!records.topSpeed || sum.topSpeedKmh > records.topSpeed.val) records.topSpeed = { val: sum.topSpeedKmh, s };
      if (!records.longest || sum.totalTimeMs > records.longest.val) records.longest = { val: sum.totalTimeMs, s };
      if (!records.mostDrop || sum.descentM > records.mostDrop.val) records.mostDrop = { val: sum.descentM, s };
    }
    box.innerHTML = `
      <div>🏁 <strong>Velocidad máxima</strong>: ${round(records.topSpeed.val,1)} km/h · ${escapeHtml(records.topSpeed.s.name)}</div>
      <div>⏱️ <strong>Sesión más larga</strong>: ${msToHMS(records.longest.val)} · ${escapeHtml(records.longest.s.name)}</div>
      <div>⬇️ <strong>Más desnivel</strong>: ${round(records.mostDrop.val,0)} m · ${escapeHtml(records.mostDrop.s.name)}</div>
    `;
  }

  function renderStationStats() {
    const box = $("#stationStatsBox");
    const sessions = state.cache.sessions;
    if (!sessions.length) { box.textContent = "Sin datos."; return; }

    const byStation = new Map();
    const byTrip = new Map();
    for (const s of sessions) {
      const sum = s.summary || buildSummary(s);
      const st = byStation.get(s.stationName) || { sessions: 0, km: 0, time: 0, max: 0 };
      st.sessions++; st.km += sum.distanceKm; st.time += sum.totalTimeMs; st.max = Math.max(st.max, sum.topSpeedKmh);
      byStation.set(s.stationName, st);

      const tripKey = (s.tripName && s.tripName.trim()) || `Sin viaje`;
      const tr = byTrip.get(tripKey) || { sessions: 0, km: 0, time: 0 };
      tr.sessions++; tr.km += sum.distanceKm; tr.time += sum.totalTimeMs;
      byTrip.set(tripKey, tr);
    }

    let html = "<strong>Por estación</strong><br>";
    for (const [name, st] of byStation) {
      html += `• ${escapeHtml(name)}: ${st.sessions} ses · ${round(st.km,1)} km · máx ${round(st.max,1)} km/h<br>`;
    }
    html += "<br><strong>Resumen por viaje</strong><br>";
    for (const [trip, tr] of byTrip) {
      html += `• ${escapeHtml(trip)}: ${tr.sessions} ses · ${round(tr.km,1)} km · ${msToHMS(tr.time)}<br>`;
    }
    box.innerHTML = html;
  }

  function renderCompareSelects() {
    const a = $("#compareA"), b = $("#compareB");
    if (!a || !b) return;
    const sessions = state.cache.sessions;
    const opts = sessions.map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${new Date(s.startedAt).toLocaleDateString()})</option>`).join("");
    a.innerHTML = opts; b.innerHTML = opts;
    if (sessions[0]) a.value = sessions[0].id;
    if (sessions[1]) b.value = sessions[1].id;
  }

  function compareSessions() {
    const aSel = $("#compareA"), bSel = $("#compareB"), box = $("#compareResult");
    if (!aSel || !bSel || !box) return;
    const sA = state.cache.sessions.find(s => s.id === aSel.value);
    const sB = state.cache.sessions.find(s => s.id === bSel.value);
    if (!sA || !sB) { box.textContent = "Selecciona dos sesiones."; return; }
    const A = sA.summary || buildSummary(sA);
    const B = sB.summary || buildSummary(sB);
    const rows = [
      ["Distancia", `${round(A.distanceKm,2)} km`, `${round(B.distanceKm,2)} km`],
      ["Tiempo", msToHMS(A.totalTimeMs), msToHMS(B.totalTimeMs)],
      ["Vel. máx", `${round(A.topSpeedKmh,1)} km/h`, `${round(B.topSpeedKmh,1)} km/h`],
      ["Vel. media", `${round(A.avgSpeedKmh,1)} km/h`, `${round(B.avgSpeedKmh,1)} km/h`],
      ["Runs", `${A.runsCount}`, `${B.runsCount}`],
      ["Saltos", `${A.jumps}`, `${B.jumps}`],
      ["Desnivel -", `${round(A.descentM,0)} m`, `${round(B.descentM,0)} m`],
    ];
    box.innerHTML = `
      <table class="table">
        <tr><th>Métrica</th><th>${escapeHtml(sA.name)}</th><th>${escapeHtml(sB.name)}</th></tr>
        ${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("")}
      </table>
    `;
  }

  function bindHistoryActions() {
    $("#refreshHistoryBtn").addEventListener("click", async () => { await refreshCaches(); await renderHistory(); });
    $("#compareBtn")?.addEventListener("click", compareSessions);

    $("#deleteSelectedBtn").addEventListener("click", async () => {
      const id = state.ui.selectedHistoryId;
      if (!id) return;
      const media = await DB.getAllByIndex("media", "bySession", id);
      for (const m of media) await DB.delete("media", m.id);
      await DB.delete("sessions", id);
      state.ui.selectedHistoryId = null;
      await refreshCaches();
      await renderHistory();
      $("#historyDetail").innerHTML = `<div class="empty">Selecciona una sesión.</div>`;
      setWarning("Sesión borrada.");
    });

    $("#duplicateSessionBtn").addEventListener("click", async () => {
      const id = state.ui.selectedHistoryId;
      const s = state.cache.sessions.find(x => x.id === id);
      if (!s) return;
      $("#sessionName").value = `${s.stationName} ${new Date().toLocaleDateString()}`;
      $("#tripName").value = s.tripName || "";
      $("#sessionType").value = s.type;
      $("#stationSelect").value = s.stationId;
      $("#gpsMode").value = s.config.gpsMode || "balanced";
      $("#phonePlacement").value = s.config.phonePlacement || "jacket";
      $("#snowCondition").value = s.config.snowCondition || "polvo";
      $("#visibility").value = s.config.visibility || "buena";
      $("#windLevel").value = s.config.windLevel || "bajo";
      $("#jumpToggle").value = s.config.jumpEnabled ? "on" : "off";
      $("#stationLabel").textContent = stationById(s.stationId).name;
      state.ui.liveMap.setView([stationById(s.stationId).lat, stationById(s.stationId).lon], stationById(s.stationId).zoom);
      document.querySelector('.tab[data-tab="live"]')?.click();
      renderMeteoSessionContext();
      setWarning("Configuración duplicada al panel de sesión.");
    });

    $("#exportJsonBtn").addEventListener("click", async () => exportSelected("json"));
    $("#exportCsvBtn").addEventListener("click", async () => exportSelected("csv"));
    $("#exportGpxBtn").addEventListener("click", async () => exportSelected("gpx"));

    $("#exportAllBtn").addEventListener("click", exportAllJson);
    $("#deleteAllBtn").addEventListener("click", async () => {
      if (!confirm("¿Borrar todas las sesiones y media local?")) return;
      await DB.clear("sessions"); await DB.clear("media");
      state.ui.selectedHistoryId = null;
      await refreshCaches(); await renderHistory();
      setWarning("Todo borrado.");
    });
    $("#recoverDraftBtn").addEventListener("click", recoverDraft);
  }

  async function exportSelected(kind) {
    const id = state.ui.selectedHistoryId;
    if (!id) return;
    const s = state.cache.sessions.find(x => x.id === id);
    if (!s) return;
    if (kind === "json") {
      const media = await DB.getAllByIndex("media", "bySession", s.id);
      const payload = {
        session: s,
        media: media.map(m => ({ id: m.id, sessionId: m.sessionId, kind: m.kind, name: m.name, ts: m.ts, size: m.blob?.size || 0 }))
      };
      downloadFile(`${safeName(s.name)}.json`, "application/json", JSON.stringify(payload, null, 2));
    } else if (kind === "csv") {
      const csv = toCSV(s);
      downloadFile(`${safeName(s.name)}.csv`, "text/csv;charset=utf-8", csv);
    } else if (kind === "gpx") {
      const gpx = toGPX(s);
      downloadFile(`${safeName(s.name)}.gpx`, "application/gpx+xml", gpx);
    }
  }

  function toCSV(s) {
    const header = ["timestamp","lat","lon","alt","accuracy_m","speed_kmh"];
    const rows = s.points.map(p => [new Date(p.ts).toISOString(), p.lat, p.lon, p.alt ?? "", p.acc ?? "", p.speedKmh ?? ""]);
    return [header.join(","), ...rows.map(r => r.join(","))].join("\n");
  }

  function toGPX(s) {
    const trkpts = s.points.map(p => `<trkpt lat="${p.lat}" lon="${p.lon}">${p.alt!=null?`<ele>${p.alt}</ele>`:""}<time>${new Date(p.ts).toISOString()}</time></trkpt>`).join("");
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Formigal Session AI" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeHtmlXml(s.name)}</name><time>${new Date(s.startedAt).toISOString()}</time></metadata>
  <trk><name>${escapeHtmlXml(s.name)}</name><trkseg>${trkpts}</trkseg></trk>
</gpx>`;
  }
  function escapeHtmlXml(str){ return String(str).replace(/[<>&'"]/g,c=>({ '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;' }[c])); }

  async function exportAllJson() {
    const sessions = await DB.getAll("sessions");
    const media = await DB.getAll("media");
    const payload = {
      exportedAt: new Date().toISOString(),
      sessions,
      media: media.map(m => ({ id:m.id, sessionId:m.sessionId, kind:m.kind, name:m.name, ts:m.ts, size: m.blob?.size || 0 }))
    };
    downloadFile("formigal-session-ai-backup.json", "application/json", JSON.stringify(payload, null, 2));
  }

  // ---------- Draft persistence ----------
  function saveDraft() {
    if (!state.active) return;
    try {
      const draft = structuredClone(state.active);
      // Media blobs stay in IDB; draft only references
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (err) {
      console.warn("Draft save failed", err);
    }
  }

  async function recoverDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) { setWarning("No hay borrador activo."); return; }
      const d = JSON.parse(raw);
      state.active = d;
      if (state.active.status === "stopped") state.active.status = "paused";
      setSessionButtons(state.active.status === "active" ? "started" : "paused");
      $("#sessionName").value = d.name || "";
      $("#tripName").value = d.tripName || "";
      $("#sessionType").value = d.type || "Snowboard";
      $("#stationSelect").value = d.stationId || DEFAULT_STATION;
      $("#stationLabel").textContent = stationById($("#stationSelect").value).name;
      $("#gpsMode").value = d.config?.gpsMode || "balanced";
      $("#phonePlacement").value = d.config?.phonePlacement || "jacket";
      $("#snowCondition").value = d.config?.snowCondition || "polvo";
      $("#visibility").value = d.config?.visibility || "buena";
      $("#windLevel").value = d.config?.windLevel || "bajo";
      $("#jumpToggle").value = d.config?.jumpEnabled ? "on" : "off";

      drawRouteOnMap(state.ui.liveMap, state.ui.liveLayers, d.points || [], $("#speedColorToggle").checked);
      fitMapToPoints(state.ui.liveMap, d.points || []);
      renderAllLive();
      await renderMediaPreview();
      renderMeteoSessionContext();
      setWarning("Borrador recuperado.");
    } catch (err) {
      setWarning("No se pudo recuperar borrador: " + (err.message || err));
    }
  }

  function restartGeoWatchIfActive(reason = "") {
    if (!state.active || state.active.status !== "active") return;
    stopGeoWatch();
    startGeoWatch();
    const why = reason ? ` (${reason})` : "";
    setWarning(`Reintentando GPS${why}.`);
  }

  function startGpsWatchdog() {
    stopGpsWatchdog();
    state.tracking.gpsWatchdog = setInterval(() => {
      if (!state.active || state.active.status !== "active") return;
      const lastTs = state.tracking.lastPointTs || 0;
      if (!lastTs) return;
      const ageMs = Date.now() - lastTs;
      if (ageMs < 15000) return;
      const hidden = document.hidden;
      $("#gpsStatus").textContent = hidden ? "GPS: en pausa (posible bloqueo)" : "GPS: sin actualización";
      setWarning(hidden
        ? "Pantalla bloqueada o app en segundo plano: el navegador puede pausar el GPS en una PWA. Desbloquea y pulsa ‘Reintentar GPS’ si no vuelve solo."
        : "No llegan puntos GPS nuevos. Comprueba permisos/cobertura y pulsa ‘Reintentar GPS’."
      );
      if (ageMs > 30000 && !hidden) {
        restartGeoWatchIfActive("sin puntos");
      }
    }, 5000);
  }

  function stopGpsWatchdog() {
    if (state.tracking.gpsWatchdog) clearInterval(state.tracking.gpsWatchdog);
    state.tracking.gpsWatchdog = null;
  }

  // ---------- Wake lock ----------
  async function requestWakeLockSafe(silent = false) {
    if (!("wakeLock" in navigator)) {
      if (!silent) setWarning("Wake Lock no soportado en este navegador.");
      return false;
    }
    if (state.tracking.wakeLock) return true;
    try {
      state.tracking.wakeLock = await navigator.wakeLock.request("screen");
      $("#wakeStatus").textContent = "Pantalla: activa";
      if ($("#wakeBtn")) $("#wakeBtn").textContent = "🔅 Pantalla normal";
      state.tracking.wakeLock.addEventListener("release", () => {
        $("#wakeStatus").textContent = "Pantalla: normal";
        if ($("#wakeBtn")) $("#wakeBtn").textContent = "🔆 Pantalla activa";
        state.tracking.wakeLock = null;
      });
      return true;
    } catch (err) {
      if (!silent) setWarning("No se pudo activar pantalla: " + (err.message || err));
      return false;
    }
  }

  async function toggleWakeLock() {
    if (state.tracking.wakeLock) {
      try {
        await state.tracking.wakeLock.release();
      } catch {}
      state.tracking.wakeLock = null;
      $("#wakeStatus").textContent = "Pantalla: normal";
      if ($("#wakeBtn")) $("#wakeBtn").textContent = "🔆 Pantalla activa";
      return;
    }
    await requestWakeLockSafe(false);
  }

  // ---------- Rendering all live ----------
  async function renderAllLive() {
    updateLiveStats();
    renderTimeline();
    renderSummaryCards();
    await renderMediaPreview();
    if (state.active?.points?.length) drawRouteOnMap(state.ui.liveMap, state.ui.liveLayers, state.active.points, $("#speedColorToggle").checked);
    if (state.ui.weatherData) renderWeatherBox();
    renderMeteoSessionContext();
  }

  function setWarning(msg) {
    $("#warningBox").textContent = msg || "";
  }

  // ---------- PWA install + SW ----------
  function initPwaInstall() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      state.ui.deferredInstall = e;
      $("#installBtn").hidden = false;
    });
    $("#installBtn").addEventListener("click", async () => {
      if (!state.ui.deferredInstall) return;
      state.ui.deferredInstall.prompt();
      await state.ui.deferredInstall.userChoice;
      state.ui.deferredInstall = null;
      $("#installBtn").hidden = true;
    });
  }

  async function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      try {
        await navigator.serviceWorker.register("./sw.js");
      } catch (err) {
        console.warn("SW error", err);
      }
    }
  }

  // ---------- Startup ----------
  async function init() {
    initStations();
    initTabs();
    initThemeControls();
    bindControlButtons();
    bindHistoryActions();
    initMaps();
    loadPrefs();
    initPwaInstall();
    await DB.open();
    await refreshCaches();
    await renderHistory();
    renderWeatherBox();
    renderMeteoSessionContext();
    setSessionButtons("stopped");
    recoverDraftSilently();
    registerServiceWorker();
  }

  async function recoverDraftSilently() {
    if (!localStorage.getItem(DRAFT_KEY)) return;
    setWarning("Hay un borrador local disponible. Puedes recuperarlo desde Ajustes.");
  }

  // ---------- misc UI state ----------
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.active?.status === "active") {
      setWarning("La app pasó a segundo plano. En PWA el tracking puede pausarse si bloqueas la pantalla.");
      return;
    }
    if (!document.hidden && state.active?.status === "active") {
      if ($("#wakeOnStart")?.checked && !state.tracking.wakeLock) requestWakeLockSafe(true);
      restartGeoWatchIfActive("app en primer plano");
    }
  });

  window.addEventListener("beforeunload", () => {
    if (state.active && state.active.status !== "stopped") saveDraft();
  });

  window.addEventListener("online", () => setWarning("Conexión recuperada."));
  window.addEventListener("offline", () => setWarning("Sin conexión. La app sigue en modo offline básico."));

  // ---------- Kickoff ----------
  init().catch(err => {
    console.error(err);
    setWarning("Error inicializando app: " + (err.message || err));
  });
})();
