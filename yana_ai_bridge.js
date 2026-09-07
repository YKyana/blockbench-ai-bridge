(function () {
  const STATE_KEY = '__yana_ai_bridge_v2_state__';
  const COMMAND_URL = 'https://raw.githubusercontent.com/YKyana/blockbench-ai-bridge/main/command.json';
  const LAST_ID_KEY = 'yana_ai_bridge_v2_last_command_id';

  // Clean up an older copy if this file is loaded again in the same Blockbench session.
  try {
    const old = globalThis[STATE_KEY];
    if (old) {
      if (old.timer) clearInterval(old.timer);
      (old.actions || []).forEach(a => { try { a?.delete?.(); } catch (_) {} });
    }
    ['yana_v2_sync','yana_v2_run','yana_v2_play','yana_v2_stop'].forEach(id => {
      try { if (typeof BarItems !== 'undefined' && BarItems[id]) BarItems[id].delete(); } catch (_) {}
    });
  } catch (_) {}

  const state = { actions: [], timer: null };
  globalThis[STATE_KEY] = state;

  function msg(text, timeout = 2400) {
    if (Blockbench?.showQuickMessage) Blockbench.showQuickMessage(text, timeout);
  }

  function fail(title, error) {
    console.error('[Yana Bridge 2]', error);
    Blockbench.showMessageBox({title, message: String(error?.message || error)});
  }

  function v3(value, label) {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
      throw new Error(label + ' must be [x, y, z] numbers');
    }
    return value;
  }

  function clearProjectScene() {
    if (Array.isArray(Outliner?.root)) {
      [...Outliner.root].forEach(node => { try { node?.remove?.(); } catch (_) {} });
    }
    if (typeof Animation !== 'undefined' && Array.isArray(Animation.all)) {
      [...Animation.all].forEach(anim => { try { anim?.remove?.(false); } catch (_) {} });
    }
  }

  function createScene(payload) {
    const groupsByName = new Map();
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    const cubes = Array.isArray(payload.cubes) ? payload.cubes : [];

    Undo.initEdit({elements: [], groups: [], outliner: true});
    try {
      if (payload.clear === true) clearProjectScene();

      groups.forEach((spec, i) => {
        const origin = v3(spec.origin || [0,0,0], `groups[${i}].origin`);
        const group = new Group({
          name: spec.name || `AI_Group_${i+1}`,
          origin,
          rotation: v3(spec.rotation || [0,0,0], `groups[${i}].rotation`)
        }).init().addTo();
        groupsByName.set(group.name, group);
      });

      const created = [];
      cubes.forEach((spec, i) => {
        const from = v3(spec.from || [0,0,0], `cubes[${i}].from`);
        const to = v3(spec.to || [4,4,4], `cubes[${i}].to`);
        const origin = v3(spec.origin || [
          (from[0]+to[0])/2,
          (from[1]+to[1])/2,
          (from[2]+to[2])/2
        ], `cubes[${i}].origin`);
        const rotation = v3(spec.rotation || [0,0,0], `cubes[${i}].rotation`);
        const parent = spec.parent ? groupsByName.get(spec.parent) : null;
        if (spec.parent && !parent) throw new Error(`Missing parent group: ${spec.parent}`);

        const cube = new Cube({
          name: spec.name || `AI_Cube_${i+1}`,
          from, to, origin, rotation,
          autouv: 1,
          box_uv: false
        }).addTo(parent || 'root').init();

        if (Number.isInteger(spec.color)) {
          if (typeof cube.setColor === 'function') cube.setColor(spec.color);
          else cube.color = spec.color;
        }
        created.push(cube);
      });

      Undo.finishEdit('Yana Bridge: build scene');
      Canvas?.updateView?.({
        elements: created,
        element_aspects: {geometry: true, transform: true},
        selection: true
      });
      return {groupsByName, created};
    } catch (e) {
      try { Undo.cancelEdit(); } catch (_) {}
      throw e;
    }
  }

  function createNativeAnimations(payload, groupsByName) {
    const specs = Array.isArray(payload.animations) ? payload.animations : [];
    if (!specs.length) return [];
    if (typeof Animation === 'undefined' || typeof BoneAnimator === 'undefined') {
      throw new Error('This Blockbench format/session does not expose the native Animation API');
    }

    const result = [];
    Undo.initEdit({animations: []});
    try {
      specs.forEach((spec, ai) => {
        const animation = new Animation({
          name: spec.name || `Yana_Loop_${ai+1}`,
          loop: spec.loop === false ? 'once' : 'loop',
          length: Number.isFinite(spec.length) ? spec.length : 6,
          snapping: Number.isFinite(spec.snapping) ? spec.snapping : 30
        }).add();

        const tracks = Array.isArray(spec.tracks) ? spec.tracks : [];
        tracks.forEach((track, ti) => {
          const group = groupsByName.get(track.target) || Group.all?.find(g => g.name === track.target);
          if (!group) throw new Error(`Animation target group not found: ${track.target}`);

          const animator = new BoneAnimator(group.uuid, animation, group.name);
          animation.animators[group.uuid] = animator;

          const channel = track.channel || 'position';
          const keyframes = Array.isArray(track.keyframes) ? track.keyframes : [];
          keyframes.forEach((kf, ki) => {
            const value = v3(kf.value || [0,0,0], `animations[${ai}].tracks[${ti}].keyframes[${ki}].value`);
            animator.addKeyframe({
              time: Number.isFinite(kf.time) ? kf.time : 0,
              channel,
              interpolation: kf.interpolation || 'linear',
              data_points: [{x:value[0], y:value[1], z:value[2]}]
            });
          });
        });
        result.push(animation);
      });
      Undo.finishEdit('Yana Bridge: create native animation');
    } catch (e) {
      try { Undo.cancelEdit(); } catch (_) {}
      throw e;
    }

    if (result[0]) {
      try { result[0].select(); } catch (_) {}
      try { Timeline?.setTime?.(0); } catch (_) {}
    }
    return result;
  }

  function runCommand(payload) {
    if (typeof payload === 'string') payload = JSON.parse(payload);
    if (!payload || typeof payload !== 'object') throw new Error('Command must be a JSON object');

    const {groupsByName, created} = createScene(payload);
    const animations = createNativeAnimations(payload, groupsByName);
    msg(`Yana Bridge 2: ${created.length} objects, ${animations.length} native animation(s)`);
  }

  async function syncFromAI(manual = false) {
    try {
      const response = await fetch(COMMAND_URL + '?t=' + Date.now(), {cache: 'no-store'});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();
      if (!payload.enabled) {
        if (manual) msg('Yana Bridge 2: no active command');
        return;
      }
      const id = String(payload.id || '');
      const last = localStorage.getItem(LAST_ID_KEY) || '';
      if (!manual && id && id === last) return;

      runCommand(payload);
      if (id) localStorage.setItem(LAST_ID_KEY, id);
      msg('Yana Bridge 2: synced');
    } catch (e) {
      if (manual) fail('Yana Bridge 2 sync error', e);
      else console.error('[Yana Bridge 2] Auto-sync failed', e);
    }
  }

  function playNative() {
    try {
      const anim = Animation?.selected || Animation?.all?.[0];
      if (!anim) throw new Error('No native animation exists. Sync the scene first.');
      anim.select?.();
      anim.playing = true;
      if (typeof Animator !== 'undefined') Animator.preview?.();
      if (typeof BarItems !== 'undefined' && BarItems.play_animation) {
        try { BarItems.play_animation.trigger?.(); } catch (_) {}
      }
      msg('Yana Bridge 2: native animation selected — use Animate timeline Play');
    } catch (e) { fail('Play animation', e); }
  }

  function stopNative() {
    try {
      if (Array.isArray(Animation?.all)) Animation.all.forEach(a => a.playing = false);
      if (typeof Timeline !== 'undefined') Timeline.setTime?.(0);
      if (typeof Animator !== 'undefined') Animator.preview?.();
      msg('Yana Bridge 2: stopped at frame 0');
    } catch (e) { fail('Stop animation', e); }
  }

  function openDialog() {
    const dialog = new Dialog({
      id: 'yana_v2_json_dialog',
      title: 'Yana Bridge 2 — JSON',
      form: {
        command: {
          label: 'Command',
          type: 'textarea',
          height: 260,
          value: '{\n  "clear": false,\n  "groups": [],\n  "cubes": [],\n  "animations": []\n}'
        }
      },
      onConfirm(form) {
        try { runCommand(form.command); dialog.hide(); }
        catch (e) { fail('Yana Bridge 2 JSON error', e); }
      }
    });
    dialog.show();
  }

  Plugin.register('yana_ai_bridge', {
    title: 'Yana AI Bridge',
    author: 'Yana + ChatGPT',
    description: 'Single iPad/Web bridge that builds Blockbench scenes and real editable native animations.',
    icon: 'hub',
    version: '2.0.0',
    variant: 'both',

    onload() {
      const sync = new Action('yana_v2_sync', {name: 'Yana 2: Sync Scene + Animation', icon: 'sync', click: () => syncFromAI(true)});
      const play = new Action('yana_v2_play', {name: 'Yana 2: Select/Play Animation', icon: 'play_arrow', click: playNative});
      const stop = new Action('yana_v2_stop', {name: 'Yana 2: Stop Animation', icon: 'stop', click: stopNative});
      const run = new Action('yana_v2_run', {name: 'Yana 2: Run JSON', icon: 'smart_toy', click: openDialog});
      state.actions = [sync, play, stop, run];

      MenuBar.menus.tools.addAction(sync);
      MenuBar.menus.tools.addAction(play);
      MenuBar.menus.tools.addAction(stop);
      MenuBar.menus.tools.addAction(run);

      state.timer = setInterval(() => syncFromAI(false), 5000);
      setTimeout(() => syncFromAI(false), 1200);
      msg('Yana AI Bridge 2.0 loaded');
    },

    onunload() {
      if (state.timer) clearInterval(state.timer);
      state.actions.forEach(a => { try { a?.delete?.(); } catch (_) {} });
      if (globalThis[STATE_KEY] === state) delete globalThis[STATE_KEY];
    }
  });
})();
