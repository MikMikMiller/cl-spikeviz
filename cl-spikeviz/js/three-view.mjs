const THREE_MODULE_URL = "../vendor/three.module.js";
const CHANNELS = 64;
const GRID = 8;
const PITCH = 1.05;
const BASE_HEIGHT = 0.08;
const MAX_HEIGHT = 1.55;
const PULSE_LIFE_SECONDS = 0.82;

export async function createThreeMeaView(container, { onSelectChannel, onHoverChannel, onStatus }) {
  if (!supportsWebGL()) {
    return createFallbackView(container, "WebGL is unavailable in this browser. The 2D dashboard remains available.");
  }

  let THREE;
  try {
    THREE = await import(THREE_MODULE_URL);
  } catch (error) {
    console.error("Unable to load Three.js", error);
    return createFallbackView(container, "Unable to load Three.js. Check network access or use the 2D dashboard.");
  }

  container.textContent = "";
  onStatus?.("initialising");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050809);
  scene.fog = new THREE.Fog(0x050809, 8, 22);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
  camera.position.set(6.4, 6.2, 8.2);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const worldPosition = new THREE.Vector3();

  const pads = [];
  const pulses = [];
  let hoveredChannel = null;
  let lastSpikeTotal = 0;
  let lastStimTotal = 0;
  let lastFrameMs = performance.now();
  let elapsedSeconds = 0;
  let size = { width: 0, height: 0 };
  let destroyed = false;

  const hemiLight = new THREE.HemisphereLight(0xc9fff1, 0x111819, 1.45);
  const keyLight = new THREE.DirectionalLight(0xd9fff5, 2.25);
  keyLight.position.set(4, 7, 5);

  const baseGeometry = new THREE.BoxGeometry(9.4, 0.05, 9.4);
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x0e2422,
    emissive: 0x06221e,
    emissiveIntensity: 0.08,
    roughness: 0.72,
    metalness: 0.28,
  });
  const plane = new THREE.Mesh(baseGeometry, baseMaterial);
  plane.position.y = -0.04;

  const grid = new THREE.GridHelper(9.4, 16, 0x27413c, 0x172723);
  grid.position.y = 0.01;

  const padGeometry = new THREE.CylinderGeometry(0.24, 0.28, 1, 24);
  const ringGeometry = new THREE.TorusGeometry(0.34, 0.018, 8, 40);
  ringGeometry.rotateX(Math.PI / 2);
  const selectedRingGeometry = new THREE.TorusGeometry(0.36, 0.022, 8, 48);
  selectedRingGeometry.rotateX(Math.PI / 2);
  const selectedMaterial = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
  const selectedRing = new THREE.Mesh(selectedRingGeometry, selectedMaterial);
  selectedRing.visible = false;

  scene.add(hemiLight);
  scene.add(keyLight);
  scene.add(plane);
  scene.add(grid);
  scene.add(selectedRing);

  for (let channel = 0; channel < CHANNELS; channel += 1) {
    const { x, z } = channelPosition(channel);
    const material = new THREE.MeshStandardMaterial({
      color: 0x0d2d28,
      emissive: 0x0a2f29,
      emissiveIntensity: 0.12,
      roughness: 0.58,
      metalness: 0.38,
    });
    const pad = new THREE.Mesh(padGeometry, material);
    pad.position.set(x, BASE_HEIGHT / 2, z);
    pad.scale.y = BASE_HEIGHT;
    pad.userData.channel = channel;
    pads.push(pad);
    scene.add(pad);
  }

  const onPointerMove = (event) => {
    const channel = channelFromPointer(event);
    if (channel !== hoveredChannel) {
      hoveredChannel = channel;
      onHoverChannel?.(channel);
    }
  };
  const onPointerLeave = () => {
    hoveredChannel = null;
    onHoverChannel?.(null);
  };
  const onPointerClick = (event) => {
    const channel = channelFromPointer(event);
    if (channel !== null) {
      onSelectChannel?.(channel);
    }
  };

  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerleave", onPointerLeave);
  renderer.domElement.addEventListener("click", onPointerClick);

  onStatus?.("ready");

  return {
    draw(state) {
      if (destroyed) {
        return;
      }

      resizeIfNeeded();
      const nowMs = performance.now();
      const deltaSeconds = Math.min(0.05, (nowMs - lastFrameMs) / 1000);
      lastFrameMs = nowMs;

      syncAfterReset(state);
      if (state.paused) {
        renderer.render(scene, camera);
        return;
      }

      elapsedSeconds += deltaSeconds;
      if (!reducedMotion) {
        collectEvents(state);
        updatePulses(deltaSeconds);
      }
      updatePads(state);
      renderer.render(scene, camera);
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;

      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("click", onPointerClick);
      renderer.domElement.remove();
      while (pulses.length > 0) {
        removePulse(pulses.pop());
      }
      for (const pad of pads) {
        scene.remove(pad);
        pad.material.dispose();
      }

      scene.remove(plane);
      scene.remove(grid);
      scene.remove(selectedRing);
      scene.remove(hemiLight);
      scene.remove(keyLight);
      baseMaterial.dispose();
      selectedMaterial.dispose();
      baseGeometry.dispose();
      padGeometry.dispose();
      ringGeometry.dispose();
      selectedRingGeometry.dispose();
      if (grid.geometry) {
        grid.geometry.dispose();
      }
      if (grid.material) {
        grid.material.dispose();
      }

      renderer.dispose();
      container.textContent = "";
    },
  };

  function syncAfterReset(state) {
    if (state.totals.spikes >= lastSpikeTotal && state.totals.stims >= lastStimTotal) {
      return;
    }

    lastSpikeTotal = state.totals.spikes;
    lastStimTotal = state.totals.stims;
    while (pulses.length) {
      removePulse(pulses.pop());
    }
  }

  function resizeIfNeeded() {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (width === size.width && height === size.height) {
      return;
    }

    size = { width, height };
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function updatePads(state) {
    for (let channel = 0; channel < CHANNELS; channel += 1) {
      const pad = pads[channel];
      const enabled = channel < state.channelCount;
      const activity = enabled ? clamp01(state.channelActivity[channel] || 0) : 0;
      const stimulated = enabled && Boolean(state.channelHasStim[channel]);
      const selected = channel === state.selectedChannel;
      const hovered = channel === state.hoveredChannel;
      const pulse = enabled && !reducedMotion
        ? Math.max(0, Math.sin(elapsedSeconds * 8 + channel * 0.41)) * activity * 0.08
        : 0;
      const height = enabled ? BASE_HEIGHT + activity * MAX_HEIGHT + pulse : BASE_HEIGHT;

      pad.scale.y += (height - pad.scale.y) * 0.28;
      pad.position.y = Math.max(BASE_HEIGHT, pad.scale.y) / 2;

      if (!enabled) {
        pad.material.color.setHex(0x10201f);
        pad.material.emissive.setHex(0x030807);
        pad.material.emissiveIntensity = 0.02;
      } else if (stimulated) {
        pad.material.color.setHex(0x9f7d2e);
        pad.material.emissive.setHex(0xe5c46b);
        pad.material.emissiveIntensity = 0.55 + activity * 0.5;
      } else {
        pad.material.color.setRGB(0.05 + activity * 0.12, 0.2 + activity * 0.68, 0.18 + activity * 0.52);
        pad.material.emissive.setRGB(0.02, 0.16 + activity * 0.62, 0.14 + activity * 0.62);
      }

      if (!enabled) {
        continue;
      }

      const baseEmissive = stimulated ? 0.55 + activity * 0.5 : 0.15 + activity * 0.78;
      pad.material.emissiveIntensity = baseEmissive + (selected ? 0.48 : hovered ? 0.22 : 0);
    }

    if (state.selectedChannel !== null && state.selectedChannel < CHANNELS) {
      const { x, z } = channelPosition(state.selectedChannel);
      selectedRing.position.set(x, 0.07, z);
      selectedRing.visible = true;
    } else {
      selectedRing.visible = false;
    }
  }

  function collectEvents(state) {
    if (state.totals.spikes > lastSpikeTotal) {
      const count = state.totals.spikes - lastSpikeTotal;
      for (const spike of state.spikes.slice(-count)) {
        if (spike.channel < state.channelCount && spike.channel < CHANNELS) {
          addPulse(spike.channel, false);
        }
      }
      lastSpikeTotal = state.totals.spikes;
    }

    if (state.totals.stims > lastStimTotal) {
      const count = state.totals.stims - lastStimTotal;
      for (const stim of state.stims.slice(-count)) {
        if (stim.channel < state.channelCount && stim.channel < CHANNELS) {
          addPulse(stim.channel, true);
        }
      }
      lastStimTotal = state.totals.stims;
    }
  }

  function addPulse(channel, stimulated) {
    const material = new THREE.MeshBasicMaterial({
      color: stimulated ? 0xe5c46b : 0x6ee7d2,
      transparent: true,
      opacity: stimulated ? 0.82 : 0.66,
      depthWrite: false,
    });
    const pulse = new THREE.Mesh(ringGeometry, material);
    const { x, z } = channelPosition(channel);

    pulse.position.set(x, 0.22, z);
    pulse.userData.age = 0;
    pulse.userData.stimulated = stimulated;
    pulses.push(pulse);
    scene.add(pulse);

    while (pulses.length > 120) {
      removePulse(pulses.shift());
    }
  }

  function updatePulses(deltaSeconds) {
    for (let index = pulses.length - 1; index >= 0; index -= 1) {
      const pulse = pulses[index];
      pulse.userData.age += deltaSeconds;
      const t = pulse.userData.age / PULSE_LIFE_SECONDS;
      if (t >= 1) {
        pulses.splice(index, 1);
        removePulse(pulse);
        continue;
      }

      const scale = 1 + t * (pulse.userData.stimulated ? 2.2 : 1.5);
      pulse.scale.setScalar(scale);
      pulse.position.y = 0.22 + t * 0.85;
      pulse.material.opacity = (pulse.userData.stimulated ? 0.82 : 0.66) * (1 - t);
    }
  }

  function removePulse(pulse) {
    scene.remove(pulse);
    pulse.material.dispose();
  }

  function channelFromPointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    pointer.x = (localX / rect.width) * 2 - 1;
    pointer.y = -(localY / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pads, false)[0];
    return hit ? hit.object.userData.channel : nearestProjectedChannel(localX, localY, rect);
  }

  function nearestProjectedChannel(localX, localY, rect) {
    let nearest = null;
    let bestDistance = 34;

    for (const pad of pads) {
      pad.getWorldPosition(worldPosition);
      worldPosition.project(camera);
      const screenX = ((worldPosition.x + 1) / 2) * rect.width;
      const screenY = ((1 - worldPosition.y) / 2) * rect.height;
      const distance = Math.hypot(screenX - localX, screenY - localY);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = pad.userData.channel;
      }
    }

    return nearest;
  }
}

function channelPosition(channel) {
  const col = channel % GRID;
  const row = Math.floor(channel / GRID);
  return {
    x: (col - (GRID - 1) / 2) * PITCH,
    z: (row - (GRID - 1) / 2) * PITCH,
  };
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function createFallbackView(container, message) {
  container.innerHTML = `<p class="webgl-fallback">${message}</p>`;
  return {
    draw() {},
    destroy() {},
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
