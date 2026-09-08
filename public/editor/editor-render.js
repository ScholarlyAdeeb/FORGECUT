/**
 * ForgeCut editor — Canvas composition and selection transform box
 *
 * Split out of the original editor.js. These files are plain classic
 * scripts sharing one global scope and MUST be loaded in the order listed
 * in index.html; the concatenation is byte-identical to the original file.
 */
// Render active clips onto the canvas
function renderCanvasComposition() {
    if (!canvas || !ctx) return;

    // 1. Draw Checkerboard backdrop
    const chkSize = 32;
    for (let x = 0; x < canvas.width; x += chkSize) {
        for (let y = 0; y < canvas.height; y += chkSize) {
            ctx.fillStyle = ((x / chkSize + y / chkSize) % 2 === 0) ? '#1f2937' : '#111827';
            ctx.fillRect(x, y, chkSize, chkSize);
        }
    }

    // 2. Draw background configuration
    if (state.bgType === 'solid') {
        ctx.fillStyle = state.bgColor || '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (state.bgType === 'gradient') {
        const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        grad.addColorStop(0, state.bgGradientStart || '#005faa');
        grad.addColorStop(1, state.bgGradientEnd || '#dee0e2');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (state.bgType === 'image' && state.bgImageUrl) {
        const bgImg = new Image();
        bgImg.src = state.bgImageUrl;
        try {
            ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
        } catch (e) { }
    } else if (state.bgType === 'blur') {
        ctx.fillStyle = 'rgba(0, 95, 170, 0.4)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const activeRow = state.csvData[state.selectedRowIndex] || {};

    state.tracks.forEach(track => {
        if (state.trackVisibility[track.id] === false) return;

        track.clips.forEach(clip => {
            const inRange = state.currentTime >= clip.startTime && state.currentTime <= (clip.startTime + clip.duration);
            if (!inRange) return;

            // Apply keyframe interpolations before rendering
            const originalProperties = {};
            const numericProps = [
                'x', 'y', 'scale', 'rotation', 'opacity',
                'cropX', 'cropY', 'cropW', 'cropH',
                'blur', 'brightness', 'contrast', 'saturation', 'hue', 'playbackSpeed',
                'volume', 'gain', 'fadeIn', 'fadeOut', 'balance',
                'size', 'textStrokeWidth', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'lineHeight', 'letterSpacing',
                'shapeWidth', 'shapeHeight', 'strokeWidth', 'cornerRadius'
            ];
            numericProps.forEach(prop => {
                if (clip[prop] !== undefined) {
                    originalProperties[prop] = clip[prop];
                    clip[prop] = window.getInterpolatedValue(clip, prop, clip[prop]);
                }
            });

            ctx.save();

            // Calculate animated properties if AnimationEngine is loaded
            let animProps = { offsetX: 0, offsetY: 0, scale: 1.0, rotation: 0, opacity: 1.0 };
            if (window.ForgeCut && window.ForgeCut.AnimationEngine) {
                const clipLocalTime = state.currentTime - clip.startTime;
                animProps = window.ForgeCut.AnimationEngine.getAnimatedProperties(clip, clipLocalTime);
            }

            ctx.globalAlpha = (clip.opacity !== undefined ? clip.opacity : 1.0) * animProps.opacity;

            // Handle transition blending if TransitionEngine is loaded
            let transProgress = { active: false };
            if (window.ForgeCut && window.ForgeCut.TransitionEngine) {
                transProgress = window.ForgeCut.TransitionEngine.getTransitionProgress(clip, state.currentTime);
            }

            if (track.type === 'video' || track.type === 'image') {
                const asset = (window.ForgeCut && window.ForgeCut.MediaEngine)
                    ? window.ForgeCut.MediaEngine.getAsset(clip.assetId)
                    : assetCache.get(clip.assetId);

                if (asset && asset.element) {
                    const el = asset.element;
                    const x = (clip.x !== undefined ? clip.x : canvas.width / 2) + animProps.offsetX;
                    const y = (clip.y !== undefined ? clip.y : canvas.height / 2) + animProps.offsetY;
                    const scale = (clip.scale !== undefined ? clip.scale : 1.0) * animProps.scale;
                    const rotation = (clip.rotation !== undefined ? clip.rotation : 0) + animProps.rotation;

                    ctx.translate(x, y);
                    ctx.rotate(rotation * Math.PI / 180);
                    ctx.scale(scale, scale);
                    try {
                        const width = el.videoWidth || el.width || 320;
                        const height = el.videoHeight || el.height || 180;

                        if (transProgress.active && window.ForgeCut.TransitionEngine) {
                            if (!window._offscreenCanvasFrom) {
                                window._offscreenCanvasFrom = document.createElement('canvas');
                                window._offscreenCanvasTo = document.createElement('canvas');
                            }
                            if (window._offscreenCanvasFrom.width !== canvas.width) {
                                window._offscreenCanvasFrom.width = canvas.width;
                                window._offscreenCanvasFrom.height = canvas.height;
                                window._offscreenCanvasTo.width = canvas.width;
                                window._offscreenCanvasTo.height = canvas.height;
                            }

                            const fromCtx = window._offscreenCanvasFrom.getContext('2d');
                            fromCtx.clearRect(0, 0, canvas.width, canvas.height);
                            fromCtx.drawImage(canvas, 0, 0);

                            const toCtx = window._offscreenCanvasTo.getContext('2d');
                            toCtx.clearRect(0, 0, canvas.width, canvas.height);
                            toCtx.save();
                            toCtx.translate(x, y);
                            toCtx.rotate(rotation * Math.PI / 180);
                            toCtx.scale(scale, scale);
                            if (clip.cropX !== undefined && clip.cropY !== undefined && clip.cropW !== undefined && clip.cropH !== undefined) {
                                toCtx.drawImage(el, clip.cropX, clip.cropY, clip.cropW, clip.cropH, -clip.cropW / 2, -clip.cropH / 2, clip.cropW, clip.cropH);
                            } else {
                                toCtx.drawImage(el, -width / 2, -height / 2);
                            }
                            toCtx.restore();

                            ctx.restore();
                            ctx.save();
                            window.ForgeCut.TransitionEngine.applyTransition(
                                ctx,
                                window._offscreenCanvasFrom,
                                window._offscreenCanvasTo,
                                transProgress.progress,
                                transProgress.type,
                                transProgress.direction,
                                canvas.width,
                                canvas.height,
                                clip.id
                            );
                        } else {
                            const blurVal = clip.blur || 0;
                            const brightnessVal = clip.brightness !== undefined ? clip.brightness : 1.0;
                            const contrastVal = clip.contrast !== undefined ? clip.contrast : 1.0;
                            const saturationVal = clip.saturation !== undefined ? clip.saturation : 1.0;
                            const hueVal = clip.hue || 0;
                            ctx.filter = `blur(${blurVal}px) brightness(${brightnessVal}) contrast(${contrastVal}) saturate(${saturationVal}) hue-rotate(${hueVal}deg)`;

                            if (clip.cropX !== undefined && clip.cropY !== undefined && clip.cropW !== undefined && clip.cropH !== undefined) {
                                ctx.drawImage(el, clip.cropX, clip.cropY, clip.cropW, clip.cropH, -clip.cropW / 2, -clip.cropH / 2, clip.cropW, clip.cropH);
                            } else {
                                ctx.drawImage(el, -width / 2, -height / 2);
                            }
                            ctx.filter = 'none';
                        }
                    } catch (e) { }
                }
            } else if (track.type === 'text') {
                if (window.ForgeCut && window.ForgeCut.TextRenderer) {
                    // Temporarily apply animation offsets
                    const origX = clip.x;
                    const origY = clip.y;
                    const origRot = clip.rotation;
                    const origOpacity = clip.opacity;

                    clip.x = (origX !== undefined ? origX : canvas.width / 2) + animProps.offsetX;
                    clip.y = (origY !== undefined ? origY : canvas.height / 2) + animProps.offsetY;
                    clip.rotation = (origRot !== undefined ? origRot : 0) + animProps.rotation;
                    clip.opacity = (origOpacity !== undefined ? origOpacity : 1.0) * animProps.opacity;

                    window.ForgeCut.TextRenderer.renderText(ctx, clip, canvas.width, canvas.height, activeRow, state.placeholders);

                    // Restore
                    clip.x = origX;
                    clip.y = origY;
                    clip.rotation = origRot;
                    clip.opacity = origOpacity;
                } else {
                    let text = clip.text || '';
                    state.placeholders.forEach(ph => {
                        const placeholderStr = `{${ph}}`;
                        const placeholderStrDouble = `{{${ph}}}`;
                        const val = activeRow[ph] || activeRow[placeholderStr] || activeRow[placeholderStrDouble] || '';
                        text = text.replaceAll(placeholderStrDouble, val);
                        text = text.replaceAll(placeholderStr, val);
                    });

                    const x = (clip.x !== undefined ? clip.x : canvas.width / 2) + animProps.offsetX;
                    const y = (clip.y !== undefined ? clip.y : canvas.height / 2) + animProps.offsetY;
                    const size = (clip.size !== undefined ? clip.size : 72) * animProps.scale;
                    const color = clip.color || '#ffffff';
                    const font = clip.font || 'Arial';
                    const rotation = (clip.rotation !== undefined ? clip.rotation : 0) + animProps.rotation;

                    ctx.translate(x, y);
                    ctx.rotate(rotation * Math.PI / 180);

                    ctx.font = `bold ${size}px ${font}`;
                    ctx.fillStyle = color;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';

                    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
                    ctx.shadowBlur = 12;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 4;

                    ctx.fillText(text, 0, 0);
                }
            } else if (track.type === 'shape') {
                if (window.ForgeCut && window.ForgeCut.ShapeRenderer) {
                    const origX = clip.x;
                    const origY = clip.y;
                    const origRot = clip.rotation;
                    const origOpacity = clip.opacity;

                    clip.x = (origX !== undefined ? origX : canvas.width / 2) + animProps.offsetX;
                    clip.y = (origY !== undefined ? origY : canvas.height / 2) + animProps.offsetY;
                    clip.rotation = (origRot !== undefined ? origRot : 0) + animProps.rotation;
                    clip.opacity = (origOpacity !== undefined ? origOpacity : 1.0) * animProps.opacity;

                    window.ForgeCut.ShapeRenderer.renderShape(ctx, clip);

                    clip.x = origX;
                    clip.y = origY;
                    clip.rotation = origRot;
                    clip.opacity = origOpacity;
                }
            }

            // Restore original properties
            numericProps.forEach(prop => {
                if (originalProperties[prop] !== undefined) {
                    clip[prop] = originalProperties[prop];
                }
            });

            ctx.restore();
        });
    });

    // Draw Gridlines
    if (state.showGridlines) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        const gridGap = 80;
        for (let x = gridGap; x < canvas.width; x += gridGap) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
        for (let y = gridGap; y < canvas.height; y += gridGap) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Draw Guides
    if (state.showGuides) {
        ctx.save();
        ctx.strokeStyle = '#005faa';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2, 0);
        ctx.lineTo(canvas.width / 2, canvas.height);
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
        ctx.restore();
    }

    // Draw Safe Area Guides
    if (state.showSafeAreaGuide) {
        ctx.save();
        const platform = state.safeAreaPlatform || 'YouTube';
        const config = state.safeZoneConfig || { title: true, action: true, caption: true, danger: true };
        const cw = canvas.width;
        const ch = canvas.height;

        ctx.lineWidth = 2;
        ctx.font = 'bold 16px Arial';

        // 1. UI Danger Zones (areas covered by buttons/captions)
        if (config.danger) {
            ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
            if (platform === 'TikTok' || platform === 'Reels' || platform === 'Shorts') {
                // Right side buttons & Bottom captions
                ctx.fillRect(cw - 120, ch / 2, 120, ch / 2 - 100);
                ctx.fillRect(0, ch - 250, cw, 250);
            } else if (platform === 'YouTube') {
                // Player controls
                ctx.fillRect(0, ch - 80, cw, 80);
            } else if (platform === 'Instagram') {
                ctx.fillRect(0, ch - 100, cw, 100);
            }
        }

        // 2. Action Safe
        if (config.action) {
            ctx.strokeStyle = '#4CAF50';
            ctx.setLineDash([5, 5]);
            let ax = cw * 0.05; let ay = ch * 0.05;
            ctx.strokeRect(ax, ay, cw - ax * 2, ch - ay * 2);
            ctx.fillStyle = '#4CAF50';
            ctx.fillText('Action Safe', ax + 10, ay + 20);
        }

        // 3. Title Safe
        if (config.title) {
            ctx.strokeStyle = '#2196F3';
            ctx.setLineDash([5, 5]);
            let tx = cw * 0.1; let ty = ch * 0.1;
            ctx.strokeRect(tx, ty, cw - tx * 2, ch - ty * 2);
            ctx.fillStyle = '#2196F3';
            ctx.fillText('Title Safe', tx + 10, ty + 20);
        }

        // 4. Caption Safe
        if (config.caption) {
            ctx.strokeStyle = '#FFC107';
            ctx.setLineDash([10, 5]);
            let cx = cw * 0.1; let cy = ch * 0.75;
            if (platform === 'TikTok') cy = ch * 0.6;
            ctx.strokeRect(cx, cy, cw - cx * 2, ch * 0.2);
            ctx.fillStyle = '#FFC107';
            ctx.fillText('Caption Safe', cx + 10, cy + 20);
        }

        ctx.restore();
    }

    drawSelectedClipTransformBox();

    // Render Canvas Guides
    if (window._activeGuides && window._activeGuides.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#00c2ff'; // High visibility guide color
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);

        window._activeGuides.forEach(g => {
            if (g.type === 'v') {
                ctx.beginPath();
                ctx.moveTo(g.x, 0);
                ctx.lineTo(g.x, canvas.height);
                ctx.stroke();

                if (g.label) {
                    ctx.fillStyle = '#00c2ff';
                    ctx.font = 'bold 20px sans-serif';
                    ctx.fillText(g.label, g.x + 10, 40);
                }
            } else if (g.type === 'h') {
                ctx.beginPath();
                ctx.moveTo(0, g.y);
                ctx.lineTo(canvas.width, g.y);
                ctx.stroke();

                if (g.label) {
                    ctx.fillStyle = '#00c2ff';
                    ctx.font = 'bold 20px sans-serif';
                    ctx.fillText(g.label, 20, g.y - 10);
                }
            }
        });
        ctx.restore();
    }
}

