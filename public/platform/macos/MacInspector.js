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

    /** Commit a change the same way the shared layer does. */
    function commit(label) {
        if (typeof saveStateToHistory === 'function') saveStateToHistory(label);
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
            ['None', 'Fade', 'Dissolve', 'Push', 'Wipe', 'Morph', 'Split', 'Reveal', 'Cut'].forEach(n => {
                const o = el('option', null, n);
                o.value = n;
                if ((clip.transition || 'None') === n) o.selected = true;
                sel.appendChild(o);
            });
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
