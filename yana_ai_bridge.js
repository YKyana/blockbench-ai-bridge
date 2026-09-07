(function () {
  let syncAction, runAction, startLoopAction, stopLoopAction;
  let autoTimer = null;
  let rafId = null;
  let loopTargets = [];
  let loopBases = new Map();
  let loopStartTime = 0;

  const COMMAND_URL = 'https://raw.githubusercontent.com/YKyana/blockbench-ai-bridge/refs/heads/main/command.json';
  const LAST_ID_KEY = 'yana_ai_bridge_last_command_id';
  const LOOP_DURATION_MS = 7000;
  const HERO_NAMES = ['Hero_Cube_01','Hero_Cube_02','Hero_Cube_03'];

  function msg(text, timeout = 2200) {
    if (Blockbench.showQuickMessage) Blockbench.showQuickMessage(text, timeout);
  }

  function vec3(v, label) {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) {
      throw new Error(label + ' must contain 3 numbers');
    }
  }

  function clone3(v) { return [v[0], v[1], v[2]]; }

  function cubeCenter(cube) {
    return [
      (cube.from[0] + cube.to[0]) / 2,
      (cube.from[1] + cube.to[1]) / 2,
      (cube.from[2] + cube.to[2]) / 2
    ];
  }

  function setCenter(cube, cx, cy, cz) {
    const base = loopBases.get(cube.uuid);
    if (!base) return;
    const dx = cx - base.center[0];
    const dy = cy - base.center[1];
    const dz = cz - base.center[2];

    cube.from[0] = base.from[0] + dx;
    cube.from[1] = base.from[1] + dy;
    cube.from[2] = base.from[2] + dz;
    cube.to[0] = base.to[0] + dx;
    cube.to[1] = base.to[1] + dy;
    cube.to[2] = base.to[2] + dz;
    cube.origin[0] = base.origin[0] + dx;
    cube.origin[1] = base.origin[1] + dy;
    cube.origin[2] = base.origin[2] + dz;

    if (cube.preview_controller) {
      cube.preview_controller.updateTransform?.(cube);
      cube.preview_controller.updateGeometry?.(cube);
    }
  }

  function easeIn(t) { return t * t; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 2); }
  function lerp(a,b,t) { return a + (b-a)*t; }

  // Closed mechanical path: center drop -> bottom catcher -> right -> lift -> top rail -> center.
  function pathAt(phase) {
    const p = ((phase % 1) + 1) % 1;
    if (p < 0.28) {
      const t = easeIn(p / 0.28);
      return [0, lerp(17, 7, t), 0];
    }
    if (p < 0.38) return [0, 7, 0];
    if (p < 0.52) {
      const t = easeOut((p - 0.38) / 0.14);
      return [lerp(0, 8, t), 7, 0];
    }
    if (p < 0.78) {
      const t = easeOut((p - 0.52) / 0.26);
      return [8, lerp(7, 17, t), 0];
    }
    if (p < 0.96) {
      const t = easeOut((p - 0.78) / 0.18);
      return [lerp(8, 0, t), 17, 0];
    }
    return [0, 17, 0];
  }

  function stopLoop(reset = true) {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (reset) {
      loopTargets.forEach(cube => {
        const base = loopBases.get(cube.uuid);
        if (!base) return;
        cube.from.replace(base.from);
        cube.to.replace(base.to);
        cube.origin.replace(base.origin);
        cube.preview_controller?.updateTransform?.(cube);
        cube.preview_controller?.updateGeometry?.(cube);
      });
      msg('Yana Loop: stopped');
    }
  }

  function loopFrame(now) {
    const basePhase = ((now - loopStartTime) % LOOP_DURATION_MS) / LOOP_DURATION_MS;
    loopTargets.forEach((cube, index) => {
      const phase = (basePhase + index / loopTargets.length) % 1;
      const pos = pathAt(phase);
      setCenter(cube, pos[0], pos[1], pos[2]);
    });
    rafId = requestAnimationFrame(loopFrame);
  }

  function startLoop() {
    stopLoop(false);
    loopTargets = HERO_NAMES.map(name => Outliner.elements.find(el => el && el.name === name)).filter(Boolean);

    if (loopTargets.length !== HERO_NAMES.length) {
      Blockbench.showMessageBox({
        title: 'Yana Loop',
        message: 'Hero cubes are missing. Press AI Bridge: Sync from ChatGPT first.'
      });
      return;
    }

    loopBases.clear();
    loopTargets.forEach(cube => {
      loopBases.set(cube.uuid, {
        from: clone3(cube.from),
        to: clone3(cube.to),
        origin: clone3(cube.origin),
        center: cubeCenter(cube)
      });
    });

    loopStartTime = performance.now();
    rafId = requestAnimationFrame(loopFrame);
    msg('Yana Loop: 3 Hero cubes running');
  }

  function runCommand(payload) {
    if (typeof payload === 'string') payload = JSON.parse(payload);
    if (!payload || typeof payload !== 'object') throw new Error('Invalid JSON command');

    stopLoop(false);
    const cubes = Array.isArray(payload.cubes) ? payload.cubes : [];
    Undo.initEdit({elements: [], outliner: true});
    try {
      if (payload.clear === true && Array.isArray(Outliner.root)) {
        [...Outliner.root].forEach(node => node && node.remove && node.remove());
      }

      const created = [];
      cubes.forEach((spec, i) => {
        const from = spec.from || [0,0,0];
        const to = spec.to || [4,4,4];
        vec3(from, `cubes[${i}].from`);
        vec3(to, `cubes[${i}].to`);
        const origin = spec.origin || [(from[0]+to[0])/2,(from[1]+to[1])/2,(from[2]+to[2])/2];
        const rotation = spec.rotation || [0,0,0];
        vec3(origin, `cubes[${i}].origin`);
        vec3(rotation, `cubes[${i}].rotation`);

        const cube = new Cube({
          name: spec.name || `AI_Cube_${i+1}`,
          from, to, origin, rotation,
          autouv: 1,
          box_uv: false
        }).addTo('root').init();

        if (Number.isInteger(spec.color)) cube.color = spec.color;
        created.push(cube);
      });

      Undo.finishEdit('AI Bridge command');
      Canvas.updateView?.({elements: created, element_aspects:{geometry:true, transform:true}, selection:true});
      msg(`AI Bridge: created ${created.length} object(s)`);
    } catch (e) {
      try { Undo.cancelEdit(); } catch (_) {}
      throw e;
    }
  }

  async function syncFromAI(manual = false) {
    try {
      const response = await fetch(COMMAND_URL + '?t=' + Date.now(), {cache:'no-store'});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();
      if (!payload.enabled) {
        if (manual) msg('AI Bridge: no active command');
        return;
      }

      const commandId = String(payload.id || '');
      const lastId = localStorage.getItem(LAST_ID_KEY) || '';
      if (!manual && commandId && commandId === lastId) return;

      runCommand(payload);
      if (commandId) localStorage.setItem(LAST_ID_KEY, commandId);
      msg('AI Bridge: synced from ChatGPT');
    } catch (e) {
      console.error('[Yana AI Bridge] Sync failed:', e);
      if (manual) Blockbench.showMessageBox({title:'AI Bridge sync error', message:String(e.message || e)});
    }
  }

  function openDialog() {
    const dialog = new Dialog({
      id:'yana_ai_bridge_dialog',
      title:'AI Bridge',
      form:{command:{label:'Paste command JSON',type:'textarea',height:240,value:'{\n  "clear": false,\n  "cubes": []\n}'}},
      onConfirm(form) {
        try { runCommand(form.command); dialog.hide(); }
        catch (e) { Blockbench.showMessageBox({title:'AI Bridge error',message:String(e.message || e)}); }
      }
    });
    dialog.show();
  }

  Plugin.register('yana_ai_bridge', {
    title:'Yana AI Bridge',
    author:'Yana + ChatGPT',
    description:'Single Blockbench bridge with scene sync and seamless loop preview.',
    icon:'hub',
    version:'1.0.0',
    variant:'both',
    onload() {
      syncAction = new Action('yana_ai_bridge_sync', {name:'Yana: Sync Scene', icon:'sync', click:() => syncFromAI(true)});
      runAction = new Action('yana_ai_bridge_run', {name:'Yana: Run JSON', icon:'smart_toy', click:openDialog});
      startLoopAction = new Action('yana_ai_bridge_loop_start', {name:'Yana: Start Loop', icon:'play_arrow', click:startLoop});
      stopLoopAction = new Action('yana_ai_bridge_loop_stop', {name:'Yana: Stop Loop', icon:'stop', click:() => stopLoop(true)});

      MenuBar.menus.tools.addAction(syncAction);
      MenuBar.menus.tools.addAction(startLoopAction);
      MenuBar.menus.tools.addAction(stopLoopAction);
      MenuBar.menus.tools.addAction(runAction);

      autoTimer = setInterval(() => syncFromAI(false), 5000);
      setTimeout(() => syncFromAI(false), 1000);
      msg('Yana AI Bridge 1.0 loaded — one plugin only');
    },
    onunload() {
      stopLoop(false);
      if (autoTimer) clearInterval(autoTimer);
      syncAction?.delete();
      runAction?.delete();
      startLoopAction?.delete();
      stopLoopAction?.delete();
    }
  });
})();
