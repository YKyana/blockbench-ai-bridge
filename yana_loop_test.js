(function () {
  let startAction;
  let stopAction;
  let rafId = null;
  let targets = [];
  let bases = new Map();
  let startTime = 0;

  const DURATION_MS = 6000;
  const TRACK_LEFT_X = -6;
  const TRACK_RIGHT_X = 6;
  const TRACK_BOTTOM_Y = 7;
  const TRACK_TOP_Y = 17;
  const Z_OFFSET = 0;

  const TARGET_NAMES = [
    'Loop_Cube_01',
    'Loop_Cube_02',
    'Loop_Cube_03',
    'Loop_Cube_04'
  ];

  function msg(text, timeout = 2200) {
    if (Blockbench.showQuickMessage) Blockbench.showQuickMessage(text, timeout);
  }

  function clone3(v) {
    return [v[0], v[1], v[2]];
  }

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
      if (cube.preview_controller.updateTransform) cube.preview_controller.updateTransform(cube);
      if (cube.preview_controller.updateGeometry) cube.preview_controller.updateGeometry(cube);
    }
  }

  // Rectangle aligned to the machine's inner tracks.
  // 0.00 bottom center -> right
  // 0.25 right bottom -> up
  // 0.50 right top -> left
  // 0.75 left top -> down
  // 1.00 back to bottom center
  function pathAt(phase) {
    const p = ((phase % 1) + 1) % 1;

    if (p < 0.25) {
      const t = p / 0.25;
      return [
        TRACK_LEFT_X + (TRACK_RIGHT_X - TRACK_LEFT_X) * t,
        TRACK_BOTTOM_Y,
        Z_OFFSET
      ];
    }

    if (p < 0.50) {
      const t = (p - 0.25) / 0.25;
      return [
        TRACK_RIGHT_X,
        TRACK_BOTTOM_Y + (TRACK_TOP_Y - TRACK_BOTTOM_Y) * t,
        Z_OFFSET
      ];
    }

    if (p < 0.75) {
      const t = (p - 0.50) / 0.25;
      return [
        TRACK_RIGHT_X + (TRACK_LEFT_X - TRACK_RIGHT_X) * t,
        TRACK_TOP_Y,
        Z_OFFSET
      ];
    }

    const t = (p - 0.75) / 0.25;
    return [
      TRACK_LEFT_X,
      TRACK_TOP_Y + (TRACK_BOTTOM_Y - TRACK_TOP_Y) * t,
      Z_OFFSET
    ];
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

    targets = TARGET_NAMES
      .map(name => Outliner.elements.find(el => el && el.name === name))
      .filter(Boolean);

    if (!targets.length) {
      Blockbench.showMessageBox({
        title: 'Loop Test',
        message: 'No loop cubes found. Sync the Infinite Cube Machine scene first.'
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
    msg('Loop Test v0.2: 4 cubes following the machine track');
  }

  function stopLoop(reset = true) {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

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
      msg('Loop Test: stopped');
    }
  }

  Plugin.register('yana_loop_test', {
    title: 'Yana Loop Test',
    author: 'Yana + ChatGPT',
    description: 'Preview four cubes moving around the Infinite Cube Machine track.',
    icon: 'all_inclusive',
    version: '0.2.0',
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
      msg('Yana Loop Test v0.2 loaded');
    },

    onunload() {
      stopLoop(false);
      if (startAction) startAction.delete();
      if (stopAction) stopAction.delete();
    }
  });
})();
