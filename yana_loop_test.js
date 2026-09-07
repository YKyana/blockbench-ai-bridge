(function () {
  let startAction;
  let stopAction;
  let rafId = null;
  let target = null;
  let base = null;
  let startTime = 0;

  const DURATION_MS = 4000;
  const WIDTH = 12;
  const HEIGHT = 8;

  function msg(text, timeout = 2200) {
    if (Blockbench.showQuickMessage) Blockbench.showQuickMessage(text, timeout);
  }

  function getTarget() {
    return Outliner.elements.find(el => el && el.name === 'Loop_Cube_01') ||
           Outliner.elements.find(el => el instanceof Cube);
  }

  function clone3(v) {
    return [v[0], v[1], v[2]];
  }

  function setOffset(cube, x, y, z) {
    cube.from[0] = base.from[0] + x;
    cube.from[1] = base.from[1] + y;
    cube.from[2] = base.from[2] + z;

    cube.to[0] = base.to[0] + x;
    cube.to[1] = base.to[1] + y;
    cube.to[2] = base.to[2] + z;

    cube.origin[0] = base.origin[0] + x;
    cube.origin[1] = base.origin[1] + y;
    cube.origin[2] = base.origin[2] + z;

    if (cube.preview_controller) {
      if (cube.preview_controller.updateTransform) cube.preview_controller.updateTransform(cube);
      if (cube.preview_controller.updateGeometry) cube.preview_controller.updateGeometry(cube);
    }
  }

  // Closed rectangular path. phase 0 and phase 1 are exactly the same point.
  function pathAt(phase) {
    const p = ((phase % 1) + 1) % 1;
    const q = p * 4;

    if (q < 1) {
      return [WIDTH * q, 0, 0];
    }
    if (q < 2) {
      return [WIDTH, HEIGHT * (q - 1), 0];
    }
    if (q < 3) {
      return [WIDTH * (3 - q), HEIGHT, 0];
    }
    return [0, HEIGHT * (4 - q), 0];
  }

  function frame(now) {
    if (!target || !base) return;
    const phase = ((now - startTime) % DURATION_MS) / DURATION_MS;
    const pos = pathAt(phase);
    setOffset(target, pos[0], pos[1], pos[2]);
    rafId = requestAnimationFrame(frame);
  }

  function startLoop() {
    stopLoop(false);
    target = getTarget();
    if (!target) {
      Blockbench.showMessageBox({
        title: 'Loop Test',
        message: 'No cube found. Sync the Infinite Cube Machine scene first.'
      });
      return;
    }

    base = {
      from: clone3(target.from),
      to: clone3(target.to),
      origin: clone3(target.origin)
    };
    startTime = performance.now();
    rafId = requestAnimationFrame(frame);
    msg('Loop Test: running 4-second seamless loop');
  }

  function stopLoop(reset = true) {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (reset && target && base) {
      setOffset(target, 0, 0, 0);
    }
    if (reset) msg('Loop Test: stopped');
  }

  Plugin.register('yana_loop_test', {
    title: 'Yana Loop Test',
    author: 'Yana + ChatGPT',
    description: 'Safe standalone seamless-loop preview test. Does not modify AI Bridge.',
    icon: 'all_inclusive',
    version: '0.1.0',
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
      msg('Yana Loop Test v0.1 loaded');
    },

    onunload() {
      stopLoop(false);
      if (startAction) startAction.delete();
      if (stopAction) stopAction.delete();
    }
  });
})();
