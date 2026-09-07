(function () {
  let runAction;
  let testAction;
  let syncAction;
  let autoTimer;

  const COMMAND_URL = 'https://raw.githubusercontent.com/YKyana/blockbench-ai-bridge/refs/heads/main/command.json';
  const LAST_ID_KEY = 'yana_ai_bridge_last_command_id';

  function msg(text, timeout = 2200) {
    if (Blockbench.showQuickMessage) Blockbench.showQuickMessage(text, timeout);
  }

  function vec3(v, label) {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) {
      throw new Error(label + ' must contain 3 numbers');
    }
  }

  function findElementByName(name) {
    return Outliner.elements.find(el => el && el.name === name);
  }

  function ensureAnimationGroup(element) {
    if (!element) return null;
    if (element.parent && element.parent !== 'root' && element.parent instanceof Group) {
      return element.parent;
    }
    const origin = Array.isArray(element.origin) ? element.origin.slice() : [0,0,0];
    const group = new Group({name: 'ANIM_' + element.name, origin}).init().addTo();
    element.addTo(group).init();
    return group;
  }

  function addAnimations(animationSpecs) {
    if (!Array.isArray(animationSpecs) || !animationSpecs.length) return [];
    const createdAnimations = [];

    animationSpecs.forEach((spec, ai) => {
      const length = Number.isFinite(spec.length) ? spec.length : 4;
      const animation = new Animation({
        name: spec.name || `AI_Loop_${ai + 1}`,
        loop: spec.loop === false ? 'once' : 'loop',
        length
      }).add();

      const tracks = Array.isArray(spec.tracks) ? spec.tracks : [];
      tracks.forEach((track, ti) => {
        const target = findElementByName(track.target);
        if (!target) throw new Error(`Animation target not found: ${track.target}`);

        const group = ensureAnimationGroup(target);
        if (!group) throw new Error(`Could not create animation group for ${track.target}`);

        let animator = animation.animators[group.uuid];
        if (!animator) {
          animator = new BoneAnimator(group.uuid, animation, group.name);
          animation.animators[group.uuid] = animator;
        }

        const channel = track.channel || 'position';
        const keyframes = Array.isArray(track.keyframes) ? track.keyframes : [];
        keyframes.forEach((kf, ki) => {
          const value = kf.value || [0,0,0];
          vec3(value, `animations[${ai}].tracks[${ti}].keyframes[${ki}].value`);
          animator.addKeyframe({
            time: Number.isFinite(kf.time) ? kf.time : 0,
            channel,
            interpolation: kf.interpolation || 'linear',
            data_points: [{x:value[0], y:value[1], z:value[2]}]
          });
        });
      });

      createdAnimations.push(animation);
    });

    if (createdAnimations.length) {
      createdAnimations[0].select();
      if (typeof Timeline !== 'undefined' && Timeline.setTime) Timeline.setTime(0);
    }
    return createdAnimations;
  }

  function runCommand(payload) {
    if (typeof payload === 'string') payload = JSON.parse(payload);
    if (!payload || typeof payload !== 'object') throw new Error('Invalid JSON command');

    const cubes = Array.isArray(payload.cubes) ? payload.cubes : [];
    const animationSpecs = Array.isArray(payload.animations) ? payload.animations : [];

    Undo.initEdit({elements: [], outliner: true, animations: []});
    try {
      if (payload.clear === true && Array.isArray(Outliner.root)) {
        [...Outliner.root].forEach(node => node && node.remove && node.remove());
        if (typeof Animation !== 'undefined' && Array.isArray(Animation.all)) {
          [...Animation.all].forEach(anim => anim && anim.remove && anim.remove(false));
        }
      }

      const created = [];
      cubes.forEach((spec, i) => {
        const from = spec.from || [0,0,0];
        const to = spec.to || [4,4,4];
        vec3(from, `cubes[${i}].from`);
        vec3(to, `cubes[${i}].to`);

        const origin = spec.origin || [
          (from[0]+to[0])/2,
          (from[1]+to[1])/2,
          (from[2]+to[2])/2
        ];
        const rotation = spec.rotation || [0,0,0];
        vec3(origin, `cubes[${i}].origin`);
        vec3(rotation, `cubes[${i}].rotation`);

        const cube = new Cube({
          name: spec.name || `AI_Cube_${i+1}`,
          from,
          to,
          origin,
          rotation,
          autouv: 1,
          box_uv: false
        }).addTo('root').init();

        if (Number.isInteger(spec.color)) cube.color = spec.color;
        created.push(cube);
      });

      const animations = addAnimations(animationSpecs);
      Undo.finishEdit('AI Bridge command');

      if (Canvas.updateView) {
        Canvas.updateView({
          elements: created,
          element_aspects: {geometry:true, transform:true},
          selection: true
        });
      }

      const suffix = animations.length ? ` + ${animations.length} animation(s)` : '';
      msg(`AI Bridge: created ${created.length} object(s)${suffix}`);
    } catch (e) {
      try { Undo.cancelEdit(); } catch (_) {}
      throw e;
    }
  }

  async function syncFromAI(manual = false) {
    try {
      const response = await fetch(COMMAND_URL + '?t=' + Date.now(), {cache: 'no-store'});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();

      if (!payload.enabled) {
        if (manual) msg('AI Bridge: no active command');
        return;
      }

      const commandId = String(payload.id || '');
      const lastId = localStorage.getItem(LAST_ID_KEY) || '';
      if (commandId && commandId === lastId) {
        if (manual) msg('AI Bridge: already synced');
        return;
      }

      runCommand(payload);
      if (commandId) localStorage.setItem(LAST_ID_KEY, commandId);
      msg('AI Bridge: synced from ChatGPT');
    } catch (e) {
      console.error('[Yana AI Bridge] Sync failed:', e);
      if (manual) {
        Blockbench.showMessageBox({title:'AI Bridge sync error', message:String(e.message || e)});
      }
    }
  }

  function openDialog() {
    const dialog = new Dialog({
      id: 'yana_ai_bridge_dialog',
      title: 'AI Bridge',
      form: {
        command: {
          label: 'Paste command JSON',
          type: 'textarea',
          height: 240,
          value: JSON.stringify({
            clear:false,
            cubes:[{name:'Example',from:[-2,0,-2],to:[2,4,2],color:2}],
            animations:[]
          }, null, 2)
        }
      },
      onConfirm(form) {
        try { runCommand(form.command); dialog.hide(); }
        catch (e) { Blockbench.showMessageBox({title:'AI Bridge error',message:String(e.message || e)}); }
      }
    });
    dialog.show();
  }

  Plugin.register('yana_ai_bridge', {
    title: 'Yana AI Bridge',
    author: 'Yana + ChatGPT',
    description: 'Automatic GitHub bridge with loop animation support for Blockbench Web',
    icon: 'hub',
    version: '0.3.0',
    variant: 'both',

    onload() {
      runAction = new Action('yana_ai_bridge_run', {
        name:'AI Bridge: Run Command', icon:'smart_toy', click:openDialog
      });
      testAction = new Action('yana_ai_bridge_test', {
        name:'AI Bridge: Test', icon:'view_in_ar', click:() => runCommand({cubes:[
          {name:'Bridge_A',from:[-8,0,-2],to:[-4,4,2],color:1},
          {name:'Bridge_B',from:[-2,0,-2],to:[2,4,2],color:2},
          {name:'Bridge_C',from:[4,0,-2],to:[8,4,2],color:3}
        ]})
      });
      syncAction = new Action('yana_ai_bridge_sync', {
        name:'AI Bridge: Sync from ChatGPT', icon:'sync', click:() => syncFromAI(true)
      });

      MenuBar.menus.tools.addAction(syncAction);
      MenuBar.menus.tools.addAction(runAction);
      MenuBar.menus.tools.addAction(testAction);

      autoTimer = setInterval(() => syncFromAI(false), 5000);
      setTimeout(() => syncFromAI(false), 1000);
      msg('Yana AI Bridge v0.3 loaded');
    },

    onunload() {
      if (autoTimer) clearInterval(autoTimer);
      if (syncAction) syncAction.delete();
      if (runAction) runAction.delete();
      if (testAction) testAction.delete();
    }
  });
})();