function drawSelectedClipTransformBox() {
    const ids = state.selectedClipIds || (state.selectedClipId ? [state.selectedClipId] : []);
    if (ids.length === 0) return;

    ids.forEach(id => {
        let selectedClip = findClipById(id);
        if (!selectedClip) return;

        let selectedTrack = state.tracks.find(t => t.clips.includes(selectedClip));
        if (!selectedTrack) return;

        if (selectedTrack.type === 'audio' && selectedClip.linkedClipId) {
            const linked = findClipById(selectedClip.linkedClipId);
            if (linked) {
                const linkedTrack = state.tracks.find(t => t.clips.includes(linked));
                if (linkedTrack && (linkedTrack.type === 'video' || linkedTrack.type === 'image' || linkedTrack.type === 'text')) {
                    selectedClip = linked;
                    selectedTrack = linkedTrack;
                }
            }
        }

        if (state.trackLock[selectedTrack.id]) return;

        const inRange = state.currentTime >= selectedClip.startTime && state.currentTime <= (selectedClip.startTime + selectedClip.duration);
        if (!inRange || (selectedTrack.type !== 'video' && selectedTrack.type !== 'text' && selectedTrack.type !== 'image' && selectedTrack.type !== 'shape')) return;

        let w = 200;
        let h = 100;

        if (selectedTrack.type === 'video' || selectedTrack.type === 'image') {
            const asset = (window.ForgeCut && window.ForgeCut.MediaEngine)
                ? window.ForgeCut.MediaEngine.getAsset(selectedClip.assetId)
                : assetCache.get(selectedClip.assetId);
            if (asset && asset.element) {
                const el = asset.element;
                w = (el.videoWidth || el.width || 320) * (selectedClip.scale || 1.0);
                h = (el.videoHeight || el.height || 180) * (selectedClip.scale || 1.0);
            }
        } else if (selectedTrack.type === 'text') {
            if (window.ForgeCut && window.ForgeCut.TextRenderer) {
                const size = window.ForgeCut.TextRenderer.measureText(ctx, selectedClip, state.placeholders, state.csvData[state.selectedRowIndex]);
                w = size.width;
                h = size.height;
            } else {
                const size = selectedClip.size || 72;
                ctx.font = `bold ${size}px ${selectedClip.font || 'Arial'}`;
                w = ctx.measureText(selectedClip.text || '').width + 40;
                h = size + 20;
            }
        } else if (selectedTrack.type === 'shape') {
            w = selectedClip.shapeWidth || 200;
            h = selectedClip.shapeHeight || 150;
        }

        const x = selectedClip.x !== undefined ? selectedClip.x : canvas.width / 2;
        const y = selectedClip.y !== undefined ? selectedClip.y : canvas.height / 2;
        const rotation = selectedClip.rotation !== undefined ? selectedClip.rotation : 0;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation * Math.PI / 180);
        ctx.strokeStyle = '#0078d4'; // Fluent design blue selection outline
        ctx.lineWidth = 3;
        ctx.strokeRect(-w / 2, -h / 2, w, h);

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#0078d4';
        ctx.lineWidth = 2;
        const handleSize = 12;

        // 8 Handles: 4 Corners + 4 Edges
        // Corners
        ctx.fillRect(-w / 2 - handleSize / 2, -h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(-w / 2 - handleSize / 2, -h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.fillRect(w / 2 - handleSize / 2, -h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(w / 2 - handleSize / 2, -h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.fillRect(-w / 2 - handleSize / 2, h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(-w / 2 - handleSize / 2, h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.fillRect(w / 2 - handleSize / 2, h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(w / 2 - handleSize / 2, h / 2 - handleSize / 2, handleSize, handleSize);

        // Edges
        ctx.fillRect(-handleSize / 2, -h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(-handleSize / 2, -h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.fillRect(-handleSize / 2, h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(-handleSize / 2, h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.fillRect(-w / 2 - handleSize / 2, -handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(-w / 2 - handleSize / 2, -handleSize / 2, handleSize, handleSize);
        ctx.fillRect(w / 2 - handleSize / 2, -handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(w / 2 - handleSize / 2, -handleSize / 2, handleSize, handleSize);

        // Rotation Handle
        ctx.beginPath();
        ctx.moveTo(0, -h / 2);
        ctx.lineTo(0, -h / 2 - 25);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, -h / 2 - 25, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    });
}
