(() => {
  'use strict';

  const STATION = {
    id: 'formigal',
    name: 'Formigal-Panticosa',
    lat: 42.7727,
    lon: -0.3608,
    zoom: 12,
    meteoLat: 42.775,
    meteoLon: -0.364
};

const FORMIGAL_IMAGE_CAL = {
  // Calibración aproximada (lat/lon -> píxel) sobre el mapa oficial 1024x512, zona Formigal
  lonMin: -0.392, lonMax: -0.292,
  latMin: 42.748, latMax: 42.806,
  xMin: 500, xMax: 995,
  yMin: 430, yMax: 58,
  width: 1024, height: 512
};

const FORMIGAL_SECTORS = [
  { name: 'Valle Portalet', center:[42.784,-0.304], poly:[[42.760,-0.320],[42.806,-0.320],[42.806,-0.292],[42.760,-0.292]] },
  { name: 'Valle Anayet', center:[42.769,-0.329], poly:[[42.748,-0.347],[42.792,-0.347],[42.792,-0.316],[42.748,-0.316]] },
  { name: 'Valle Izas-Sarrios', center:[42.789,-0.347], poly:[[42.770,-0.368],[42.806,-0.368],[42.806,-0.331],[42.776,-0.331],[42.770,-0.343]] },
  { name: 'Tres Hombres / Sextas', center:[42.776,-0.365], poly:[[42.752,-0.392],[42.794,-0.392],[42.794,-0.346],[42.770,-0.340],[42.752,-0.356]] }
];

// Red simplificada (corredores aproximados). Etiquetas para orientación rápida.
const FORMIGAL_LIFTS = [
  { name:'Telesilla Sextas', line:[[42.7676,-0.3720],[42.7765,-0.3650]] },
  { name:'Telesilla Sallent', line:[[42.7700,-0.3710],[42.7810,-0.3605]] },
  { name:'Telesilla Furco', line:[[42.7715,-0.3665],[42.7785,-0.3525]] },
  { name:'Telesilla Batallero', line:[[42.7725,-0.3445],[42.7850,-0.3335]] },
  { name:'Telesilla Crestas', line:[[42.7800,-0.3495],[42.7905,-0.3390]] },
  { name:'Telesilla Sarrios', line:[[42.7805,-0.3540],[42.7940,-0.3440]] },
  { name:'Telesilla Collado', line:[[42.7835,-0.3620],[42.7960,-0.3560]] },
  { name:'Telesilla Anayet', line:[[42.7615,-0.3350],[42.7750,-0.3300]] },
  { name:'Telesilla Culivillas', line:[[42.7670,-0.3290],[42.7820,-0.3230]] },
  { name:'Telesilla Espelunciecha', line:[[42.7715,-0.3225],[42.7900,-0.3125]] },
  { name:'Telesilla Garmet', line:[[42.7780,-0.3330],[42.7940,-0.3220]] },
  { name:'Telesilla Pico Royo', line:[[42.7830,-0.3200],[42.7955,-0.3090]] },
  { name:'Zona Remontes Portalet', line:[[42.7815,-0.3010],[42.7920,-0.2960]] }
];

const FORMIGAL_PISTE_ZONES = [
  { name:'Sextas (zona baja)', line:[[42.7660,-0.3760],[42.7750,-0.3620],[42.7800,-0.3520]] },
  { name:'Tres Hombres (zona)', line:[[42.7790,-0.3660],[42.7900,-0.3560]] },
  { name:'Izas-Sarrios (zona)', line:[[42.7810,-0.3580],[42.7950,-0.3440]] },
  { name:'Sarrios alta (zona)', line:[[42.7910,-0.3520],[42.8010,-0.3400]] },
  { name:'Anayet (zona)', line:[[42.7605,-0.3390],[42.7720,-0.3290],[42.7830,-0.3230]] },
  { name:'Culivillas (zona)', line:[[42.7665,-0.3310],[42.7820,-0.3240]] },
  { name:'Batallero (zona)', line:[[42.7720,-0.3470],[42.7865,-0.3330]] },
  { name:'Espelunciecha (zona)', line:[[42.7720,-0.3245],[42.7910,-0.3120]] },
  { name:'Garmet (zona)', line:[[42.7780,-0.3360],[42.7960,-0.3200]] },
  { name:'Pico Royo / Portalet (zona)', line:[[42.7830,-0.3210],[42.7960,-0.3060]] },
  { name:'Portalet (zona)', line:[[42.7790,-0.3040],[42.7940,-0.2955]] }
];

const KEYS = {
    sessions: 'formigal_ultra_sessions_v1',
    active: 'formigal_ultra_active_v1',
    prefs: 'formigal_ultra_prefs_v1'
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const fmt = {
    n: (v, d = 1) => Number.isFinite(v) ? Number(v).toFixed(d) : '0.0',
    km: (m) => (m / 1000).toFixed(2),
    ms: (ms) => {
      ms = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(ms / 3600);
      const m = Math.floor((ms % 3600) / 60);
      const s = ms % 60;
      return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
    },
    date: (ts) => new Date(ts).toLocaleString('es-ES', { hour12: false }),
    shortDate: (ts) => new Date(ts).toLocaleString('es-ES', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
  };

  const state = {
    sessions: [],
    active: null,
    selectedId: null,
    saveTimer: null,
    runtime: {
      geoWatchId: null,
      whereInfo: null,
      timerId: null,
      wakeLock: null,
      currentPosMarker: null,
      accuracyCircle: null,
      lastGeoTs: 0,
      lastMotionTs: 0,
      motionListenerAttached: false,
      calibrating: false,
      calibSamples: [],
      jumpState: { lowTs: 0, lastJumpTs: 0 },
      installingPrompt: null,
      gpsWatchdogId: null,
      visibleWarned: false,
      robustIntervalId: null,
      robustPollBusy: false,
      locationPermission: 'prompt',
      motionPermission: 'prompt',
      sensorHasData: false
    },
    sensor: {
      accelMag: null,
      gyroMag: null,
      intensity: '—',
      moving: false,
      calib: null
    },
    ui: {
      liveMap: null,
      historyMap: null,
      liveRoute: null,
      liveSpeedSegments: [],
      historyRoute: null,
      historySegments: []
    }
  };

  // ---------- Persistence ----------
  function loadSessions() {
    try { state.sessions = JSON.parse(localStorage.getItem(KEYS.sessions) || '[]'); } catch { state.sessions = []; }
    try { state.active = JSON.parse(localStorage.getItem(KEYS.active) || 'null'); } catch { state.active = null; }
    if (state.active && !state.active.points) state.active.points = [];
    if (state.active && !state.active.motionSamples) state.active.motionSamples = [];
    if (state.active && !state.active.events) state.active.events = [];
    if (state.active && !state.active.runs) state.active.runs = [];
    if (state.active && !state.active.metrics) state.active.metrics = baseMetrics();
    if (state.active && !state.active.segments) state.active.segments = [];
    if (state.active) recalcDerived(state.active);
    sortSessions();
  }

  function saveAll(throttled = false) {
    const doSave = () => {
      localStorage.setItem(KEYS.sessions, JSON.stringify(state.sessions));
      localStorage.setItem(KEYS.active, JSON.stringify(state.active));
      setSavePill('Guardado ✓');
    };
    if (!throttled) return doSave();
    setSavePill('Guardando…');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(doSave, 250);
  }

  function savePrefs() {
    const prefs = {
      themeLight: $('#app').classList.contains('theme-light'),
      highContrast: $('#app').classList.contains('high-contrast'),
      gpsMode: $('#gpsMode').value,
      wakeOnStart: $('#wakeOnStart').checked,
      followMe: $('#followMe').checked,
      speedColors: $('#speedColors').checked,
      sessionName: $('#sessionName').value,
      sessionType: $('#sessionType').value,
      snowCondition: $('#snowCondition').value,
      visibility: $('#visibility').value,
      windLevel: $('#windLevel').value,
      phonePlacement: $('#phonePlacement').value,
      jumpEnabled: $('#jumpEnabled').checked,
      robustMode: $('#robustMode').checked,
      calib: state.sensor.calib,
      alwaysDark: $('#alwaysDark').checked
    };
    localStorage.setItem(KEYS.prefs, JSON.stringify(prefs));
  }

  function loadPrefs() {
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(KEYS.prefs) || '{}'); } catch {}
    if (prefs.themeLight && !prefs.alwaysDark) {
      $('#app').classList.remove('theme-dark');
      $('#app').classList.add('theme-light');
    }
    if (prefs.highContrast) $('#app').classList.add('high-contrast');
    if (prefs.gpsMode) $('#gpsMode').value = prefs.gpsMode;
    if (typeof prefs.wakeOnStart === 'boolean') $('#wakeOnStart').checked = prefs.wakeOnStart;
    if (typeof prefs.followMe === 'boolean') $('#followMe').checked = prefs.followMe;
    if (typeof prefs.speedColors === 'boolean') $('#speedColors').checked = prefs.speedColors;
    if (prefs.sessionName) $('#sessionName').value = prefs.sessionName;
    if (prefs.sessionType) $('#sessionType').value = prefs.sessionType;
    if (prefs.snowCondition) $('#snowCondition').value = prefs.snowCondition;
    if (prefs.visibility) $('#visibility').value = prefs.visibility;
    if (prefs.windLevel) $('#windLevel').value = prefs.windLevel;
    if (prefs.phonePlacement) $('#phonePlacement').value = prefs.phonePlacement;
    if (typeof prefs.jumpEnabled === 'boolean') $('#jumpEnabled').checked = prefs.jumpEnabled;
    if (typeof prefs.robustMode === 'boolean') $('#robustMode').checked = prefs.robustMode;
    if (typeof prefs.alwaysDark === 'boolean') $('#alwaysDark').checked = prefs.alwaysDark;
    if ($('#alwaysDark').checked) {
      $('#app').classList.remove('theme-light');
      $('#app').classList.add('theme-dark');
    }
    state.sensor.calib = prefs.calib || null;
    renderCalibrationState();
    $('#highContrastToggle').checked = $('#app').classList.contains('high-contrast');
    updateToggleHighlights();
  }

  function setSavePill(text) { $('#saveStatus').textContent = text; }

  // ---------- Session model ----------
  function baseMetrics() {
    return { distanceM:0, movingMs:0, ascentM:0, descentM:0, maxSpeedKmh:0, avgSpeedKmh:0, jumps:0, liftMs:0, stoppedMs:0, lifts:0, runMs:0 };
  }

  function newSession() {
    return {
      id: `s_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      name: ($('#sessionName').value || `Formigal ${new Date().toLocaleDateString('es-ES')}`).trim(),
      type: $('#sessionType').value,
      stationId: STATION.id,
      stationName: STATION.name,
      config: {
        gpsMode: $('#gpsMode').value,
        snowCondition: $('#snowCondition').value,
        visibility: $('#visibility').value,
        windLevel: $('#windLevel').value,
        phonePlacement: $('#phonePlacement').value,
        jumpEnabled: $('#jumpEnabled').checked,
        robustMode: $('#robustMode').checked
      },
      startedAt: Date.now(),
      endedAt: null,
      status: 'active', // active | paused | finished
      pausedAt: null,
      totalPausedMs: 0,
      points: [], // {ts,lat,lon,alt,acc,speedKmh}
      motionSamples: [], // {ts, accel, gyro, intensity}
      events: [], // {ts,type,label}
      runs: [], // derived
      segments: [], // run/lift/stop/other segments
      metrics: baseMetrics(),
      weather: null
    };
  }

  function activeElapsedMs() {
    if (!state.active) return 0;
    const end = state.active.endedAt || Date.now();
    const pausedExtra = state.active.status === 'paused' && state.active.pausedAt ? (Date.now() - state.active.pausedAt) : 0;
    return Math.max(0, end - state.active.startedAt - (state.active.totalPausedMs || 0) - pausedExtra);
  }

  function sortSessions() {
    state.sessions.sort((a,b) => (b.endedAt || b.startedAt || 0) - (a.endedAt || a.startedAt || 0));
  }

  function upsertFinishedSession(session) {
    const idx = state.sessions.findIndex(s => s.id === session.id);
    if (idx >= 0) state.sessions[idx] = session;
    else state.sessions.unshift(session);
    sortSessions();
  }

  function recalcDerived(session) {
    if (!session) return;
    session.metrics = baseMetrics();
    session.runs = [];
    session.segments = [];
    session.lifts = [];
    let currentSeg = null;
    let weightedSpeed = 0;
    let weightedTime = 0;

    const pushSeg = () => {
      if (!currentSeg) return;
      currentSeg.endTs = currentSeg.endTs || currentSeg.lastTs || currentSeg.startTs;
      currentSeg.durationMs = Math.max(0, currentSeg.endTs - currentSeg.startTs);
      if (currentSeg.durationMs < 4000 && currentSeg.distanceM < 20) { currentSeg = null; return; }
      session.segments.push(currentSeg);
      if (currentSeg.kind === 'run' && currentSeg.durationMs > 15000 && currentSeg.distanceM > 120) session.runs.push(currentSeg);
      if (currentSeg.kind === 'lift' && currentSeg.durationMs > 20000 && currentSeg.distanceM > 60) session.lifts.push(currentSeg);
      currentSeg = null;
    };

    for (let i = 0; i < session.points.length; i++) {
      const p = session.points[i];
      if (p.speedKmh > session.metrics.maxSpeedKmh) session.metrics.maxSpeedKmh = p.speedKmh;
      if (i === 0) continue;

      const prev = session.points[i - 1];
      const dt = Math.max(0, p.ts - prev.ts);
      if (dt <= 0) continue;
      const dtSec = dt / 1000;
      const d = haversine(prev.lat, prev.lon, p.lat, p.lon);
      const cappedD = d < 250 ? d : 0;
      session.metrics.distanceM += cappedD;

      let dz = 0;
      if (Number.isFinite(prev.alt) && Number.isFinite(p.alt)) {
        dz = p.alt - prev.alt;
        if (Math.abs(dz) < 80) {
          if (dz > 0) session.metrics.ascentM += dz;
          else if (dz < 0) session.metrics.descentM += Math.abs(dz);
        }
      }
      const v = Number.isFinite(p.speedKmh) ? p.speedKmh : 0;
      const slopeRate = dtSec > 0 ? (dz / dtSec) : 0;

      if (v > 3) {
        session.metrics.movingMs += dt;
        weightedSpeed += v * dt;
        weightedTime += dt;
      } else {
        session.metrics.stoppedMs += dt;
      }

      let kind = 'other';
      const downhillStrong = slopeRate < -0.25;
      const uphillStrong = slopeRate > 0.18;
      const mostlyStopped = v < 2.0;
      const runCandidate = (v > 8 && downhillStrong) || (v > 15 && slopeRate < -0.05);
      const liftCandidate = (v >= 2.0 && v < 22 && uphillStrong) || (v >= 1.8 && v < 10 && slopeRate > 0.08);
      if (runCandidate) kind = 'run';
      else if (liftCandidate) kind = 'lift';
      else if (mostlyStopped) kind = 'stop';

      if (!currentSeg) {
        currentSeg = { kind, startTs: prev.ts, endTs: p.ts, lastTs: p.ts, distanceM: cappedD, maxSpeedKmh: v, elevDeltaM: dz };
      } else {
        const sameish = currentSeg.kind === kind;
        const canContinueRun = currentSeg.kind === 'run' && (kind === 'other' || (kind === 'stop' && dt < 5000));
        const canContinueLift = currentSeg.kind === 'lift' && (kind === 'other' || (kind === 'stop' && dt < 8000));
        const canContinueStop = currentSeg.kind === 'stop' && kind === 'other';

        if (sameish || canContinueRun || canContinueLift || canContinueStop) {
          currentSeg.endTs = p.ts;
          currentSeg.lastTs = p.ts;
          currentSeg.distanceM += cappedD;
          currentSeg.maxSpeedKmh = Math.max(currentSeg.maxSpeedKmh, v);
          currentSeg.elevDeltaM += dz;
        } else {
          pushSeg();
          currentSeg = { kind, startTs: prev.ts, endTs: p.ts, lastTs: p.ts, distanceM: cappedD, maxSpeedKmh: v, elevDeltaM: dz };
        }
      }
    }
    pushSeg();

    if (session.segments.length > 2) {
      const merged = [];
      for (const seg of session.segments) {
        const smallOther = seg.kind === 'other' && seg.durationMs < 15000 && seg.distanceM < 120;
        if (smallOther && merged.length) {
          const prev = merged[merged.length - 1];
          prev.endTs = seg.endTs;
          prev.durationMs = Math.max(0, prev.endTs - prev.startTs);
          prev.distanceM += seg.distanceM;
          prev.maxSpeedKmh = Math.max(prev.maxSpeedKmh, seg.maxSpeedKmh);
          prev.elevDeltaM += seg.elevDeltaM;
        } else {
          merged.push({ ...seg });
        }
      }
      session.segments = merged;
      session.runs = session.segments.filter(seg => seg.kind === 'run' && seg.durationMs > 15000 && seg.distanceM > 120);
      session.lifts = session.segments.filter(seg => seg.kind === 'lift' && seg.durationMs > 20000 && seg.distanceM > 60);
    }

    session.metrics.runMs = session.runs.reduce((s, r) => s + (r.durationMs || 0), 0);
    session.metrics.liftMs = session.lifts.reduce((s, r) => s + (r.durationMs || 0), 0);
    session.metrics.lifts = session.lifts.length;
    session.metrics.avgSpeedKmh = weightedTime ? (weightedSpeed / weightedTime) : 0;
    session.metrics.jumps = session.events.filter(e => e.type === 'jump').length;
  }

  // ---------- Maps ----------
  function initMaps() {
    state.ui.liveMap = L.map('liveMap').setView([STATION.lat, STATION.lon], STATION.zoom);
    state.ui.historyMap = L.map('historyMap').setView([STATION.lat, STATION.lon], STATION.zoom);
    const tileOpts = { maxZoom: 18, attribution: '&copy; OpenStreetMap' };
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', tileOpts).addTo(state.ui.liveMap);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', tileOpts).addTo(state.ui.historyMap);
    const icon = L.divIcon({ className:'station-marker', html:'<div style="background:#111827;color:white;border:1px solid #fff;border-radius:999px;padding:2px 6px;font-size:11px">⛷️</div>' });
    L.marker([STATION.lat, STATION.lon], {icon}).addTo(state.ui.liveMap).bindPopup(STATION.name);
    L.marker([STATION.lat, STATION.lon], {icon}).addTo(state.ui.historyMap).bindPopup(STATION.name);
    setTimeout(() => { state.ui.liveMap.invalidateSize(); state.ui.historyMap.invalidateSize(); }, 100);
  }

  function clearRoute(mapType) {
    const map = mapType === 'live' ? state.ui.liveMap : state.ui.historyMap;
    const routeKey = mapType === 'live' ? 'liveRoute' : 'historyRoute';
    const segKey = mapType === 'live' ? 'liveSpeedSegments' : 'historySegments';
    if (state.ui[routeKey]) { map.removeLayer(state.ui[routeKey]); state.ui[routeKey] = null; }
    state.ui[segKey].forEach(l => map.removeLayer(l));
    state.ui[segKey] = [];
  }

  function drawTrack(points, mapType='live') {
    const map = mapType === 'live' ? state.ui.liveMap : state.ui.historyMap;
    const colorBySpeed = mapType === 'live' && $('#speedColors').checked;
    clearRoute(mapType);
    if (!points || points.length < 2) return;
    const latlngs = points.map(p => [p.lat, p.lon]);
    if (!colorBySpeed) {
      const route = L.polyline(latlngs, { color:'#22c55e', weight:4, opacity:0.95 });
      route.addTo(map);
      if (mapType === 'live') state.ui.liveRoute = route; else state.ui.historyRoute = route;
    } else {
      const segs = [];
      for (let i=1;i<points.length;i++) {
        const a = points[i-1], b = points[i];
        segs.push(L.polyline([[a.lat,a.lon],[b.lat,b.lon]], { color: speedColor(b.speedKmh), weight:4, opacity:0.95 }).addTo(map));
      }
      if (mapType === 'live') state.ui.liveSpeedSegments = segs; else state.ui.historySegments = segs;
    }
  }

  function speedColor(v) {
    if (v < 8) return '#38bdf8';
    if (v < 20) return '#22c55e';
    if (v < 35) return '#f59e0b';
    return '#ef4444';
  }

  function updatePositionMarker(p) {
    const map = state.ui.liveMap;
    if (!map || !p) return;
    const ll = [p.lat, p.lon];
    if (!state.runtime.currentPosMarker) {
      state.runtime.currentPosMarker = L.circleMarker(ll, { radius:7, color:'#60a5fa', fillColor:'#93c5fd', fillOpacity:.9 }).addTo(map);
      state.runtime.accuracyCircle = L.circle(ll, { radius: p.acc || 15, color:'#60a5fa', weight:1, fillOpacity:.08 }).addTo(map);
    } else {
      state.runtime.currentPosMarker.setLatLng(ll);
      state.runtime.accuracyCircle.setLatLng(ll).setRadius(Math.max(5, p.acc || 10));
    }
    if ($('#followMe').checked) map.setView(ll, map.getZoom(), { animate:false });
  }

  // ---------- Tracking ----------
  function startSession() {
    if (state.active && state.active.status !== 'finished') return;
    state.active = newSession();
    $('#sessionStateBadge').textContent = 'Grabando';
    $('#sessionStateBadge').style.borderColor = 'rgba(34,197,94,.4)';
    $('#startBtn').disabled = true;
    $('#pauseBtn').disabled = false;
    $('#pauseBtn').textContent = '⏸ Pause';
    $('#stopBtn').disabled = false;
    setWarning('');
    if ($('#wakeOnStart').checked) requestWakeLock();
    startClock();
    startGpsWatch();
    ensureMotionSensors();
    startRobustModeLoop();
    setSavePill('Guardando…');
    saveAll();
    renderLive();
    renderHistoryList();
  }

  function pauseResumeSession() {
    if (!state.active) return;
    if (state.active.status === 'active') {
      state.active.status = 'paused';
      state.active.pausedAt = Date.now();
      $('#pauseBtn').textContent = '▶ Resume';
      $('#sessionStateBadge').textContent = 'Pausada';
      stopGpsWatch();
      stopClock();
      stopRobustModeLoop();
      setGpsPill('GPS: pausado');
      saveAll();
      renderLive();
    } else if (state.active.status === 'paused') {
      state.active.status = 'active';
      if (state.active.pausedAt) {
        state.active.totalPausedMs += (Date.now() - state.active.pausedAt);
        state.active.pausedAt = null;
      }
      $('#pauseBtn').textContent = '⏸ Pause';
      $('#sessionStateBadge').textContent = 'Grabando';
      if ($('#wakeOnStart').checked) requestWakeLock();
      startClock();
      startGpsWatch();
      ensureMotionSensors();
      startRobustModeLoop();
      saveAll();
      renderLive();
    }
  }

  function stopSession() {
    if (!state.active) return;
    if (state.active.status === 'paused' && state.active.pausedAt) {
      state.active.totalPausedMs += (Date.now() - state.active.pausedAt);
      state.active.pausedAt = null;
    }
    state.active.status = 'finished';
    state.active.endedAt = Date.now();
    recalcDerived(state.active);
    upsertFinishedSession(state.active);
    const finishedId = state.active.id;
    state.active = null;
    stopClock();
    stopGpsWatch();
    stopRobustModeLoop();
    releaseWakeLock();
    setGpsPill('GPS: —');
    $('#motionStatus').textContent = 'Sensores: en espera';
    $('#sessionStateBadge').textContent = 'Sin sesión';
    $('#startBtn').disabled = false;
    $('#pauseBtn').disabled = true;
    $('#stopBtn').disabled = true;
    clearRoute('live');
    if (state.runtime.currentPosMarker) { state.ui.liveMap.removeLayer(state.runtime.currentPosMarker); state.runtime.currentPosMarker = null; }
    if (state.runtime.accuracyCircle) { state.ui.liveMap.removeLayer(state.runtime.accuracyCircle); state.runtime.accuracyCircle = null; }
    saveAll();
    state.selectedId = finishedId;
    renderHistoryList();
    renderHistoryDetail();
    renderLive();
    setWarning('Sesión guardada correctamente en el historial.');
    setTimeout(() => setWarning(''), 2600);
  }

  function startClock() {
    stopClock();
    state.runtime.timerId = setInterval(() => {
      renderLive();
      gpsWatchdogCheck();
      if (state.active) saveAll(true);
    }, 1000);
  }
  function stopClock() { if (state.runtime.timerId) clearInterval(state.runtime.timerId); state.runtime.timerId = null; }

  function startGpsWatch() {
    if (!navigator.geolocation || !state.active || state.active.status !== 'active') return;
    stopGpsWatch();
    const robust = $('#robustMode')?.checked;
    const high = $('#gpsMode').value === 'high' || robust;
    try {
      state.runtime.geoWatchId = navigator.geolocation.watchPosition(onGps, onGpsError, {
        enableHighAccuracy: high,
        maximumAge: robust ? 0 : (high ? 1000 : 2500),
        timeout: robust ? 6000 : (high ? 8000 : 12000)
      });
      setGpsPill('GPS: iniciando…');
    } catch {
      setGpsPill('GPS: error');
    }
  }

  function stopGpsWatch() {
    if (state.runtime.geoWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(state.runtime.geoWatchId);
      state.runtime.geoWatchId = null;
    }
  }

  function onGps(pos) {
    if (!state.active || state.active.status !== 'active') return;
    state.runtime.lastGeoTs = Date.now();
    state.runtime.locationPermission = 'granted';
    updateControlButtonsState();
    const c = pos.coords;
    const ts = pos.timestamp || Date.now();
    const lat = c.latitude, lon = c.longitude;
    const acc = Number.isFinite(c.accuracy) ? c.accuracy : 20;
    const alt = Number.isFinite(c.altitude) ? c.altitude : null;

    let speedKmh = Number.isFinite(c.speed) && c.speed >= 0 ? c.speed * 3.6 : null;
    const prev = state.active.points.at(-1);
    if (prev) {
      const dt = (ts - prev.ts) / 1000;
      const d = haversine(prev.lat, prev.lon, lat, lon);
      const calcKmh = dt > 0 ? (d / dt) * 3.6 : 0;
      if (!Number.isFinite(speedKmh)) speedKmh = calcKmh;
      if (acc > 40) speedKmh = Math.min(speedKmh, calcKmh + 6);
      if (calcKmh > 95 || d > 180) speedKmh = Math.min(speedKmh, 70); // filter spikes
      if (prev.speedKmh != null) speedKmh = prev.speedKmh * 0.35 + speedKmh * 0.65;
    }
    speedKmh = Math.max(0, Math.min(90, speedKmh || 0));

    const point = { ts, lat, lon, alt, acc, speedKmh };
    state.active.points.push(point);
    // Trim motion samples if too many
    if (state.active.points.length > 30000) state.active.points.shift();
    recalcDerived(state.active);
    state.runtime.whereInfo = inferFormigalContext(point);
    renderWhereAmI();
    setGpsPill(`GPS: ${Math.round(acc)}m`);
    updatePositionMarker(point);
    drawTrack(state.active.points, 'live');
    saveAll(true);
    renderLive();
  }

  function onGpsError(err) {
    const msg = err && err.code === 1 ? 'permiso denegado' : (err && err.code === 2 ? 'sin señal' : 'timeout');
    if (err && err.code === 1) state.runtime.locationPermission = 'denied';
    updateControlButtonsState();
    setGpsPill(`GPS: ${msg}`);
    if (state.active && state.active.status === 'active') setWarning(`GPS con problema (${msg}). Puedes usar “Reintentar GPS” en Sensores/GPS.`);
  }

  function gpsWatchdogCheck() {
    if (!state.active || state.active.status !== 'active') return;
    const age = Date.now() - (state.runtime.lastGeoTs || 0);
    if (age > 12000) {
      setWarning('No están entrando puntos GPS. Si has bloqueado pantalla, desbloquea y pulsa “Reintentar GPS”.');
      setGpsPill('GPS: sin datos');
      if ($('#robustMode').checked && state.active?.status === 'active') {
        startGpsWatch();
      }
    }
    const ageMotion = Date.now() - (state.runtime.lastMotionTs || 0);
    if (ageMotion > 5000) {
      $('#motionStatus').textContent = 'Sensores: sin datos';
      $('#motionState').textContent = 'sin señal';
      updateControlButtonsState();
    }
  }

function initDynamicPisteProjection() {
  const frame = $('#dynPisteFrame');
  if (!frame || frame.dataset.bound) return;
  frame.dataset.bound = '1';
  window.addEventListener('resize', () => drawDynamicPisteProjection(), { passive:true });
}

function latLonToPistePixel(lat, lon) {
  const c = FORMIGAL_IMAGE_CAL;
  let x = c.xMin + ((lon - c.lonMin) / (c.lonMax - c.lonMin)) * (c.xMax - c.xMin);
  let y = c.yMax + ((c.latMax - lat) / (c.latMax - c.latMin)) * (c.yMin - c.yMax);
  x = Math.max(0, Math.min(c.width, x));
  y = Math.max(0, Math.min(c.height, y));
  return { x, y };
}

function drawDynamicPisteProjection() {
  const svg = $('#dynPisteSvg');
  const marker = $('#dynPisteMarker');
  if (!svg || !marker) return;
  const showTrack = $('#dynShowTrack')?.checked !== false;
  const showMarker = $('#dynShowProjection')?.checked !== false;
  const pts = (state.active?.points || []).slice(-900);

  let pathD = '';
  if (pts.length > 1 && showTrack) {
    const pix = pts.map(p => latLonToPistePixel(p.lat, p.lon));
    pathD = 'M ' + pix.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ');
  }
  svg.innerHTML = pathD ? `<path class="track-shadow" d="${pathD}"></path><path class="track" d="${pathD}"></path>` : '';

  const last = pts.at(-1);
  if (last && showMarker) {
    const p = latLonToPistePixel(last.lat, last.lon);
    marker.classList.remove('hidden');
    marker.style.left = `${(p.x / FORMIGAL_IMAGE_CAL.width) * 100}%`;
    marker.style.top = `${(p.y / FORMIGAL_IMAGE_CAL.height) * 100}%`;
  } else {
    marker.classList.add('hidden');
  }
}

function pointInPoly(lat, lon, poly) {
  let inside = false;
  for (let i=0, j=poly.length-1; i<poly.length; j=i++) {
    const yi = poly[i][0], xi = poly[i][1];
    const yj = poly[j][0], xj = poly[j][1];
    const cross = ((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-9) + xi);
    if (cross) inside = !inside;
  }
  return inside;
}

function llMeters(lat, lon) {
  return [lon * 111320 * Math.cos(42.78 * Math.PI / 180), lat * 110540];
}

function distPointToSegmentMeters(lat, lon, a, b) {
  const [px, py] = llMeters(lat, lon);
  const [ax, ay] = llMeters(a[0], a[1]);
  const [bx, by] = llMeters(b[0], b[1]);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy || 1;
  let t = ((px - ax)*dx + (py - ay)*dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t*dx, qy = ay + t*dy;
  return Math.hypot(px - qx, py - qy);
}

function distPointToPolylineMeters(lat, lon, line) {
  let best = Infinity;
  for (let i=1; i<line.length; i++) best = Math.min(best, distPointToSegmentMeters(lat, lon, line[i-1], line[i]));
  return best;
}

function inferFormigalContext(point) {
  if (!point) return null;
  const lat = point.lat, lon = point.lon;
  const segKind = state.active?.segments?.at(-1)?.kind || (state.sensor.moving ? 'moving' : 'idle');

  let sector = null;
  for (const s of FORMIGAL_SECTORS) { if (pointInPoly(lat, lon, s.poly)) { sector = s.name; break; } }
  if (!sector) {
    const ns = FORMIGAL_SECTORS.map(s => ({ s, d: haversine(lat, lon, s.center[0], s.center[1]) })).sort((a,b)=>a.d-b.d)[0];
    sector = ns ? ns.s.name : 'Formigal';
  }

  let lift = null;
  for (const l of FORMIGAL_LIFTS) {
    let d = distPointToPolylineMeters(lat, lon, l.line);
    if (segKind === 'lift') d *= 0.78;
    if (!lift || d < lift.d) lift = { name: l.name, d };
  }

  let piste = null;
  for (const z of FORMIGAL_PISTE_ZONES) {
    let d = distPointToPolylineMeters(lat, lon, z.line);
    if (segKind === 'run') d *= 0.82;
    if (!piste || d < piste.d) piste = { name: z.name, d };
  }

  const bestD = Math.min(lift?.d ?? 999, piste?.d ?? 999);
  let confidence = 'baja';
  if (bestD < 70) confidence = 'alta';
  else if (bestD < 150) confidence = 'media';

  return {
    sector,
    stateLabel: segKind === 'run' ? 'Bajada' : segKind === 'lift' ? 'Remonte' : segKind === 'stopped' ? 'Parado' : 'Grabando',
    pisteName: (piste && piste.d < 320) ? piste.name : `Zona ${sector}`,
    liftName: (lift && lift.d < 240) ? lift.name : '—',
    confidence,
    distanceText: bestD < 900 ? `${Math.round(bestD)} m` : '—',
    ts: point.ts
  };
}

function renderWhereAmI() {
  const info = state.runtime.whereInfo;
  if (!$('#whereSector')) return;
  $('#whereSector').textContent = info?.sector || '—';
  $('#whereState').textContent = info?.stateLabel || '—';
  $('#wherePiste').textContent = info?.pisteName || '—';
  $('#whereLift').textContent = info?.liftName || '—';
  $('#whereConfidence').textContent = info ? `${info.confidence}${info.distanceText && info.distanceText !== '—' ? ` · ${info.distanceText}` : ''}` : '—';
  $('#whereTs').textContent = info?.ts ? new Date(info.ts).toLocaleTimeString('es-ES',{hour12:false}) : '—';
  drawDynamicPisteProjection();
}

// ---------- Motion sensors ----------

  function ensureMotionSensors() {
    if (state.runtime.motionListenerAttached) return;
    const attach = () => {
      window.addEventListener('devicemotion', onDeviceMotion, { passive: true });
      state.runtime.motionListenerAttached = true;
      state.runtime.motionPermission = 'granted';
      $('#motionStatus').textContent = 'Sensores: ok';
      updateControlButtonsState();
    };
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      // iOS path (future-proof)
      DeviceMotionEvent.requestPermission().then(res => {
        if (res === 'granted') attach(); else { state.runtime.motionPermission = 'denied'; $('#motionStatus').textContent = 'Sensores: permiso'; updateControlButtonsState(); }
      }).catch(() => { state.runtime.motionPermission = 'prompt'; $('#motionStatus').textContent = 'Sensores: permiso'; updateControlButtonsState(); });
    } else {
      attach();
    }
  }

  function onDeviceMotion(e) {
    state.runtime.lastMotionTs = Date.now();
    if (!state.runtime.sensorHasData) { state.runtime.sensorHasData = true; updateControlButtonsState(); }
    const aWithG = e.accelerationIncludingGravity || {};
    const aLin = e.acceleration || {};
    const r = e.rotationRate || {};
    const axg = toNum(aWithG.x), ayg = toNum(aWithG.y), azg = toNum(aWithG.z);
    const ax = toNum(aLin.x), ay = toNum(aLin.y), az = toNum(aLin.z);
    const gx = toNum(r.alpha), gy = toNum(r.beta), gz = toNum(r.gamma);

    const accelMagWithG = mag3(axg, ayg, azg);
    const accelMagLin = mag3(ax, ay, az);
    const gyroMag = mag3(gx, gy, gz);
    const accelDisplay = accelMagLin > 0 ? accelMagLin : Math.abs(accelMagWithG - 9.81);

    state.sensor.accelMag = accelDisplay;
    state.sensor.gyroMag = gyroMag;

    if (state.runtime.calibrating) state.runtime.calibSamples.push({ accel: accelDisplay, gyro: gyroMag });

    const calib = state.sensor.calib;
    const accelMoveThr = calib ? Math.max(calib.accelMean + 0.4, calib.accelMean + 2 * calib.accelSd) : 1.2;
    const gyroMoveThr = calib ? Math.max(calib.gyroMean + 10, calib.gyroMean + 2 * calib.gyroSd) : 24;
    const gpsSpeedNow = state.active?.points?.at(-1)?.speedKmh || 0;
    let moving = accelDisplay > accelMoveThr || gyroMag > gyroMoveThr;
    if (gpsSpeedNow > 5) moving = true;
    state.sensor.moving = moving;

    let intensity = 'suave';
    if (gpsSpeedNow > 25 || accelDisplay > accelMoveThr + 2.5 || gyroMag > gyroMoveThr + 55) intensity = 'agresivo';
    else if (moving) intensity = 'medio';
    state.sensor.intensity = intensity;

    $('#accelValue').textContent = `${fmt.n(accelDisplay,2)} m/s²`;
    $('#gyroValue').textContent = `${fmt.n(gyroMag,1)} °/s`;
    $('#motionState').textContent = moving ? 'en movimiento' : 'quieto';
    $('#intensityState').textContent = intensity;
    $('#sensorLastTs').textContent = new Date().toLocaleTimeString('es-ES', {hour12:false});
    $('#motionStatus').textContent = `Sensores: ${moving ? 'mov.' : 'quieto'}`;
    updateControlButtonsState();

    if (state.active && state.active.status === 'active') {
      const ts = Date.now();
      const last = state.active.motionSamples.at(-1);
      if (!last || ts - last.ts > 1000) {
        state.active.motionSamples.push({ ts, accel: accelDisplay, gyro: gyroMag, intensity });
        if (state.active.motionSamples.length > 12000) state.active.motionSamples.shift();
      }
      detectJump(accelDisplay, ts);
      saveAll(true);
    }
  }

  function detectJump(accelMag, ts) {
    if (!state.active || !$('#jumpEnabled').checked) return;
    const js = state.runtime.jumpState;
    // Heurística simple: fase ligera + impacto
    if (accelMag < 0.9) js.lowTs = ts;
    const impactThreshold = 4.2;
    if (js.lowTs && (ts - js.lowTs) > 120 && (ts - js.lowTs) < 1200 && accelMag > impactThreshold) {
      if (ts - js.lastJumpTs > 2000) {
        const airtimeMs = ts - js.lowTs;
        state.active.events.push({ ts, type:'jump', label:`Salto (${Math.round(airtimeMs)}ms)`, airtimeMs });
        js.lastJumpTs = ts;
        state.active.metrics.jumps = (state.active.metrics.jumps || 0) + 1;
        renderLive();
      }
      js.lowTs = 0;
    }
  }

  function calibrateSensors() {
    if (state.runtime.calibrating) return;
    state.runtime.calibrating = true;
    state.runtime.calibSamples = [];
    $('#calibrationState').textContent = 'calibrando…';
    setWarning('Calibrando 5 segundos: deja el móvil quieto (sección Sensores/GPS).');
    ensureMotionSensors();
    setTimeout(() => {
      const s = state.runtime.calibSamples;
      state.runtime.calibrating = false;
      if (s.length < 5) {
        setWarning('No se recibieron suficientes datos de sensores para calibrar.');
        $('#calibrationState').textContent = 'fallo';
        return;
      }
      const accel = stats(s.map(x => x.accel));
      const gyro = stats(s.map(x => x.gyro));
      state.sensor.calib = {
        accelMean: accel.mean, accelSd: accel.sd,
        gyroMean: gyro.mean, gyroSd: gyro.sd,
        ts: Date.now()
      };
      renderCalibrationState();
      savePrefs();
      setWarning('Calibración guardada.');
      setTimeout(() => setWarning(''), 1800);
    }, 5000);
  }

  function renderCalibrationState() {
    if (!state.sensor.calib) { $('#calibrationState').textContent = 'no'; return; }
    $('#calibrationState').textContent = `sí (${fmt.n(state.sensor.calib.accelMean,1)})`;
  }


function updateToggleHighlights() {
  ['wakeOnStart','jumpEnabled','robustMode','followMe','speedColors'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const label = el.closest('label');
    if (label) label.classList.toggle('on', !!el.checked);
  });
}

function updateControlButtonsState() {
  updateToggleHighlights();
  const now = Date.now();
  const locBtn = $('#requestLocationBtn');
  const motionBtn = $('#requestMotionBtn');
  const wakeBtn = $('#wakeBtn');
  const retryBtn = $('#retryGpsBtn');

  const gpsFresh = !!state.runtime.lastGeoTs && (now - state.runtime.lastGeoTs < 12000);
  const motionFresh = !!state.runtime.lastMotionTs && (now - state.runtime.lastMotionTs < 7000);

  const locOk = state.runtime.locationPermission === 'granted' || gpsFresh;
  locBtn.classList.toggle('is-on', locOk);
  locBtn.textContent = locOk ? '✓ Ubicación ok' : 'Permiso ubicación';

  const motionOk = (state.runtime.motionPermission === 'granted' || state.runtime.motionListenerAttached) && (state.runtime.sensorHasData || motionFresh);
  motionBtn.classList.toggle('is-on', motionOk);
  motionBtn.textContent = motionOk ? '✓ Sensores ok' : 'Permiso sensores';

  const wakeOn = !!state.runtime.wakeLock;
  wakeBtn.classList.toggle('is-on', wakeOn);
  wakeBtn.textContent = wakeOn ? '✓ Pantalla activa' : 'Pantalla activa ahora';

  const gpsActive = !!state.active && state.active.status === 'active' && gpsFresh;
  retryBtn.classList.toggle('is-on', gpsActive);
  retryBtn.textContent = gpsActive ? '✓ GPS activo' : 'Reintentar GPS';
}

async function refreshPermissionStates() {
  try {
    if (navigator.permissions?.query) {
      const p = await navigator.permissions.query({ name: 'geolocation' });
      state.runtime.locationPermission = p.state || state.runtime.locationPermission;
      p.onchange = () => { state.runtime.locationPermission = p.state; updateControlButtonsState(); };
    }
  } catch {}
  updateControlButtonsState();
}

function startRobustModeLoop() {
  stopRobustModeLoop();
  if (!$('#robustMode')?.checked) { updateControlButtonsState(); return; }
  state.runtime.robustIntervalId = setInterval(() => {
    if (!state.active || state.active.status !== 'active') return;
    if ($('#wakeOnStart').checked && document.visibilityState === 'visible') requestWakeLock();
    ensureMotionSensors();

    const gpsAge = Date.now() - (state.runtime.lastGeoTs || 0);
    if (gpsAge > 6000 && navigator.geolocation && !state.runtime.robustPollBusy) {
      state.runtime.robustPollBusy = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => { state.runtime.robustPollBusy = false; onGps(pos); },
        (err) => { state.runtime.robustPollBusy = false; if (err?.code === 1) { state.runtime.locationPermission = 'denied'; updateControlButtonsState(); } },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
      );
    }
    if (gpsAge > 15000) startGpsWatch();
    updateControlButtonsState();
  }, 4000);
  updateControlButtonsState();
}

function stopRobustModeLoop() {
  if (state.runtime.robustIntervalId) clearInterval(state.runtime.robustIntervalId);
  state.runtime.robustIntervalId = null;
  state.runtime.robustPollBusy = false;
  updateControlButtonsState();
}

  // ---------- Render ----------
  function renderLive() {
    const s = state.active;
    if (!s) {
      $('#mSpeed').textContent = '0.0'; $('#mMax').textContent='0.0'; $('#mAvg').textContent='0.0';
      $('#mDistance').textContent='0.00'; $('#mDuration').textContent='00:00:00'; $('#mMoving').textContent='00:00:00';
      $('#mAsc').textContent='0'; $('#mDesc').textContent='0'; $('#mRuns').textContent='0'; $('#mLifts').textContent='0'; $('#mLiftTime').textContent='00:00:00'; $('#mJumps').textContent='0';
      state.runtime.whereInfo = null;
      renderWhereAmI();
      return;
    }
    const last = s.points.at(-1);
    recalcDerived(s);
    $('#mSpeed').textContent = fmt.n(last?.speedKmh || 0, 1);
    $('#mMax').textContent = fmt.n(s.metrics.maxSpeedKmh || 0, 1);
    $('#mAvg').textContent = fmt.n(s.metrics.avgSpeedKmh || 0, 1);
    $('#mDistance').textContent = fmt.km(s.metrics.distanceM || 0);
    $('#mDuration').textContent = fmt.ms(activeElapsedMs());
    $('#mMoving').textContent = fmt.ms(s.metrics.movingMs || 0);
    $('#mAsc').textContent = String(Math.round(s.metrics.ascentM || 0));
    $('#mDesc').textContent = String(Math.round(s.metrics.descentM || 0));
    $('#mRuns').textContent = String((s.runs || []).length);
    $('#mLifts').textContent = String(s.metrics.lifts || 0);
    $('#mLiftTime').textContent = fmt.ms(s.metrics.liftMs || 0);
    $('#mJumps').textContent = String(s.metrics.jumps || 0);
    if (s.points.length > 1) {
      drawTrack(s.points, 'live');
      const currentSeg = (s.segments || []).at(-1);
      if (currentSeg?.kind === 'run') $('#motionStatus').textContent = 'Sensores: bajada';
      else if (currentSeg?.kind === 'lift') $('#motionStatus').textContent = 'Sensores: remonte';
    }
  }

  function renderHistoryList() {
    const box = $('#historyList');
    if (!state.sessions.length) {
      box.innerHTML = '<div class="small">Aún no hay sesiones guardadas.</div>';
      return;
    }
    box.innerHTML = '';
    for (const s of state.sessions) {
      const el = document.createElement('div');
      el.className = 'session-item' + (state.selectedId === s.id ? ' active' : '');
      recalcDerived(s);
      el.innerHTML = `
        <div class="title">${escapeHtml(s.name || 'Sesión')}</div>
        <div class="meta">
          <span>${fmt.shortDate(s.startedAt)}</span>
          <span>${s.type || '—'}</span>
          <span>${fmt.km(s.metrics.distanceM || 0)} km</span>
          <span>Máx ${fmt.n(s.metrics.maxSpeedKmh || 0,1)} km/h</span><span>${s.metrics.lifts || 0} remontes</span>
        </div>`;
      el.addEventListener('click', () => { state.selectedId = s.id; renderHistoryList(); renderHistoryDetail(); });
      box.appendChild(el);
    }
  }

  function renderHistoryDetail() {
    const s = state.sessions.find(x => x.id === state.selectedId);
    const empty = $('#historyEmpty');
    const detail = $('#historyDetail');
    if (!s) {
      empty.classList.remove('hidden'); detail.classList.add('hidden');
      clearRoute('history');
      return;
    }
    empty.classList.add('hidden'); detail.classList.remove('hidden');
    recalcDerived(s);
    const bestRun = (s.runs || []).slice().sort((a,b) => (b.distanceM||0)-(a.distanceM||0))[0];
    const bestLift = (s.lifts || []).slice().sort((a,b) => (b.durationMs||0)-(a.durationMs||0))[0];
    $('#historySummary').innerHTML = [
      ['Inicio', fmt.date(s.startedAt)],
      ['Duración', fmt.ms((s.endedAt || s.startedAt) - s.startedAt - (s.totalPausedMs||0))],
      ['Distancia', `${fmt.km(s.metrics.distanceM)} km`],
      ['Vel. máx', `${fmt.n(s.metrics.maxSpeedKmh,1)} km/h`],
      ['Vel. media', `${fmt.n(s.metrics.avgSpeedKmh,1)} km/h`],
      ['Desnivel', `+${Math.round(s.metrics.ascentM)} / -${Math.round(s.metrics.descentM)} m`],
      ['Runs', String((s.runs||[]).length)],
      ['Remontes', `${s.metrics.lifts || 0} · ${fmt.ms(s.metrics.liftMs || 0)}`],
      ['Tiempo esquiando', fmt.ms(s.metrics.runMs || 0)],
      ['Saltos', String(s.metrics.jumps || 0)],
      ['Top run', bestRun ? `${fmt.km(bestRun.distanceM)} km · ${fmt.n(bestRun.maxSpeedKmh,1)} km/h` : '—'],
      ['Top remonte', bestLift ? `${fmt.ms(bestLift.durationMs || 0)} · +${Math.round(bestLift.elevDeltaM || 0)} m` : '—'],
      ['Nieve/Vis/Viento', `${s.config?.snowCondition||'-'} · ${s.config?.visibility||'-'} · ${s.config?.windLevel||'-'}`]
    ].map(([k,v]) => `<div class="row"><div class="k">${k}</div><div class="v">${escapeHtml(String(v))}</div></div>`).join('');
    drawTrack(s.points, 'history');
    if (s.points.length) {
      const ll = s.points.map(p => [p.lat, p.lon]);
      state.ui.historyMap.fitBounds(ll, { padding:[18,18] });
    }
    setTimeout(() => state.ui.historyMap.invalidateSize(), 50);
  }

  function renderWeather() {
    const box = $('#weatherBox');
    box.textContent = 'Cargando…';
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${STATION.meteoLat}&longitude=${STATION.meteoLon}&hourly=temperature_2m,wind_speed_10m,visibility,snowfall&daily=temperature_2m_max,temperature_2m_min,snowfall_sum,wind_speed_10m_max&current=temperature_2m,wind_speed_10m,weather_code&forecast_days=4&timezone=auto`)
      .then(r => r.json())
      .then(data => {
        const c = data.current || {};
        const d = data.daily || {};
        const rows = [];
        for (let i = 0; i < (d.time || []).length; i++) {
          rows.push({
            date: d.time[i],
            tmin: d.temperature_2m_min?.[i],
            tmax: d.temperature_2m_max?.[i],
            snow: d.snowfall_sum?.[i],
            wind: d.wind_speed_10m_max?.[i]
          });
        }
        box.innerHTML = `
          <div class="weather-now">
            <div class="tile"><div class="k">Ahora</div><div class="v">${fmt.n(c.temperature_2m ?? 0,1)} °C</div></div>
            <div class="tile"><div class="k">Viento</div><div class="v">${fmt.n(c.wind_speed_10m ?? 0,0)} km/h</div></div>
          </div>
          <div class="small">Resumen rápido automático para Formigal (zona estación). Úsalo como apoyo y confirma condiciones finales en la estación/parte oficial.</div>
          <div class="weather-days">
            ${rows.map(r => `<div class="day"><span>${new Date(r.date).toLocaleDateString('es-ES',{weekday:'short',day:'2-digit',month:'2-digit'})}</span><span>${fmt.n(r.tmin,0)} / ${fmt.n(r.tmax,0)} °C · ❄ ${fmt.n(r.snow,0)} cm · 💨 ${fmt.n(r.wind,0)} km/h</span></div>`).join('')}
          </div>`;
      })
      .catch(() => {
        box.innerHTML = '<div class="small">No se pudo cargar la meteo automática ahora. Usa los botones de Infonieve/Formigal.</div>';
      });
  }

  // ---------- Exports ----------
  function downloadFile(name, type, content) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportSelectedJson() {
    const s = state.sessions.find(x => x.id === state.selectedId); if (!s) return;
    downloadFile(`${safeName(s.name)}.json`, 'application/json', JSON.stringify(s, null, 2));
  }
  function exportSelectedCsv() {
    const s = state.sessions.find(x => x.id === state.selectedId); if (!s) return;
    const rows = ['ts,lat,lon,alt_m,acc_m,speed_kmh'];
    for (const p of s.points) rows.push([p.ts,p.lat,p.lon,p.alt ?? '',p.acc ?? '', fmt.n(p.speedKmh,2)].join(','));
    downloadFile(`${safeName(s.name)}.csv`, 'text/csv;charset=utf-8', rows.join('\n'));
  }
  function exportSelectedGpx() {
    const s = state.sessions.find(x => x.id === state.selectedId); if (!s) return;
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Formigal Session AI" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${xmlEscape(s.name)}</name><trkseg>\n${s.points.map(p => `  <trkpt lat="${p.lat}" lon="${p.lon}">${Number.isFinite(p.alt)?`<ele>${p.alt}</ele>`:''}<time>${new Date(p.ts).toISOString()}</time></trkpt>`).join('\n')}\n</trkseg></trk>\n</gpx>`;
    downloadFile(`${safeName(s.name)}.gpx`, 'application/gpx+xml', gpx);
  }

  // ---------- UI events ----------
  function initUi() {
    // tabs
    $$('.tab').forEach(btn => btn.addEventListener('click', () => {
      $$('.tab').forEach(b => b.classList.remove('active'));
      $$('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('#tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'history') setTimeout(() => state.ui.historyMap.invalidateSize(), 80);
      if (btn.dataset.tab === 'session') setTimeout(() => state.ui.liveMap.invalidateSize(), 80);
      if (btn.dataset.tab === 'meteo') renderWeather();
    }));

    // top
    $('#themeBtn').addEventListener('click', () => {
      if ($('#alwaysDark').checked) return;
      $('#app').classList.toggle('theme-light');
      $('#app').classList.toggle('theme-dark');
      savePrefs();
    });
    $('#contrastBtn').addEventListener('click', () => {
      $('#app').classList.toggle('high-contrast');
      $('#highContrastToggle').checked = $('#app').classList.contains('high-contrast');
      savePrefs();
    });
    $('#highContrastToggle').addEventListener('change', () => {
      $('#app').classList.toggle('high-contrast', $('#highContrastToggle').checked);
      savePrefs();
    });
    $('#alwaysDark').addEventListener('change', () => {
      if ($('#alwaysDark').checked) { $('#app').classList.remove('theme-light'); $('#app').classList.add('theme-dark'); }
      savePrefs();
    });

    // config persistence
    ['#sessionName','#sessionType','#gpsMode','#snowCondition','#visibility','#windLevel','#phonePlacement','#wakeOnStart','#followMe','#speedColors','#jumpEnabled','#robustMode']
      .forEach(sel => $(sel).addEventListener('change', savePrefs));
    $('#sessionName').addEventListener('input', savePrefs);
    ['#wakeOnStart','#jumpEnabled','#robustMode','#followMe','#speedColors'].forEach(sel => $(sel).addEventListener('change', () => {
      updateControlButtonsState();
      if (sel === '#wakeOnStart' && !$('#wakeOnStart').checked) releaseWakeLock();
      if (sel === '#robustMode' && state.active?.status === 'active') {
        startGpsWatch();
        if ($('#robustMode').checked) startRobustModeLoop(); else stopRobustModeLoop();
      }
    }));
    $('#gpsMode').addEventListener('change', () => { if (state.active?.status === 'active') startGpsWatch(); updateControlButtonsState(); });

    // session buttons
    $('#startBtn').addEventListener('click', startSession);
    $('#pauseBtn').addEventListener('click', pauseResumeSession);
    $('#stopBtn').addEventListener('click', stopSession);

    // map controls
    $('#centerBtn').addEventListener('click', () => {
      const p = state.active?.points?.at(-1);
      if (p) state.ui.liveMap.setView([p.lat,p.lon], Math.max(14, state.ui.liveMap.getZoom()));
      else state.ui.liveMap.setView([STATION.lat, STATION.lon], STATION.zoom);
    });
    $('#fitBtn').addEventListener('click', () => {
      const pts = state.active?.points || [];
      if (pts.length >= 2) state.ui.liveMap.fitBounds(pts.map(p => [p.lat,p.lon]), { padding:[20,20] });
      else state.ui.liveMap.setView([STATION.lat, STATION.lon], STATION.zoom);
    });
    $('#speedColors').addEventListener('change', () => { if (state.active) drawTrack(state.active.points, 'live'); savePrefs(); });

    // permissions/config controls
    $('#requestLocationBtn').addEventListener('click', () => {
      $('#requestLocationBtn').classList.add('is-busy');
      navigator.geolocation.getCurrentPosition(
        () => { state.runtime.locationPermission = 'granted'; setGpsPill('GPS: permiso ok'); $('#requestLocationBtn').classList.remove('is-busy'); updateControlButtonsState(); },
        (e) => { $('#requestLocationBtn').classList.remove('is-busy'); onGpsError(e); },
        { enableHighAccuracy: false, timeout: 5000 }
      );
    });
    $('#requestMotionBtn').addEventListener('click', () => { $('#requestMotionBtn').classList.add('is-busy'); ensureMotionSensors(); setTimeout(() => { $('#requestMotionBtn').classList.remove('is-busy'); updateControlButtonsState(); }, 900); });
    $('#retryGpsBtn').addEventListener('click', () => { if (state.active?.status === 'active') { startGpsWatch(); if ($('#robustMode').checked) startRobustModeLoop(); setWarning('GPS reiniciado.'); updateControlButtonsState(); } });
    $('#wakeBtn').addEventListener('click', async () => { await requestWakeLock(); updateControlButtonsState(); });
    $('#calibrateBtn').addEventListener('click', calibrateSensors);

    // history
    $('#refreshHistoryBtn').addEventListener('click', () => { loadSessions(); renderHistoryList(); renderHistoryDetail(); renderLiveStateButtons(); });
    $('#clearAllBtn').addEventListener('click', () => {
      if (!confirm('¿Borrar todas las sesiones guardadas?')) return;
      state.sessions = []; if (!state.active) localStorage.removeItem(KEYS.active);
      saveAll(); renderHistoryList(); renderHistoryDetail();
    });
    $('#exportJsonBtn').addEventListener('click', exportSelectedJson);
    $('#exportCsvBtn').addEventListener('click', exportSelectedCsv);
    $('#exportGpxBtn').addEventListener('click', exportSelectedGpx);
    $('#duplicateBtn').addEventListener('click', duplicateSelectedConfigToForm);
    $('#deleteSessionBtn').addEventListener('click', deleteSelectedSession);

    // meteo
    $('#refreshWeatherBtn').addEventListener('click', renderWeather);

    // settings
    $('#exportAllBtn').addEventListener('click', () => {
      const copy = { sessions: state.sessions, active: state.active, exportedAt: new Date().toISOString() };
      downloadFile(`formigal-backup-${Date.now()}.json`, 'application/json', JSON.stringify(copy, null, 2));
    });
    $('#resetPrefsBtn').addEventListener('click', () => {
      localStorage.removeItem(KEYS.prefs);
      location.reload();
    });

    // piste map fullscreen
    const openPiste = () => {
      $('#imageModalImg').src = $('#pisteImage').src;
      if ($('#imageModal').showModal) $('#imageModal').showModal();
    };
    $('#pisteImage').addEventListener('click', openPiste);
    $('#openPisteFullscreen').addEventListener('click', openPiste);

    // Pista/remonte (experimental)
    if ($('#dynShowTrack')) {
      initDynamicPisteProjection();
      $('#dynShowTrack').addEventListener('change', drawDynamicPisteProjection);
      $('#dynShowProjection').addEventListener('change', drawDynamicPisteProjection);
      $('#dynPisteWrap').addEventListener('click', () => {
        if (!document.fullscreenElement) $('#dynPisteFrame').requestFullscreen?.().catch?.(() => {});
      });
      $('#dynMapFullscreenBtn').addEventListener('click', () => {
        if (document.fullscreenElement === $('#dynPisteFrame')) document.exitFullscreen?.();
        else $('#dynPisteFrame').requestFullscreen?.().catch?.(() => {});
      });
      document.addEventListener('fullscreenchange', () => setTimeout(drawDynamicPisteProjection, 120));
    }

    // install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.runtime.installingPrompt = e;
      $('#installBtn').hidden = false;
    });
    $('#installBtn').addEventListener('click', async () => {
      if (!state.runtime.installingPrompt) return;
      state.runtime.installingPrompt.prompt();
      try { await state.runtime.installingPrompt.userChoice; } catch {}
      state.runtime.installingPrompt = null;
      $('#installBtn').hidden = true;
    });

    // lifecycle
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.active?.status === 'active') {
        setTimeout(() => {
          gpsWatchdogCheck();
          if (Date.now() - (state.runtime.lastGeoTs || 0) > 12000) startGpsWatch();
          if ($('#robustMode').checked) startRobustModeLoop();
          if ($('#wakeOnStart').checked) requestWakeLock();
        }, 700);
      }
      if (document.visibilityState === 'hidden' && $('#robustMode').checked && state.active?.status === 'active') setWarning('Modo robusto activo. Intenta mantener pantalla encendida para evitar cortes de GPS en PWA.');
      saveAll(true);
      updateControlButtonsState();
    });
    window.addEventListener('beforeunload', () => {
      savePrefs();
      saveAll();
    });
    window.addEventListener('online', () => setWarning('')); 
  }

  function renderLiveStateButtons() {
    if (!state.active) {
      $('#startBtn').disabled = false; $('#pauseBtn').disabled = true; $('#stopBtn').disabled = true;
      $('#pauseBtn').textContent = '⏸ Pause';
      $('#sessionStateBadge').textContent = 'Sin sesión';
      updateControlButtonsState();
      return;
    }
    $('#startBtn').disabled = true;
    $('#pauseBtn').disabled = false;
    $('#stopBtn').disabled = false;
    if (state.active.status === 'paused') {
      $('#pauseBtn').textContent = '▶ Resume';
      $('#sessionStateBadge').textContent = 'Pausada';
    } else {
      $('#pauseBtn').textContent = '⏸ Pause';
      $('#sessionStateBadge').textContent = state.active.status === 'finished' ? 'Finalizada' : 'Grabando';
    }
    updateControlButtonsState();
  }

  function duplicateSelectedConfigToForm() {
    const s = state.sessions.find(x => x.id === state.selectedId); if (!s) return;
    $('#sessionName').value = `${s.name} copia`;
    $('#sessionType').value = s.type || 'Snowboard';
    $('#gpsMode').value = s.config?.gpsMode || 'balanced';
    $('#snowCondition').value = s.config?.snowCondition || 'polvo';
    $('#visibility').value = s.config?.visibility || 'buena';
    $('#windLevel').value = s.config?.windLevel || 'bajo';
    $('#phonePlacement').value = s.config?.phonePlacement || 'jacket';
    $('#jumpEnabled').checked = s.config?.jumpEnabled !== false;
    $('#robustMode').checked = s.config?.robustMode !== false;
    updateControlButtonsState();
    savePrefs();
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'session'));
    $$('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-session'));
  }

  function deleteSelectedSession() {
    const idx = state.sessions.findIndex(x => x.id === state.selectedId);
    if (idx < 0) return;
    if (!confirm('¿Borrar esta sesión?')) return;
    state.sessions.splice(idx,1);
    state.selectedId = state.sessions[0]?.id || null;
    saveAll();
    renderHistoryList();
    renderHistoryDetail();
  }

  // ---------- Helpers ----------
  function setGpsPill(text) { $('#gpsStatus').textContent = text; }
  function setWarning(text) { $('#warningBar').textContent = text || ''; $('#warningBar').classList.toggle('hidden', !text); }
  function toNum(v) { return Number.isFinite(v) ? v : 0; }
  function mag3(a,b,c){ return Math.sqrt(a*a+b*b+c*c); }
  function stats(arr) {
    const n = arr.length || 1;
    const mean = arr.reduce((s,v) => s + v, 0) / n;
    const sd = Math.sqrt(arr.reduce((s,v) => s + Math.pow(v - mean, 2), 0) / n);
    return { mean, sd };
  }
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function safeName(s) { return (s || 'session').replace(/[^a-z0-9-_]+/gi,'_'); }
  function xmlEscape(s) { return String(s).replace(/[<>&'\"]/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[m])); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  async function requestWakeLock() {
    try {
      if (!('wakeLock' in navigator)) { setWarning('Wake Lock no disponible en este navegador.'); return; }
      if (state.runtime.wakeLock) return;
      state.runtime.wakeLock = await navigator.wakeLock.request('screen');
      state.runtime.wakeLock.addEventListener('release', () => { state.runtime.wakeLock = null; updateControlButtonsState(); });
      updateControlButtonsState();
    } catch {
      setWarning('No se pudo activar pantalla activa.');
    }
  }
  async function releaseWakeLock() {
    try { await state.runtime.wakeLock?.release(); } catch {}
    state.runtime.wakeLock = null;
    updateControlButtonsState();
  }

  // ---------- PWA init ----------
  function registerSW() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // ---------- Boot ----------
  function boot() {
    loadSessions();
    loadPrefs();
    initMaps();
    initUi();
    $('#sensorsPanel').open = false;
    $('#sessionConfig').open = false;
    refreshPermissionStates();
    renderLiveStateButtons();
    if (state.active) {
      // recover active session across refresh
      renderLive();
      drawTrack(state.active.points || [], 'live');
      const p = state.active.points?.at(-1); if (p) updatePositionMarker(p);
      if (state.active.status === 'active') {
        startClock();
        startGpsWatch();
        ensureMotionSensors();
        startRobustModeLoop();
        if ($('#wakeOnStart').checked) requestWakeLock();
        setWarning('Sesión recuperada tras recargar.');
        setTimeout(() => setWarning(''), 2200);
      }
    }
    state.selectedId = state.sessions[0]?.id || null;
    renderHistoryList();
    renderHistoryDetail();
    setSavePill('Guardado ✓');
    renderWhereAmI();
    renderWeather();
    updateControlButtonsState();
    savePrefs();
    registerSW();
  }

  boot();
})();
