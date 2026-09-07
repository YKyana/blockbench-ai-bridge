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

  function runCommand(payload) {
    if (typeof payload === 'string') payload = JSON.parse(payload);
    if (!payload || typeof payload !== 'object') throw new Error('Invalid JSON command');

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

      Undo.finishEdit('AI Bridge command');
      if (Canvas.updateView) {
        Canvas.updateView({
          elements: created,
          element_aspects: {geometry:true, transform:true},
          selection: true
        });
      }
      msg(`AI Bridge: created ${created.length} cube(s)`);
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
        Blockbench.showMessageBox({
          title: 'AI Bridge sync error',
          message: String(e.message || e)
        });
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
            cubes:[{name:'Example',from:[-2,0,-2],to:[2,4,2],color:2}]
          }, null, 2)
        }
      },
      onConfirm(form) {
        try {
          runCommand(form.command);
          dialog.hide();
        } catch (e) {
          Blockbench.showMessageBox({
            title:'AI Bridge error',
            message:String(e.message || e)
          });
        }
      }
    });
    dialog.show();
  }

  Plugin.register('yana_ai_bridge', {
    title: 'Yana AI Bridge',
    author: 'Yana + ChatGPT',
    description: 'Automatic GitHub command bridge for Blockbench Web',
    icon: 'hub',
    version: '0.2.0',
    variant: 'both',

    onload() {
      runAction = new Action('yana_ai_bridge_run', {
        name:'AI Bridge: Run Command',
        icon:'smart_toy',
        click:openDialog
      });

      testAction = new Action('yana_ai_bridge_test', {
        name:'AI Bridge: Test',
        icon:'view_in_ar',
        click:() => runCommand({cubes:[
          {name:'Bridge_A',from:[-8,0,-2],to:[-4,4,2],color:1},
          {name:'Bridge_B',from:[-2,0,-2],to:[2,4,2],color:2},
          {name:'Bridge_C',from:[4,0,-2],to:[8,4,2],color:3}
        ]})
      });

      syncAction = new Action('yana_ai_bridge_sync', {
        name:'AI Bridge: Sync from ChatGPT',
        icon:'sync',
        click:() => syncFromAI(true)
      });

      MenuBar.menus.tools.addAction(syncAction);
      MenuBar.menus.tools.addAction(runAction);
      MenuBar.menus.tools.addAction(testAction);

      autoTimer = setInterval(() => syncFromAI(false), 5000);
      setTimeout(() => syncFromAI(false), 1000);
      msg('Yana AI Bridge v0.2 loaded');
    },

    onunload() {
      if (autoTimer) clearInterval(autoTimer);
      if (syncAction) syncAction.delete();
      if (runAction) runAction.delete();
      if (testAction) testAction.delete();
    }
  });
})();
