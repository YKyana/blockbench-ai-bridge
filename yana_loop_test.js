(function () {
  let startAction;
  let stopAction;
  let rafId = null;
  let targets = [];
  let bases = new Map();
  let startTime = 0;

  const DURATION_MS = 7000;
  const TARGET_NAMES = ['Hero_Cube_01','Hero_Cube_02','Hero_Cube_03'];

  function msg(text, timeout = 2200) {
    if (Blockbench.showQuickMessage) Blockbench.showQuickMessage(text, timeout);
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
    const base = bases.get(cube.uuid);
    if (!base) return;
    const dx = cx - base.center[0];
    const dy = cy - base.center[1];
    const dz = cz - base.center[2];

    cube.from[0] = base.from[0] + dx; cube.from[1] = base.from[1] + dy; cube.from[2] = base.from[2] + dz;
    cube.to[0] = base.to[0] + dx; cube.to[1] = base.to[1] + dy; cube.to[2] = base.to[2] + dz;
    cube.origin[0] = base.origin[0] + dx; cube.origin[1] = base.origin[1] + dy; cube.origin[2] = base.origin[2] + dz;

    if (cube.preview_controller) {
      if (cube.preview_controller.updateTransform) cube.preview_controller.updateTransform(cube);
      if (cube.preview_controller.updateGeometry) cube.preview_controller.updateGeometry(cube);
    }
  }

  function easeIn(t) { return t * t; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 2); }
  function lerp(a,b,t){ return a + (b-a)*t; }

  // Mechanical cycle:
  // 0.00-0.28 drop through center shaft
  // 0.28-0.38 short catch/hold
  // 0.38-0.52 move right on bottom rail
  // 0.52-0.78 elevator rises
  // 0.78-0.96 move left on top rail
  // 0.96-1.00 tiny settle, then seamless repeat
  function pathAt(phase) {
    const p = ((phase % 1) + 1) % 1;

    if (p < 0.28) {
      const t = easeIn(p / 0.28);
      return [0, lerp(17, 7, t), 0];
    }
    if (p < 0.38) {
      return [0, 7, 0];
    }
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

  function frame(now) {
    const basePhase = ((now - startTime) % DURATION_MS) / DURATION_MS;
    targets.forEach((cube, index) => {
      const phase = (basePhase + index / targets.length) % 1;
      const pos = pathAt(phase);
      setCenter(cube, pos[0], pos[1], pos[2]);
    });
    rafId = requestAnimationFrame(frame);
  }

  function startLoop() {
    stopLoop(false);
    targets = TARGET_NAMES.map(name => Outliner.elements.find(el => el && el.name === name)).filter(Boolean);
    if (!targets.length) {
      Blockbench.showMessageBox({
        title: 'Infinite Cube Machine',
        message: 'No Hero_Cube objects found. Sync the redesigned scene first.'
      });
      return;
    }

    bases.clear();
    targets.forEach(cube => {
      bases.set(cube.uuid, {
        from: clone3(cube.from),
        to: clone3(cube.to),
        origin: clone3(cube.origin),
        center: cubeCenter(cube)
      });
    });

    startTime = performance.now();
    rafId = requestAnimationFrame(frame);
    msg('Infinite Cube Machine v0.3 running');
  }

  function stopLoop(reset = true) {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (reset) {
      targets.forEach(cube => {
        const base = bases.get(cube.uuid);
        if (!base) return;
        cube.from.replace(base.from);
        cube.to.replace(base.to);
        cube.origin.replace(base.origin);
        if (cube.preview_controller) {
          if (cube.preview_controller.updateTransform) cube.preview_controller.updateTransform(cube);
          if (cube.preview_controller.updateGeometry) cube.preview_controller.updateGeometry(cube);
        }
      });
      msg('Infinite Cube Machine: stopped');
    }
  }

  Plugin.register('yana_loop_test', {
    title: 'Yana Loop Test',
    author: 'Yana + ChatGPT',
    description: 'Mechanical seamless-loop preview for the redesigned Infinite Cube Machine.',
    icon: 'all_inclusive',
    version: '0.3.0',
    variant: 'both',
    onload() {
      startAction = new Action('yana_loop_test_start', {
        name: 'Loop Test: Start',
        icon: 'play_arrow',
        click: startLoop
      });
      stopAction = new Action('yana_loop_test_stop', {
        name: 'Loop Test: Stop',
        icon: 'stop',
        click: () => stopLoop(true)
      });
      MenuBar.menus.tools.addAction(startAction);
      MenuBar.menus.tools.addAction(stopAction);
      msg('Yana Loop Test v0.3 loaded');
    },
    onunload() {
      stopLoop(false);
      if (startAction) startAction.delete();
      if (stopAction) stopAction.delete();
    }
  });
})();
