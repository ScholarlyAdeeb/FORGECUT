/**
 * ForgeCut editor — Property inspector panel
 *
 * Split out of the original editor.js. These files are plain classic
 * scripts sharing one global scope and MUST be loaded in the order listed
 * in index.html; the concatenation is byte-identical to the original file.
 */
function updateInspector() {
    if (!state.selectedClipId) {
        inspectorSection.innerHTML = '<div style="color: var(--text-muted); font-size:0.8rem; text-align:center;">Select a clip to edit properties</div>';
        return;
    }

    const clip = findClipById(state.selectedClipId);
    if (!clip) return;

    const track = state.tracks.find(t => t.clips.includes(clip));
    if (!track) return;

    // Sync Ribbon Transition Controls
    const transitionDurationInput = document.getElementById('transitionDurationInput');
    if (transitionDurationInput) {
        transitionDurationInput.value = (clip.transitionDuration !== undefined ? clip.transitionDuration : 1.5).toFixed(2);
    }
    const transitionSoundSelect = document.getElementById('transitionSoundSelect');
    if (transitionSoundSelect) {
        transitionSoundSelect.value = clip.transitionSound || 'none';
    }

    // Sync Ribbon Animation Controls
    const animDelayInput = document.getElementById('animationDelayInput');
    if (animDelayInput) {
        animDelayInput.value = `${(clip.animations && clip.animations.delay !== undefined ? parseFloat(clip.animations.delay) : 0).toFixed(2)}s`;
    }
    const animDurationInput = document.getElementById('animationDurationInput');
    if (animDurationInput) {
        animDurationInput.value = `${(clip.animations && clip.animations.duration !== undefined ? parseFloat(clip.animations.duration) : 0.5).toFixed(2)}s`;
    }

    const kf = (prop) => {
        const localTime = state.currentTime - clip.startTime;
        const hasKf = clip.keyframes && clip.keyframes[prop] && clip.keyframes[prop].some(kf => Math.abs(kf.time - localTime) < 0.15);
        return `<span class="material-symbols-outlined text-[14px] cursor-pointer ${hasKf ? 'text-blue-500 font-bold' : 'text-white/40'} hover:text-blue-500 mr-1 select-none align-middle" onclick="window.toggleKeyframe('${clip.id}', '${prop}')" title="Toggle Keyframe">change_history</span>`;
    };

    const renderSection = (title, id, contentHtml) => {
        if (!state.inspectorCollapsed) state.inspectorCollapsed = {};
        const isCollapsed = state.inspectorCollapsed[id] || false;
        return `
            <div class="fluent-section border border-outline-variant/30 rounded mb-2 overflow-hidden bg-surface-container-low">
                <div class="fluent-section-header px-3 py-1.5 bg-surface-container-high flex items-center justify-between cursor-pointer select-none font-bold text-xs" onclick="window.toggleInspectorSection('${id}')">
                    <span class="text-on-surface">${title}</span>
                    <span class="material-symbols-outlined text-xs text-on-surface-variant" id="chevron-${id}">${isCollapsed ? 'chevron_right' : 'expand_more'}</span>
                </div>
                <div class="fluent-section-content p-3 flex flex-col gap-2 ${isCollapsed ? 'hidden' : ''}" id="sec-${id}">
                    ${contentHtml}
                </div>
            </div>
        `;
    };

    let transformHtml = '';
    let appearanceHtml = '';
    let textHtml = '';
    let audioHtml = '';
    let animationHtml = '';
    let effectsHtml = '';

    // Transform properties
    if (track.type === 'video' || track.type === 'text' || track.type === 'image' || track.type === 'shape') {
        transformHtml = `
            <div class="control-group">
                <label>${kf('x')} Position X (px)</label>
                <input type="number" id="insp_x" value="${Math.round(clip.x !== undefined ? clip.x : canvas.width / 2)}">
            </div>
            <div class="control-group">
                <label>${kf('y')} Position Y (px)</label>
                <input type="number" id="insp_y" value="${Math.round(clip.y !== undefined ? clip.y : canvas.height / 2)}">
            </div>
            <div class="control-group mt-1">
                <label>Quick Positioning</label>
                <div class="grid grid-cols-3 gap-1 mt-1">
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'top-left')" title="Top Left"><span class="material-symbols-outlined text-sm">north_west</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'top-center')" title="Top Center"><span class="material-symbols-outlined text-sm">north</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'top-right')" title="Top Right"><span class="material-symbols-outlined text-sm">north_east</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'mid-left')" title="Middle Left"><span class="material-symbols-outlined text-sm">west</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'center')" title="Center Canvas"><span class="material-symbols-outlined text-sm">filter_center_focus</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'mid-right')" title="Middle Right"><span class="material-symbols-outlined text-sm">east</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'bot-left')" title="Bottom Left"><span class="material-symbols-outlined text-sm">south_west</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'bot-center')" title="Bottom Center"><span class="material-symbols-outlined text-sm">south</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'bot-right')" title="Bottom Right"><span class="material-symbols-outlined text-sm">south_east</span></button>
                </div>
            </div>
            <div class="control-group">
                <label>${kf('rotation')} Rotation (deg)</label>
                <input type="range" id="insp_rot" min="0" max="360" value="${clip.rotation || 0}">
            </div>
        `;
    }

    // Appearance properties
    if (track.type === 'video' || track.type === 'text' || track.type === 'image' || track.type === 'shape') {
        appearanceHtml = `
            <div class="control-group">
                <label>${kf('opacity')} Opacity</label>
                <input type="range" id="insp_opacity" min="0" max="100" value="${Math.round((clip.opacity !== undefined ? clip.opacity : 1.0) * 100)}">
            </div>
        `;

        if (track.type === 'video' || track.type === 'image') {
            appearanceHtml += `
                <div class="control-group">
                    <label>${kf('scale')} Scale</label>
                    <input type="range" id="insp_scale" min="10" max="300" value="${Math.round((clip.scale || 1.0) * 100)}">
                </div>
                <div class="control-group">
                    <label>${kf('blur')} Blur (px)</label>
                    <input type="range" id="insp_blur" min="0" max="50" value="${clip.blur || 0}">
                </div>
                <div class="control-group">
                    <label>${kf('brightness')} Brightness</label>
                    <input type="range" id="insp_brightness" min="0" max="300" value="${Math.round((clip.brightness !== undefined ? clip.brightness : 1.0) * 100)}">
                </div>
                <div class="control-group">
                    <label>${kf('contrast')} Contrast</label>
                    <input type="range" id="insp_contrast" min="0" max="300" value="${Math.round((clip.contrast !== undefined ? clip.contrast : 1.0) * 100)}">
                </div>
                <div class="control-group">
                    <label>${kf('saturation')} Saturation</label>
                    <input type="range" id="insp_saturation" min="0" max="300" value="${Math.round((clip.saturation !== undefined ? clip.saturation : 1.0) * 100)}">
                </div>
                <div class="control-group">
                    <label>${kf('hue')} Hue (deg)</label>
                    <input type="range" id="insp_hue" min="0" max="360" value="${clip.hue || 0}">
                </div>
                <div class="control-group">
                    <label>${kf('playbackSpeed')} Playback Speed</label>
                    <input type="range" id="insp_playback_speed" min="25" max="400" value="${Math.round((clip.playbackSpeed || 1.0) * 100)}">
                </div>
            `;
        }

        const compatibleTracks = state.tracks.filter(t => t.type === track.type);
        if (compatibleTracks.length > 1) {
            appearanceHtml += `
                <div class="control-group">
                    <label>Layer (Track)</label>
                    <select id="insp_track" onchange="moveClipToTrack('${clip.id}', this.value)" class="w-full bg-[#1e1e2e] border border-white/10 rounded p-1 text-xs text-white">
                        ${compatibleTracks.map(t => `<option value="${t.id}" ${t.id === track.id ? 'selected' : ''}>${t.name}</option>`).join('')}
                    </select>
                </div>
            `;
        }
    }

    // Text specific properties
    if (track.type === 'text') {
        const availableFonts = window.ForgeCut && window.ForgeCut.TextRenderer ? window.ForgeCut.TextRenderer.getAvailableFonts() : ['Arial', 'Helvetica'];
        textHtml = `
            <div class="control-group">
                <label>Text Value</label>
                <input type="text" id="insp_text" value="${esc(clip.text || '')}">
            </div>
            <div class="control-group">
                <label>Font Family</label>
                <div class="flex gap-2">
                    <select id="insp_font" class="flex-1 bg-[#1e1e2e] border border-white/10 rounded p-1 text-xs text-white" style="font-size: 14px;">
                        ${availableFonts.map(f => `<option value="${f}" style="font-family: '${f}';" ${clip.font === f ? 'selected' : ''}>${f}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="control-group">
                <label>${kf('size')} Font Size (px)</label>
                <input type="number" id="insp_size" min="10" value="${clip.size || 72}">
            </div>
            <div class="control-group">
                <label>Formatting</label>
                <div class="flex gap-2">
                    <button class="flex-1 py-1 rounded text-xs border ${clip.fontWeight === 'bold' ? 'bg-primary text-on-primary border-primary' : 'bg-transparent border-outline-variant/50 text-on-surface-variant'}" onclick="toggleTextWeight('${clip.id}')"><b>B</b></button>
                    <button class="flex-1 py-1 rounded text-xs border ${clip.italic ? 'bg-primary text-on-primary border-primary' : 'bg-transparent border-outline-variant/50 text-on-surface-variant'}" onclick="toggleTextItalic('${clip.id}')"><i>I</i></button>
                    <button class="flex-1 py-1 rounded text-xs border ${clip.underline ? 'bg-primary text-on-primary border-primary' : 'bg-transparent border-outline-variant/50 text-on-surface-variant'}" onclick="toggleTextUnderline('${clip.id}')"><u>U</u></button>
                </div>
            </div>
            <div class="control-group">
                <label>Text Alignment</label>
                <div class="flex gap-2 mb-1">
                    <button class="flex-1 py-1 rounded text-xs border bg-surface-container border-none cursor-pointer text-on-surface hover:bg-surface-container-high" onclick="window.alignText('${clip.id}', 'left')">Left</button>
                    <button class="flex-1 py-1 rounded text-xs border bg-surface-container border-none cursor-pointer text-on-surface hover:bg-surface-container-high" onclick="window.alignText('${clip.id}', 'center')">Center</button>
                    <button class="flex-1 py-1 rounded text-xs border bg-surface-container border-none cursor-pointer text-on-surface hover:bg-surface-container-high" onclick="window.alignText('${clip.id}', 'right')">Right</button>
                </div>
            </div>
            <div class="control-group">
                <label>Color Mode</label>
                <select id="insp_color_mode" onchange="changeTextColorMode('${clip.id}', this.value)" class="w-full bg-[#1e1e2e] border border-white/10 rounded p-1 text-xs text-white">
                    <option value="solid" ${clip.colorType !== 'gradient' ? 'selected' : ''}>Solid Color</option>
                    <option value="gradient" ${clip.colorType === 'gradient' ? 'selected' : ''}>Gradient Fill</option>
                </select>
            </div>
            <div class="control-group" id="solid_color_group" style="${clip.colorType === 'gradient' ? 'display: none;' : ''}">
                <label>Text Color</label>
                <input type="color" id="insp_color" value="${clip.color || '#ffffff'}" class="w-full h-8 cursor-pointer rounded">
            </div>
            <div class="control-group" id="gradient_color_group" style="${clip.colorType !== 'gradient' ? 'display: none;' : ''}">
                <label>Gradient Colors</label>
                <div class="flex gap-2">
                    <input type="color" id="insp_grad_start" value="${clip.gradientStartColor || '#ff007f'}" class="flex-1 h-8 cursor-pointer rounded" title="Gradient Start">
                    <input type="color" id="insp_grad_end" value="${clip.gradientEndColor || '#7f00ff'}" class="flex-1 h-8 cursor-pointer rounded" title="Gradient End">
                </div>
            </div>
            <div class="control-group">
                <div class="flex justify-between text-[11px] mb-1">
                    <label>${kf('letterSpacing')} Letter Spacing (px)</label>
                    <span class="text-white/70 font-medium">${clip.letterSpacing || 0}px</span>
                </div>
                <input type="range" id="insp_letter_spacing" min="-10" max="50" value="${clip.letterSpacing || 0}" class="w-full">
            </div>
            <div class="control-group">
                <div class="flex justify-between text-[11px] mb-1">
                    <label>${kf('lineHeight')} Line Spacing</label>
                    <span class="text-white/70 font-medium">${clip.lineHeight || 1.3}</span>
                </div>
                <input type="range" id="insp_line_height" min="80" max="250" value="${Math.round((clip.lineHeight || 1.3) * 100)}" class="w-full">
            </div>
            <div class="control-group border-t border-white/10 pt-2 mt-2">
                <label class="font-semibold text-xs text-indigo-400">Stroke / Outline</label>
                <div class="flex gap-2 items-center mt-1">
                    <input type="color" id="insp_stroke_color" value="${clip.strokeColor || '#000000'}" class="w-8 h-8 cursor-pointer rounded">
                    <div class="flex-1">
                        <div class="flex justify-between text-[10px] text-white/70">
                            <span>${kf('textStrokeWidth')} Stroke Width</span>
                            <span>${clip.textStrokeWidth || 0}px</span>
                        </div>
                        <input type="range" id="insp_stroke_width" min="0" max="20" value="${clip.textStrokeWidth || 0}" class="w-full">
                    </div>
                </div>
            </div>
            <div class="control-group border-t border-white/10 pt-2 mt-2">
                <label class="font-semibold text-xs text-indigo-400">Text Shadow</label>
                <div class="flex flex-col gap-2 mt-1">
                    <div class="flex gap-2 items-center">
                        <label class="text-[10px] w-24">Shadow Color</label>
                        <input type="color" id="insp_shadow_color" value="${clip.shadowColor || '#000000'}" class="w-full h-6 cursor-pointer rounded">
                    </div>
                    <div>
                        <div class="flex justify-between text-[10px] text-white/70">
                            <span>${kf('shadowBlur')} Shadow Blur</span>
                            <span>${clip.shadowBlur !== undefined ? clip.shadowBlur : 12}px</span>
                        </div>
                        <input type="range" id="insp_shadow_blur" min="0" max="30" value="${clip.shadowBlur !== undefined ? clip.shadowBlur : 12}" class="w-full">
                    </div>
                    <div>
                        <div class="flex justify-between text-[10px] text-white/70">
                            <span>${kf('shadowOffsetX')} Offset X</span>
                            <span>${clip.shadowOffsetX !== undefined ? clip.shadowOffsetX : 0}px</span>
                        </div>
                        <input type="range" id="insp_shadow_offsetx" min="-20" max="20" value="${clip.shadowOffsetX !== undefined ? clip.shadowOffsetX : 0}" class="w-full">
                    </div>
                    <div>
                        <div class="flex justify-between text-[10px] text-white/70">
                            <span>${kf('shadowOffsetY')} Offset Y</span>
                            <span>${clip.shadowOffsetY !== undefined ? clip.shadowOffsetY : 4}px</span>
                        </div>
                        <input type="range" id="insp_shadow_offsety" min="-20" max="20" value="${clip.shadowOffsetY !== undefined ? clip.shadowOffsetY : 4}" class="w-full">
                    </div>
                </div>
            </div>
        `;
    }

    // Audio properties
    if (track.type === 'audio') {
        const isVoice = clip.isVoice || false;
        const duckAmount = clip.duckAmount !== undefined ? clip.duckAmount : 0.7;
        const censorBeepsCount = clip.censorBeeps ? clip.censorBeeps.length : 0;
        audioHtml = `
            <div class="control-group">
                <label>${kf('volume')} Volume</label>
                <div class="flex items-center gap-2">
                    <input type="range" id="insp_volume" min="0" max="200" value="${Math.round((clip.volume !== undefined ? clip.volume : 1.0) * 100)}" class="flex-1">
                    <span class="text-xs w-8 text-right">${Math.round((clip.volume !== undefined ? clip.volume : 1.0) * 100)}%</span>
                </div>
            </div>
            <div class="control-group">
                <label>${kf('gain')} Gain (dB)</label>
                <input type="range" id="insp_gain" min="0" max="300" value="${Math.round((clip.gain !== undefined ? clip.gain : 1.0) * 100)}">
            </div>
            <div class="control-group">
                <label>${kf('fadeIn')} Fade In (sec)</label>
                <input type="number" id="insp_fadein" step="0.1" min="0" value="${clip.fadeIn || 0}">
            </div>
            <div class="control-group">
                <label>${kf('fadeOut')} Fade Out (sec)</label>
                <input type="number" id="insp_fadeout" step="0.1" min="0" value="${clip.fadeOut || 0}">
            </div>
            <div class="control-group">
                <label>${kf('balance')} Balance (Panning)</label>
                <input type="range" id="insp_balance" min="-100" max="100" value="${Math.round((clip.balance !== undefined ? clip.balance : 0) * 100)}">
            </div>
            <div class="control-group flex items-center gap-2 mt-2">
                <input type="checkbox" id="insp_normalize" ${clip.normalize ? 'checked' : ''} onchange="window.toggleClipNormalize('${clip.id}', this.checked)">
                <label for="insp_normalize" class="text-xs font-semibold">Normalize Volume</label>
            </div>
            <div class="control-group border-t border-white/10 pt-2 mt-2">
                <label class="flex items-center gap-2">
                    <input type="checkbox" id="insp_isvoice" ${isVoice ? 'checked' : ''} onchange="toggleClipVoice('${clip.id}', this.checked)">
                    <span class="font-medium text-xs">Is Voice / Dialogue Clip</span>
                </label>
            </div>
            <div class="control-group">
                <label>Ducking Intensity (Music only)</label>
                <div class="flex items-center gap-2">
                    <input type="range" id="insp_duckamount" min="0" max="100" value="${Math.round(duckAmount * 100)}" class="flex-1" oninput="changeClipDuckAmount('${clip.id}', this.value)">
                    <span class="text-xs w-8 text-right">${Math.round(duckAmount * 100)}%</span>
                </div>
            </div>
            <div class="control-group border-t border-white/10 pt-2 mt-2">
                <label class="font-semibold text-xs">Censor Beeps (${censorBeepsCount})</label>
                <button class="w-full py-1 bg-[#4CAF50] text-white rounded text-xs mt-1 border-none cursor-pointer" onclick="addCensorBeepAtPlayhead('${clip.id}')">+ Add Censor Beep at Playhead</button>
                ${censorBeepsCount > 0 ? `
                <div class="max-h-24 overflow-y-auto bg-[#1e1e2e] p-1 rounded mt-1 text-xs flex flex-col gap-1">
                    ${clip.censorBeeps.map((beep, idx) => `
                        <div class="flex justify-between items-center bg-[#2d2d3e] p-1 rounded">
                            <span>Start: ${beep.startTime.toFixed(2)}s | Duration: ${beep.duration.toFixed(1)}s</span>
                            <span class="material-symbols-outlined text-xs cursor-pointer text-red-500 hover:text-red-700" onclick="deleteCensorBeep('${clip.id}', ${idx})">delete</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''}
            </div>
        `;
    }

    // Effects properties
    if (track.type === 'video' || track.type === 'image') {
        const asset = (window.ForgeCut && window.ForgeCut.MediaEngine)
            ? window.ForgeCut.MediaEngine.getAsset(clip.assetId)
            : assetCache.get(clip.assetId);
        const assetW = asset ? (asset.width || 1920) : 1920;
        const assetH = asset ? (asset.height || 1080) : 1080;
        effectsHtml = `
            <div class="flex flex-col gap-2">
                <div>
                    <div class="flex justify-between text-[10px] text-white/70 mb-0.5">
                        <span>${kf('cropX')} Crop X</span>
                        <span>${clip.cropX !== undefined ? clip.cropX : 0}px</span>
                    </div>
                    <input type="range" id="insp_cropx" min="0" max="${assetW}" value="${clip.cropX !== undefined ? clip.cropX : 0}" class="w-full">
                </div>
                <div>
                    <div class="flex justify-between text-[10px] text-white/70 mb-0.5">
                        <span>${kf('cropY')} Crop Y</span>
                        <span>${clip.cropY !== undefined ? clip.cropY : 0}px</span>
                    </div>
                    <input type="range" id="insp_cropy" min="0" max="${assetH}" value="${clip.cropY !== undefined ? clip.cropY : 0}" class="w-full">
                </div>
                <div>
                    <div class="flex justify-between text-[10px] text-white/70 mb-0.5">
                        <span>${kf('cropW')} Crop Width</span>
                        <span>${clip.cropW !== undefined ? clip.cropW : assetW}px</span>
                    </div>
                    <input type="range" id="insp_cropw" min="50" max="${assetW}" value="${clip.cropW !== undefined ? clip.cropW : assetW}" class="w-full">
                </div>
                <div>
                    <div class="flex justify-between text-[10px] text-white/70 mb-0.5">
                        <span>${kf('cropH')} Crop Height</span>
                        <span>${clip.cropH !== undefined ? clip.cropH : assetH}px</span>
                    </div>
                    <input type="range" id="insp_croph" min="50" max="${assetH}" value="${clip.cropH !== undefined ? clip.cropH : assetH}" class="w-full">
                </div>
            </div>
        `;
    } else if (track.type === 'shape') {
        const props = clip.shapeProps || {};
        effectsHtml = `
            <div class="control-group">
                <div class="flex justify-between text-[11px] mb-1">
                    <label>${kf('shapeWidth')} Width (px)</label>
                    <span class="text-white/70 font-medium">${clip.shapeWidth || 200}px</span>
                </div>
                <input type="range" id="insp_shape_width" min="10" max="800" value="${clip.shapeWidth || 200}" class="w-full">
            </div>
            <div class="control-group">
                <div class="flex justify-between text-[11px] mb-1">
                    <label>${kf('shapeHeight')} Height (px)</label>
                    <span class="text-white/70 font-medium">${clip.shapeHeight || 150}px</span>
                </div>
                <input type="range" id="insp_shape_height" min="10" max="800" value="${clip.shapeHeight || 150}" class="w-full">
            </div>
            <div class="control-group">
                <div class="flex justify-between text-[11px] mb-1">
                    <label>${kf('cornerRadius')} Corner Radius</label>
                    <span class="text-white/70 font-medium">${props.cornerRadius || 0}px</span>
                </div>
                <input type="range" id="insp_shape_corner_radius" min="0" max="100" value="${props.cornerRadius || 0}" class="w-full">
            </div>
            <div class="control-group border-t border-white/10 pt-2 mt-2">
                <label class="font-semibold text-xs text-indigo-400">Fill Settings</label>
                <div class="flex flex-col gap-2 mt-1">
                    <div>
                        <label class="text-[10px]">Fill Mode</label>
                        <select id="insp_shape_fill_type" class="w-full bg-[#1e1e2e] border border-white/10 rounded p-1 text-xs text-white" onchange="changeShapeFillType('${clip.id}', this.value)">
                            <option value="solid" ${props.fillType === 'solid' ? 'selected' : ''}>Solid Color</option>
                            <option value="gradient" ${props.fillType === 'gradient' ? 'selected' : ''}>Gradient Fill</option>
                            <option value="pattern" ${props.fillType === 'pattern' ? 'selected' : ''}>Pattern Fill</option>
                            <option value="image" ${props.fillType === 'image' ? 'selected' : ''}>Image Fill</option>
                        </select>
                    </div>
                    <div id="shape_solid_fill_group" style="${props.fillType !== 'solid' && props.fillType !== undefined ? 'display:none;' : ''}">
                        <label>Color</label>
                        <input type="color" id="insp_shape_fill" value="${props.fill || '#ffc107'}" class="w-full h-8 cursor-pointer rounded">
                    </div>
                    <div id="shape_gradient_fill_group" style="${props.fillType !== 'gradient' ? 'display:none;' : ''}" class="flex gap-2">
                        <div class="flex-1">
                            <label class="text-[10px]">Start</label>
                            <input type="color" id="insp_shape_grad_start" value="${props.gradientStartColor || '#ffc107'}" class="w-full h-8 cursor-pointer rounded">
                        </div>
                        <div class="flex-1">
                            <label class="text-[10px]">End</label>
                            <input type="color" id="insp_shape_grad_end" value="${props.gradientEndColor || '#ff5722'}" class="w-full h-8 cursor-pointer rounded">
                        </div>
                    </div>
                </div>
            </div>
            <div class="control-group border-t border-white/10 pt-2 mt-2">
                <label class="font-semibold text-xs text-indigo-400">Outline & Shadow</label>
                <div class="flex gap-2 items-center mt-1">
                    <input type="color" id="insp_shape_stroke" value="${props.stroke || '#ffffff'}" class="w-8 h-8 cursor-pointer rounded">
                    <div class="flex-1">
                        <div class="flex justify-between text-[10px] text-white/70">
                            <span>${kf('strokeWidth')} Outline Width</span>
                            <span>${props.strokeWidth || 0}px</span>
                        </div>
                        <input type="range" id="insp_shape_stroke_width" min="0" max="30" value="${props.strokeWidth || 0}" class="w-full">
                    </div>
                </div>
                <div class="mt-2">
                    <div class="flex justify-between text-[10px] text-white/70">
                        <span>${kf('blur')} Shadow Blur</span>
                        <span>${props.blur || 0}px</span>
                    </div>
                    <input type="range" id="insp_shape_blur" min="0" max="100" value="${props.blur || 0}" class="w-full">
                </div>
            </div>
        `;
    }

    // Animation properties
    if (track.type === 'video' || track.type === 'text' || track.type === 'image' || track.type === 'shape') {
        const anims = clip.animations || { duration: 0.5, delay: 0, easing: 'easeInOut', entrance: 'None', exit: 'None', emphasis: 'None' };
        animationHtml = `
            <div class="flex flex-col gap-2">
                <div class="flex gap-2 items-center">
                    <label class="text-[10px] w-12 text-on-surface-variant">Entrance</label>
                    <select id="insp_anim_entrance" class="flex-1 bg-surface-container border border-outline-variant/30 rounded p-1 text-xs" onchange="changeClipAnimation('${clip.id}', 'entrance', this.value)">
                        <option value="None" ${anims.entrance === 'None' || !anims.entrance ? 'selected' : ''}>None</option>
                        <option value="Fade In" ${anims.entrance === 'Fade In' ? 'selected' : ''}>Fade In</option>
                        <option value="Slide Left" ${anims.entrance === 'Slide Left' ? 'selected' : ''}>Slide Left</option>
                        <option value="Slide Right" ${anims.entrance === 'Slide Right' ? 'selected' : ''}>Slide Right</option>
                        <option value="Zoom In" ${anims.entrance === 'Zoom In' ? 'selected' : ''}>Zoom In</option>
                    </select>
                </div>
                <div class="flex gap-2 items-center">
                    <label class="text-[10px] w-12 text-on-surface-variant">Exit</label>
                    <select id="insp_anim_exit" class="flex-1 bg-surface-container border border-outline-variant/30 rounded p-1 text-xs" onchange="changeClipAnimation('${clip.id}', 'exit', this.value)">
                        <option value="None" ${anims.exit === 'None' || !anims.exit ? 'selected' : ''}>None</option>
                        <option value="Fade Out" ${anims.exit === 'Fade Out' ? 'selected' : ''}>Fade Out</option>
                        <option value="Slide Left" ${anims.exit === 'Slide Left' ? 'selected' : ''}>Slide Left</option>
                        <option value="Slide Right" ${anims.exit === 'Slide Right' ? 'selected' : ''}>Slide Right</option>
                        <option value="Zoom Out" ${anims.exit === 'Zoom Out' ? 'selected' : ''}>Zoom Out</option>
                    </select>
                </div>
                <div class="flex gap-2 items-center">
                    <label class="text-[10px] w-12 text-on-surface-variant">Emphasis</label>
                    <select id="insp_anim_emphasis" class="flex-1 bg-surface-container border border-outline-variant/30 rounded p-1 text-xs" onchange="changeClipAnimation('${clip.id}', 'emphasis', this.value)">
                        <option value="None" ${anims.emphasis === 'None' || !anims.emphasis ? 'selected' : ''}>None</option>
                        <option value="Scale" ${anims.emphasis === 'Scale' ? 'selected' : ''}>Scale</option>
                        <option value="Rotate" ${anims.emphasis === 'Rotate' ? 'selected' : ''}>Rotate</option>
                        <option value="Opacity" ${anims.emphasis === 'Opacity' ? 'selected' : ''}>Opacity</option>
                    </select>
                </div>
                <div class="flex gap-2 items-center">
                    <label class="text-[10px] w-12 text-on-surface-variant">Easing</label>
                    <select id="insp_anim_easing" class="flex-1 bg-surface-container border border-outline-variant/30 rounded p-1 text-xs" onchange="changeClipAnimation('${clip.id}', 'easing', this.value)">
                        <option value="linear" ${anims.easing === 'linear' ? 'selected' : ''}>linear</option>
                        <option value="easeIn" ${anims.easing === 'easeIn' ? 'selected' : ''}>easeIn</option>
                        <option value="easeOut" ${anims.easing === 'easeOut' ? 'selected' : ''}>easeOut</option>
                        <option value="easeInOut" ${anims.easing === 'easeInOut' || !anims.easing ? 'selected' : ''}>easeInOut</option>
                        <option value="easeInQuad" ${anims.easing === 'easeInQuad' ? 'selected' : ''}>easeInQuad</option>
                        <option value="easeOutQuad" ${anims.easing === 'easeOutQuad' ? 'selected' : ''}>easeOutQuad</option>
                        <option value="easeInOutQuad" ${anims.easing === 'easeInOutQuad' ? 'selected' : ''}>easeInOutQuad</option>
                        <option value="easeOutBack" ${anims.easing === 'easeOutBack' ? 'selected' : ''}>easeOutBack</option>
                        <option value="easeOutElastic" ${anims.easing === 'easeOutElastic' ? 'selected' : ''}>easeOutElastic</option>
                        <option value="bounce" ${anims.easing === 'bounce' ? 'selected' : ''}>bounce</option>
                    </select>
                </div>
                <div>
                    <div class="flex justify-between text-[10px] text-on-surface-variant">
                        <span>Anim Delay</span>
                        <span>${anims.delay || 0}s</span>
                    </div>
                    <input type="range" id="insp_anim_delay" min="0" max="10" step="0.1" value="${anims.delay || 0}" class="w-full" oninput="changeClipAnimationParam('${clip.id}', 'delay', this.value)">
                </div>
                <div>
                    <div class="flex justify-between text-[10px] text-on-surface-variant">
                        <span>Anim Duration</span>
                        <span>${anims.duration || 0.5}s</span>
                    </div>
                    <input type="range" id="insp_anim_duration" min="0.1" max="10" step="0.1" value="${anims.duration || 0.5}" class="w-full" oninput="changeClipAnimationParam('${clip.id}', 'duration', this.value)">
                </div>
            </div>
        `;
    }

    let finalHtml = `<h4 class="inspector-title" style="font-size:0.8rem; font-weight:600; margin-bottom:0.75rem; color: var(--text-on-surface);">Properties: ${clip.name || track.name}</h4>`;
    if (transformHtml) finalHtml += renderSection('Transform', 'transform', transformHtml);
    if (appearanceHtml) finalHtml += renderSection('Appearance', 'appearance', appearanceHtml);
    if (textHtml) finalHtml += renderSection('Text', 'text', textHtml);
    if (audioHtml) finalHtml += renderSection('Audio', 'audio', audioHtml);
    if (effectsHtml) finalHtml += renderSection('Effects', 'effects', effectsHtml);
    if (animationHtml) finalHtml += renderSection('Animation', 'animation', animationHtml);

    finalHtml += `<button class="w-full py-1.5 bg-red-600 text-white rounded font-medium mt-3 border-none cursor-pointer hover:bg-red-700 transition-colors" id="insp_delete">Delete Clip</button>`;
    inspectorSection.innerHTML = finalHtml;

    const bindInput = (id, key, multiplier = 1, isInt = false) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            let val = isInt ? parseInt(e.target.value) : parseFloat(e.target.value);
            clip[key] = val * multiplier;
            renderCanvasComposition();
            if (track.type === 'audio') {
                syncMediaPlayback();
                if (id === 'insp_volume') {
                    const span = el.nextElementSibling;
                    if (span) span.textContent = `${Math.round(val)}%`;
                }
            }
            if (id.startsWith('insp_crop')) {
                const label = el.previousElementSibling;
                if (label) {
                    const span = label.querySelector('span:last-child');
                    if (span) span.textContent = `${Math.round(val)}px`;
                }
            }
            if (id === 'insp_letter_spacing' || id === 'insp_line_height' || id === 'insp_stroke_width' || id.startsWith('insp_shadow_')) {
                const label = el.previousElementSibling;
                if (label) {
                    const span = label.querySelector('span:last-child');
                    if (span) {
                        if (id === 'insp_line_height') {
                            span.textContent = (val * multiplier).toFixed(1);
                        } else {
                            span.textContent = `${Math.round(val * multiplier)}px`;
                        }
                    }
                }
            }
        });
    };

    bindInput('insp_x', 'x', 1, false);
    bindInput('insp_y', 'y', 1, false);
    bindInput('insp_rot', 'rotation', 1, true);
    bindInput('insp_opacity', 'opacity', 0.01, false);
    bindInput('insp_scale', 'scale', 0.01, false);
    bindInput('insp_volume', 'volume', 0.01, false);
    bindInput('insp_fadein', 'fadeIn', 1, false);
    bindInput('insp_fadeout', 'fadeOut', 1, false);
    bindInput('insp_size', 'size', 1, true);
    bindInput('insp_cropx', 'cropX', 1, true);
    bindInput('insp_cropy', 'cropY', 1, true);
    bindInput('insp_cropw', 'cropW', 1, true);
    bindInput('insp_croph', 'cropH', 1, true);

    bindInput('insp_letter_spacing', 'letterSpacing', 1, true);
    bindInput('insp_line_height', 'lineHeight', 0.01, false);
    bindInput('insp_stroke_width', 'textStrokeWidth', 1, true);
    bindInput('insp_shadow_blur', 'shadowBlur', 1, true);
    bindInput('insp_shadow_offsetx', 'shadowOffsetX', 1, true);
    bindInput('insp_shadow_offsety', 'shadowOffsetY', 1, true);

    const colorEl = document.getElementById('insp_color');
    if (colorEl) {
        colorEl.addEventListener('input', (e) => {
            clip.color = e.target.value;
            renderCanvasComposition();
        });
    }

    const strokeColorEl = document.getElementById('insp_stroke_color');
    if (strokeColorEl) {
        strokeColorEl.addEventListener('input', (e) => {
            clip.strokeColor = e.target.value;
            renderCanvasComposition();
        });
    }

    const shadowColorEl = document.getElementById('insp_shadow_color');
    if (shadowColorEl) {
        shadowColorEl.addEventListener('input', (e) => {
            clip.shadowColor = e.target.value;
            renderCanvasComposition();
        });
    }

    const gradStartEl = document.getElementById('insp_grad_start');
    if (gradStartEl) {
        gradStartEl.addEventListener('input', (e) => {
            clip.gradientStartColor = e.target.value;
            renderCanvasComposition();
        });
    }

    const gradEndEl = document.getElementById('insp_grad_end');
    if (gradEndEl) {
        gradEndEl.addEventListener('input', (e) => {
            clip.gradientEndColor = e.target.value;
            renderCanvasComposition();
        });
    }

    const bindShapeInput = (id, key, multiplier = 1, isInt = false) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            let val = isInt ? parseInt(e.target.value) : parseFloat(e.target.value);
            if (!clip.shapeProps) clip.shapeProps = {};
            clip.shapeProps[key] = val * multiplier;
            renderCanvasComposition();

            const label = el.previousElementSibling;
            if (label) {
                const span = label.querySelector('span:last-child');
                if (span) span.textContent = `${Math.round(val * multiplier)}px`;
            }
        });
    };

    bindInput('insp_shape_width', 'shapeWidth', 1, true);
    bindInput('insp_shape_height', 'shapeHeight', 1, true);

    const shapeWEl = document.getElementById('insp_shape_width');
    if (shapeWEl) {
        shapeWEl.addEventListener('input', (e) => {
            const label = shapeWEl.previousElementSibling;
            if (label) {
                const span = label.querySelector('span:last-child');
                if (span) span.textContent = `${e.target.value}px`;
            }
        });
    }
    const shapeHEl = document.getElementById('insp_shape_height');
    if (shapeHEl) {
        shapeHEl.addEventListener('input', (e) => {
            const label = shapeHEl.previousElementSibling;
            if (label) {
                const span = label.querySelector('span:last-child');
                if (span) span.textContent = `${e.target.value}px`;
            }
        });
    }

    bindShapeInput('insp_shape_stroke_width', 'strokeWidth', 1, true);
    bindShapeInput('insp_shape_corner_radius', 'cornerRadius', 1, true);
    bindShapeInput('insp_shape_blur', 'blur', 1, true);

    const shapeFillEl = document.getElementById('insp_shape_fill');
    if (shapeFillEl) {
        shapeFillEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            clip.shapeProps.fill = e.target.value;
            renderCanvasComposition();
        });
    }
    const shapeStrokeEl = document.getElementById('insp_shape_stroke');
    if (shapeStrokeEl) {
        shapeStrokeEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            clip.shapeProps.stroke = e.target.value;
            renderCanvasComposition();
        });
    }
    const shapeGradStartEl = document.getElementById('insp_shape_grad_start');
    if (shapeGradStartEl) {
        shapeGradStartEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            clip.shapeProps.gradientStartColor = e.target.value;
            renderCanvasComposition();
        });
    }
    const shapeGradEndEl = document.getElementById('insp_shape_grad_end');
    if (shapeGradEndEl) {
        shapeGradEndEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            clip.shapeProps.gradientEndColor = e.target.value;
            renderCanvasComposition();
        });
    }
    const shapePatternColorEl = document.getElementById('insp_shape_pattern_color');
    if (shapePatternColorEl) {
        shapePatternColorEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            clip.shapeProps.patternColor = e.target.value;
            renderCanvasComposition();
        });
    }
    const shapeFillImageTextEl = document.getElementById('insp_shape_fill_image');
    if (shapeFillImageTextEl) {
        shapeFillImageTextEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            clip.shapeProps.fillImage = e.target.value;
            clip.shapeProps.fillImageElement = null;
            renderCanvasComposition();
        });
    }
    const shapeGlowColorEl = document.getElementById('insp_shape_glow_color');
    if (shapeGlowColorEl) {
        shapeGlowColorEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            if (!clip.shapeProps.glow) clip.shapeProps.glow = { color: '#ff00ff', size: 0 };
            clip.shapeProps.glow.color = e.target.value;
            renderCanvasComposition();
        });
    }
    const shapeGlowSizeEl = document.getElementById('insp_shape_glow_size');
    if (shapeGlowSizeEl) {
        shapeGlowSizeEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            if (!clip.shapeProps.glow) clip.shapeProps.glow = { color: '#ff00ff', size: 0 };
            clip.shapeProps.glow.size = parseInt(e.target.value);
            renderCanvasComposition();
            const label = shapeGlowSizeEl.previousElementSibling;
            if (label) {
                const span = label.querySelector('span:last-child');
                if (span) span.textContent = `${e.target.value}px`;
            }
        });
    }

    const textEl = document.getElementById('insp_text');
    if (textEl) {
        textEl.addEventListener('input', (e) => {
            clip.text = e.target.value;
            clip.name = e.target.value;
            renderTimeline();
            renderCanvasComposition();
        });
    }

    const fontEl = document.getElementById('insp_font');
    if (fontEl) {
        fontEl.addEventListener('change', (e) => {
            clip.font = e.target.value;
            renderCanvasComposition();
        });
    }

    // Auto-save history on change for all inspector inputs
    if (inspectorSection) {
        inspectorSection.querySelectorAll('input, select').forEach(input => {
            input.addEventListener('change', (e) => {
                saveStateToHistory(`Edit ${input.id || 'Property'}`);
            });
        });
    }

    const deleteBtn = document.getElementById('insp_delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            window.timelineDeleteSelected();
        });
    }
}
