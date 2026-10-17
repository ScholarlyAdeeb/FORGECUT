/**
 * ForgeCut macOS — inspector.
 *
 * A macOS inspector: right-aligned labels against left-aligned controls,
 * disclosure groups, tight rows, and a proper empty state when nothing is
 * selected. It reads and writes the SAME clip objects the shared command
 * layer owns and calls the same render/history functions — it invents no
 * editing capability the engine does not already have.
 */
(function () {
    'use strict';

    const Mac = window.MacUI = window.MacUI || {};
    const collapsed = Object.create(null);

    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    };

    function group(title, key, build) {
        const wrap = el('div', 'mac-group');
        const head = el('button', 'mac-group-head');
        head.type = 'button';
        const tw = el('span', 'material-symbols-outlined tw', 'expand_more');
        tw.setAttribute('aria-hidden', 'true');
        head.append(tw, el('span', null, title));
        head.setAttribute('aria-expanded', collapsed[key] ? 'false' : 'true');
        head.addEventListener('click', () => {
            collapsed[key] = !collapsed[key];
            head.setAttribute('aria-expanded', collapsed[key] ? 'false' : 'true');
        });
        const body = el('div', 'mac-group-body');
        build(body);
        wrap.append(head, body);
        return wrap;
    }

    function field(label, control, valueEl) {
        const row = el('div', 'mac-field');
        const l = el('label', null, label);
        const id = 'insp-' + Math.random().toString(36).slice(2, 8);
        control.id = id;
        l.htmlFor = id;
        if (valueEl) {
            const holder = el('div', 'mac-row2');
            holder.append(control, valueEl);
            row.append(l, holder);
        } else {
            row.append(l, control);
        }
        return row;
    }

    /**
     * Finish an edit: repaint. The undo entry is recorded by
     * wireInspectorHistory on the inspector host, which snapshots BEFORE the
     * control's handler runs. (Saving here, after the change, recorded the new
     * value, so the first Undo appeared to do nothing.)
     */
    function commit(label) {
        if (typeof renderCanvasComposition === 'function') renderCanvasComposition();
        if (window.MacUI.timeline) window.MacUI.timeline.invalidate();
    }

    function numberField(label, get, set, opts) {
        opts = opts || {};
        const input = el('input', 'mac-input');
        input.type = 'number';
        if (opts.step) input.step = opts.step;
        input.value = get();
        input.addEventListener('change', () => {
            const v = parseFloat(input.value);
            if (!isFinite(v)) { input.value = get(); return; }
            set(v);
            commit('Edit ' + label);
        });
        return field(label, input);
    }

    function rangeField(label, get, set, min, max, fmt) {
        const input = el('input', 'mac-range');
        input.type = 'range';
        input.min = min; input.max = max;
        input.value = get();
        const val = el('span', 'val', fmt(get()));
        input.addEventListener('input', () => {
            val.textContent = fmt(+input.value);
            set(+input.value);
            if (typeof renderCanvasComposition === 'function') renderCanvasComposition();
        });
        input.addEventListener('change', () => commit('Edit ' + label));
        return field(label, input, val);
    }

    function trackOf(clip) {
        return (window.state && state.tracks || []).find(t => t.clips.includes(clip)) || null;
    }

    Mac.renderInspector = function () {
        const host = document.getElementById('macInspector');
        if (!host) return;
        if (window.wireInspectorHistory) {
            window.wireInspectorHistory(host, (t) => {
                const l = t.id && host.querySelector(`label[for="${t.id}"]`);
                return 'Edit ' + (l && l.textContent ? l.textContent : 'Property');
            });
        }
        host.replaceChildren();

        const clip = (window.state && state.selectedClipId && typeof findClipById === 'function')
            ? findClipById(state.selectedClipId) : null;

        const head = el('div', 'mac-insp-head');
        if (!clip) {
            head.append(el('div', 'mac-insp-title', 'Inspector'));
            head.append(el('div', 'mac-insp-sub', 'No selection'));
            host.append(head);

            const empty = el('div', 'mac-insp-empty');
            const s = el('span', 'material-symbols-outlined sym', 'tune');
            s.setAttribute('aria-hidden', 'true');
            empty.append(s, el('p', null, 'Select a clip in the timeline to inspect its properties.'));
            host.append(empty);
            return;
        }

        const track = trackOf(clip);
        const kind = track ? track.type : 'clip';
        head.append(el('div', 'mac-insp-title', clip.name || clip.text || 'Clip'));
        head.append(el('div', 'mac-insp-sub',
            `${kind.charAt(0).toUpperCase() + kind.slice(1)} · ${(clip.duration || 0).toFixed(2)}s`));
        host.append(head);

        /* Timing — every clip has it. */
        host.append(group('Timing', 'timing', (b) => {
            b.append(numberField('Start', () => (clip.startTime || 0).toFixed(2),
                v => { clip.startTime = Math.max(0, v); }, { step: '0.1' }));
            b.append(numberField('Duration', () => (clip.duration || 0).toFixed(2),
                v => { clip.duration = Math.max(0.1, v); }, { step: '0.1' }));
            if (clip.trimStart !== undefined) {
                b.append(numberField('Trim In', () => (clip.trimStart || 0).toFixed(2),
                    v => { clip.trimStart = Math.max(0, v); }, { step: '0.1' }));
            }
            const TMp = window.ForgeCut && window.ForgeCut.TimeMap;
            if (TMp && (kind === 'video' || kind === 'audio')) {
                const ramped = !!(clip.keyframes && clip.keyframes.playbackSpeed);
                const sp = rangeField('Speed', () => Math.round((clip.playbackSpeed || 1) * 100),
                    v => window.setClipSpeed(clip.id, v / 100), 25, 400, v => Math.round(v) + '%');
                const spInput = sp.querySelector('input');
                if (ramped && spInput) { spInput.disabled = true; spInput.title = 'Speed follows the ramp'; }
                b.append(sp);
                const ramp = el('select', 'mac-select');
                ramp.dataset.history = 'self';      // applySpeedRamp records its own undo step
                Object.entries(TMp.PRESETS).forEach(([k, p]) => {
                    const o = el('option', null, p.label); o.value = k;
                    if ((clip.speedRamp || 'none') === k) o.selected = true;
                    ramp.append(o);
                });
                ramp.addEventListener('change', () => window.applySpeedRamp(clip.id, ramp.value));
                b.append(field('Ramp', ramp));
            }
        }));

        /* Transform — visual tracks only, matching what the renderer reads. */
        if (kind === 'video' || kind === 'text' || kind === 'image' || kind === 'shape') {
            host.append(group('Transform', 'transform', (b) => {
                b.append(numberField('X', () => Math.round(clip.x || 0), v => { clip.x = v; }));
                b.append(numberField('Y', () => Math.round(clip.y || 0), v => { clip.y = v; }));
                b.append(rangeField('Rotation', () => clip.rotation || 0,
                    v => { clip.rotation = v; }, 0, 360, v => Math.round(v) + '°'));
                if (clip.scale !== undefined) {
                    b.append(rangeField('Scale', () => Math.round((clip.scale || 1) * 100),
                        v => { clip.scale = v / 100; }, 10, 300, v => Math.round(v) + '%'));
                }
                const tracks = window.listMotionTracks ? window.listMotionTracks().filter(m => m.clipId !== clip.id) : [];
                if (tracks.length || clip.pinnedTo) {
                    const pin = el('select', 'mac-select');
                    pin.dataset.history = 'self';    // pinToTrack records its own undo step
                    const first = el('option', null, clip.pinnedTo ? 'Pinned' : 'Pin to Track…'); first.value = '';
                    pin.append(first);
                    tracks.forEach(m => { const o = el('option', null, m.label); o.value = m.ref; if (m.ref === clip.pinnedTo) o.selected = true; pin.append(o); });
                    pin.addEventListener('change', () => { if (pin.value) window.pinToTrack(clip.id, pin.value); });
                    const row = el('div', 'mac-row2');
                    row.append(pin);
                    if (clip.pinnedTo) {
                        const un = el('button', 'mac-btn', 'Unpin'); un.type = 'button';
                        un.addEventListener('click', () => window.unpinClip(clip.id));
                        row.append(un);
                    }
                    b.append(field('Follow', row));
                }
                const align = el('button', 'mac-btn', 'Centre on Canvas');
                align.type = 'button';
                align.addEventListener('click', () => {
                    if (window.positionObject) window.positionObject(clip.id, 'center');
                    Mac.renderInspector();
                });
                b.append(field('Align', align));
            }));

            host.append(group('Appearance', 'appearance', (b) => {
                b.append(rangeField('Opacity', () => Math.round((clip.opacity === undefined ? 1 : clip.opacity) * 100),
                    v => { clip.opacity = v / 100; }, 0, 100, v => Math.round(v) + '%'));
                if (clip.blur !== undefined || kind === 'video' || kind === 'image') {
                    b.append(rangeField('Blur', () => clip.blur || 0,
                        v => { clip.blur = v; }, 0, 50, v => Math.round(v) + ' px'));
                }
                const BL = window.ForgeCut && window.ForgeCut.Effects && window.ForgeCut.Effects.BLEND_LABELS;
                if (BL) {
                    const sel = el('select', 'mac-select');
                    sel.dataset.history = 'self';     // setClipBlendMode records its own undo step
                    Object.entries(BL).forEach(([k, l]) => {
                        const o = el('option', null, l);
                        o.value = k;
                        if ((clip.blendMode || 'normal') === k) o.selected = true;
                        sel.append(o);
                    });
                    sel.addEventListener('change', () => window.setClipBlendMode(clip.id, sel.value));
                    b.append(field('Blend', sel));
                }
            }));
        }

        /* Effects — the shared effect stack, run on the GPU compositor. */
        const FXE = window.ForgeCut && window.ForgeCut.Effects;
        if (FXE && (kind === 'video' || kind === 'image')) {
            host.append(group('Effects', 'fxstack', (b) => {
                const stack = Array.isArray(clip.effects) ? clip.effects : [];
                const iconBtn = (sym, title, onClick, disabled) => {
                    const btn = el('button', 'mac-fx-icon');
                    btn.type = 'button';
                    btn.title = title;
                    btn.setAttribute('aria-label', title);
                    btn.disabled = !!disabled;
                    const s = el('span', 'material-symbols-outlined', sym);
                    s.setAttribute('aria-hidden', 'true');
                    btn.append(s);
                    btn.addEventListener('click', onClick);
                    return btn;
                };
                stack.forEach((fx, i) => {
                    const def = FXE.EFFECTS[fx.type];
                    const card = el('div', 'mac-fx' + (fx.enabled ? '' : ' off'));
                    const top = el('div', 'mac-fx-head');
                    const on = el('input');
                    on.type = 'checkbox';
                    on.dataset.history = 'self';      // fxToggle records its own undo step
                    on.checked = !!fx.enabled;
                    on.disabled = !def;
                    on.setAttribute('aria-label', 'Enable ' + (def ? def.label : fx.type));
                    on.addEventListener('change', () => window.fxToggle(clip.id, fx.id));
                    top.append(on, el('span', 'mac-fx-name', def ? def.label : `Unsupported: ${fx.type}`),
                        iconBtn('arrow_upward', 'Move Up', () => window.fxMove(clip.id, fx.id, -1), i === 0),
                        iconBtn('arrow_downward', 'Move Down', () => window.fxMove(clip.id, fx.id, 1), i === stack.length - 1),
                        iconBtn('delete', 'Remove Effect', () => window.fxRemove(clip.id, fx.id)));
                    card.append(top);
                    if (def) {
                        Object.entries(def.params).forEach(([name, spec]) => {
                            if (spec.kind === 'color') {
                                const c = el('input', 'mac-input');
                                c.type = 'color';
                                c.style.padding = '1px';
                                c.dataset.history = 'self';
                                c.value = fx.params[name];
                                c.addEventListener('change', () => window.fxSetValue(clip.id, fx.id, name, c.value));
                                card.append(field(spec.label, c));
                                return;
                            }
                            if (spec.kind === 'choice' || spec.kind === 'lut') {
                                const sel = el('select', 'mac-select');
                                sel.dataset.history = 'self';
                                const opts = spec.kind === 'choice'
                                    ? spec.options.map(o => ({ id: o, name: o.charAt(0).toUpperCase() + o.slice(1) }))
                                    : [{ id: '', name: window.fxLutOptions().length ? 'Choose a LUT…' : 'No LUTs in project' }].concat(window.fxLutOptions());
                                opts.forEach(o => {
                                    const op = el('option', null, o.name);
                                    op.value = o.id;
                                    if (o.id === fx.params[name]) op.selected = true;
                                    sel.append(op);
                                });
                                sel.addEventListener('change', () => window.fxSetValue(clip.id, fx.id, name, sel.value));
                                if (spec.kind === 'lut') {
                                    const imp = el('button', 'mac-btn', 'Import…');
                                    imp.type = 'button';
                                    imp.title = 'Import a .cube file';
                                    imp.addEventListener('click', () => window.fxImportLut(clip.id, fx.id));
                                    const row = el('div', 'mac-row2');
                                    row.append(sel, imp);
                                    card.append(field(spec.label, row));
                                } else {
                                    card.append(field(spec.label, sel));
                                }
                                return;
                            }
                            const input = el('input', 'mac-range');
                            input.type = 'range';
                            input.dataset.history = 'self';   // fxSetParam commits one step per drag
                            input.min = spec.min; input.max = spec.max; input.step = spec.step;
                            input.value = window.fxValue(clip, fx, name);
                            const val = el('span', 'val', String(Math.round(input.value * 100) / 100));
                            input.addEventListener('input', () => {
                                val.textContent = String(Math.round(input.value * 100) / 100);
                                window.fxSetParam(clip.id, fx.id, name, input.value, 'input');
                            });
                            input.addEventListener('change', () => window.fxSetParam(clip.id, fx.id, name, input.value, 'commit'));
                            const kfOn = window.fxHasKeyframeHere(clip, fx, name);
                            const kfb = iconBtn('change_history', kfOn ? 'Remove Keyframe' : 'Add Keyframe',
                                () => window.fxToggleKeyframe(clip.id, fx.id, name));
                            if (kfOn) kfb.classList.add('on');
                            const ctl = el('div', 'mac-row2');
                            ctl.append(input, val, kfb);
                            card.append(field(spec.label, ctl));
                        });
                    }
                    if (fx.type === 'mask') {
                        const tracked = clip.motionTracks && clip.motionTracks[fx.id];
                        const btn = el('button', 'mac-btn', 'Track Motion');
                        btn.type = 'button';
                        btn.title = 'Follow the region under this mask through the clip';
                        btn.addEventListener('click', () => window.trackMask(clip.id, fx.id));
                        card.append(field(tracked ? `${tracked.points.length} frames` : 'Motion', btn));
                    }
                    b.append(card);
                });
                const add = el('select', 'mac-select');
                add.dataset.history = 'self';
                add.setAttribute('aria-label', 'Add Effect');
                const first = el('option', null, 'Add Effect…');
                first.value = '';
                add.append(first);
                Object.entries(FXE.EFFECTS).forEach(([k, d]) => { const o = el('option', null, d.label); o.value = k; add.append(o); });
                add.addEventListener('change', () => { if (add.value) window.fxAdd(clip.id, add.value); });
                b.append(field(stack.length ? '' : 'None', add));
            }));
        }

        /* Text */
        if (typeof clip.text === 'string') {
            host.append(group('Text', 'text', (b) => {
                const ta = el('input', 'mac-input');
                ta.value = clip.text;
                ta.addEventListener('input', () => {
                    clip.text = ta.value;
                    clip.name = ta.value;
                    if (typeof renderCanvasComposition === 'function') renderCanvasComposition();
                    if (Mac.timeline) Mac.timeline.invalidate();
                });
                ta.addEventListener('change', () => commit('Edit Text'));
                b.append(field('Content', ta));

                if (clip.size !== undefined) {
                    b.append(numberField('Size', () => clip.size || 72, v => { clip.size = Math.max(1, v); }));
                }
                if (clip.color !== undefined) {
                    const c = el('input', 'mac-input');
                    c.type = 'color';
                    c.style.padding = '1px';
                    c.value = clip.color || '#ffffff';
                    c.addEventListener('input', () => {
                        clip.color = c.value;
                        if (typeof renderCanvasComposition === 'function') renderCanvasComposition();
                    });
                    c.addEventListener('change', () => commit('Edit Text Colour'));
                    b.append(field('Colour', c));
                }
            }));
        }

        /* Audio */
        if (kind === 'audio' || clip.volume !== undefined) {
            host.append(group('Audio', 'audio', (b) => {
                b.append(rangeField('Volume', () => Math.round((clip.volume === undefined ? 1 : clip.volume) * 100),
                    v => { clip.volume = v / 100; }, 0, 150, v => Math.round(v) + '%'));
                if (clip.fadeIn !== undefined) {
                    b.append(numberField('Fade In', () => (clip.fadeIn || 0).toFixed(2),
                        v => { clip.fadeIn = Math.max(0, v); }, { step: '0.1' }));
                }
                if (clip.fadeOut !== undefined) {
                    b.append(numberField('Fade Out', () => (clip.fadeOut || 0).toFixed(2),
                        v => { clip.fadeOut = Math.max(0, v); }, { step: '0.1' }));
                }
            }));
        }

        /* Transition — reuses the shared setTransition command. */
        host.append(group('Transition', 'transition', (b) => {
            const sel = el('select', 'mac-select');
            // 'Morph' is deliberately absent: TransitionEngine has no case for
            // it, so choosing it silently produced a hard cut. Zoom and
            // Dip To Black are engine transitions that had no UI before.
            ['None', 'Fade', 'Dissolve', 'Push', 'Wipe', 'Split', 'Reveal', 'Zoom', 'Dip To Black', 'Cut'].forEach(n => {
                const o = el('option', null, n);
                o.value = n;
                if ((clip.transition || 'None') === n) o.selected = true;
                sel.appendChild(o);
            });
            sel.dataset.history = 'self';     // setTransition records its own undo step
            sel.addEventListener('change', () => {
                if (typeof setTransition === 'function') setTransition(sel.value);
                else { clip.transition = sel.value; commit('Set Transition'); }
            });
            b.append(field('Style', sel));
            b.append(numberField('Duration', () => (clip.transitionDuration || 1.5).toFixed(2),
                v => { clip.transitionDuration = Math.max(0.1, v); }, { step: '0.1' }));
        }));

        /* Animation — same three channels the shared engine supports. */
        host.append(group('Animation', 'animation', (b) => {
            const anims = clip.animations || {};
            const mk = (label, channel, options) => {
                const sel = el('select', 'mac-select');
                options.forEach(n => {
                    const o = el('option', null, n);
                    o.value = n;
                    if ((anims[channel] || 'None') === n) o.selected = true;
                    sel.appendChild(o);
                });
                sel.addEventListener('change', () => {
                    if (typeof setAnimation === 'function') setAnimation(channel, sel.value);
                });
                b.append(field(label, sel));
            };
            mk('Entrance', 'entrance', ['None', 'Fade', 'Slide', 'Zoom']);
            mk('Exit', 'exit', ['None', 'Fade', 'Slide']);
            mk('Emphasis', 'emphasis', ['None', 'Pulse', 'Rotate', 'Scale']);
        }));
    };
})();
