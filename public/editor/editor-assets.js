/**
 * ForgeCut editor — Media asset upload, removal and text clips
 *
 * Split out of the original editor.js. These files are plain classic
 * scripts sharing one global scope and MUST be loaded in the order listed
 * in index.html; the concatenation is byte-identical to the original file.
 */
// Asset uploading helpers
async function handleAssetUpload(file, type) {
    if (!window.ForgeCut || !window.ForgeCut.MediaEngine) {
            console.error('[Editor] MediaEngine not loaded');
            return;
        }

        // Show spinner or loading state
        const statusText = document.querySelector('footer .font-status-bar');
        if (statusText) statusText.textContent = `Processing ${file.name}...`;

        try {
            const asset = await window.ForgeCut.MediaEngine.importFile(file, type);
            assetCache.set(asset.id, asset);
            addUploadFileItem(asset, asset.type);

            if (asset.type === 'video') {
                canvas.width = asset.width || canvas.width;
                canvas.height = asset.height || canvas.height;
                const resLabel = document.getElementById('footerResolution');
                if (resLabel) resLabel.textContent = `${canvas.width}x${canvas.height}`;
                recalculateCanvasDisplaySize();

                const videoClipId = `clip_${Date.now()}`;
                const track = state.tracks.find(t => t.id === 'videoTrack');
                const newClip = {
                    id: videoClipId,
                    assetId: asset.id,
                    name: asset.name,
                    startTime: 0,
                    duration: Math.min(state.duration, asset.duration || 5.0),
                    trimStart: 0,
                    x: canvas.width / 2,
                    y: canvas.height / 2,
                    scale: 1.0,
                    rotation: 0,
                    opacity: 1.0
                };

                // Check if video has an embedded audio stream (waveform exists)
                const hasAudio = asset.waveform && asset.waveform.length > 0;
                if (hasAudio) {
                    const audioAssetId = `${asset.id}_audio`;
                    const audioElement = document.createElement('audio');
                    audioElement.src = asset.objectUrl;
                    audioElement.preload = 'auto';

                    const audioAsset = {
                        ...asset,
                        id: audioAssetId,
                        element: audioElement,
                        type: 'audio',
                        name: `${asset.name} (Audio)`
                    };

                    assetCache.set(audioAssetId, audioAsset);
                    if (window.ForgeCut && window.ForgeCut.MediaEngine) {
                        window.ForgeCut.MediaEngine.mediaLibrary.set(audioAssetId, audioAsset);
                    }

                    const audioTrack = state.tracks.find(t => t.id === 'audioTrack');
                    const linkedAudioClipId = `clip_${Date.now()}_audio`;
                    const newAudioClip = {
                        id: linkedAudioClipId,
                        assetId: audioAssetId,
                        name: `${asset.name} (Audio)`,
                        startTime: 0,
                        duration: newClip.duration,
                        trimStart: 0,
                        volume: 1.0,
                        fadeIn: 0,
                        fadeOut: 0,
                        linkedClipId: videoClipId
                    };
                    audioTrack.clips.push(newAudioClip);
                    newClip.linkedClipId = linkedAudioClipId;
                }

                track.clips.push(newClip);
                state.duration = Math.max(state.duration, asset.duration || 30.0);
                renderTimeline();
                setTime(0);
            } else if (asset.type === 'audio') {
                const track = state.tracks.find(t => t.id === 'audioTrack');
                const newClip = {
                    id: `clip_${Date.now()}`,
                    assetId: asset.id,
                    name: asset.name,
                    startTime: 0,
                    duration: Math.min(state.duration, asset.duration || 5.0),
                    trimStart: 0,
                    volume: 1.0,
                    fadeIn: 0.5,
                    fadeOut: 0.5
                };
                track.clips.push(newClip);
                renderTimeline();
            } else if (asset.type === 'image') {
                const track = state.tracks.find(t => t.id === 'videoTrack2');
                const newClip = {
                    id: `clip_${Date.now()}`,
                    assetId: asset.id,
                    name: asset.name,
                    startTime: 0,
                    duration: 5.0,
                    trimStart: 0,
                    x: canvas.width / 2,
                    y: canvas.height / 2,
                    scale: 0.5,
                    rotation: 0,
                    opacity: 1.0
                };
                track.clips.push(newClip);
                renderTimeline();
            }

            if (statusText) statusText.textContent = 'System Ready';
        } catch (e) {
            console.error('[Editor] Asset import error:', e);
            if (statusText) statusText.textContent = 'Import failed';
        }
}
window.handleAssetUpload = handleAssetUpload;

    function addUploadFileItem(asset, type) {
        if (type === 'video' || type === 'image') {
            const grid = document.getElementById('catalog-media-grid');
            if (!grid) return;

            const item = document.createElement('div');
            item.className = 'p-2 bg-surface hover:bg-surface-container rounded-lg border border-outline-variant/30 flex flex-col gap-2 relative group cursor-grab';
            item.setAttribute('draggable', 'true');
            item.dataset.assetId = asset.id;
            item.dataset.assetType = type;

            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'media', assetId: asset.id, assetType: type }));
            });

            item.addEventListener('click', () => {
                let foundClipId = null;
                state.tracks.forEach(track => {
                    const clip = track.clips.find(c => c.assetId === asset.id);
                    if (clip) foundClipId = clip.id;
                });
                if (foundClipId) {
                    selectClip(foundClipId);
                }
            });

            const previewHtml = type === 'video'
                ? `<div class="aspect-video bg-black rounded overflow-hidden flex items-center justify-center relative">
                 <span class="material-symbols-outlined text-white/50 text-2xl absolute">play_circle</span>
                 <video class="w-full h-full object-cover opacity-60" src="${asset.objectUrl}"></video>
               </div>`
                : `<div class="aspect-video bg-black rounded overflow-hidden flex items-center justify-center">
                 <img class="w-full h-full object-cover" src="${asset.objectUrl}">
               </div>`;

            item.innerHTML = `
            ${previewHtml}
            <div class="flex justify-between items-center w-full">
                <span class="text-[10px] font-bold text-on-surface truncate w-32" title="${esc(asset.name)}">${esc(asset.name)}</span>
                <button class="text-xs text-on-surface-variant hover:text-error bg-transparent border-none cursor-pointer p-0" onclick="removeUploadedAsset('${esc(asset.id)}', '${esc(type)}')">
                    <span class="material-symbols-outlined text-sm">delete</span>
                </button>
            </div>
        `;
            grid.appendChild(item);
        } else if (type === 'audio') {
            const list = document.getElementById('catalog-audio-list');
            if (!list) return;

            const item = document.createElement('div');
            item.className = 'p-3 bg-surface hover:bg-surface-container rounded-lg border border-outline-variant/30 flex items-center justify-between cursor-grab';
            item.setAttribute('draggable', 'true');
            item.dataset.assetId = asset.id;

            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'media', assetId: asset.id, assetType: 'audio' }));
            });

            item.addEventListener('click', () => {
                let foundClipId = null;
                state.tracks.forEach(track => {
                    const clip = track.clips.find(c => c.assetId === asset.id);
                    if (clip) foundClipId = clip.id;
                });
                if (foundClipId) {
                    selectClip(foundClipId);
                }
            });

            item.innerHTML = `
            <div class="flex items-center gap-3">
                <span class="material-symbols-outlined text-primary">audiotrack</span>
                <div class="flex flex-col">
                    <span class="text-xs font-bold text-on-surface truncate w-36" title="${esc(asset.name)}">${esc(asset.name)}</span>
                    <span class="text-[9px] text-outline">Audio Track Asset</span>
                </div>
            </div>
            <button class="text-xs text-on-surface-variant hover:text-error bg-transparent border-none cursor-pointer p-0" onclick="removeUploadedAsset('${asset.id}', 'audio')">
                <span class="material-symbols-outlined text-sm">delete</span>
            </button>
        `;
            list.appendChild(item);
        }
    }

    window.removeUploadedAsset = function (assetId, type) {
        const asset = assetCache.get(assetId);
        if (!asset) return;

        state.tracks.forEach(track => {
            track.clips = track.clips.filter(c => c.assetId !== assetId);
        });

        // Route removal through MediaEngine so its own library drops the asset
        // too. assetCache is a second index over the *same* asset objects, so
        // revoking here without telling MediaEngine left it holding an entry
        // with a dead objectUrl and a live media element — a leak, and a source
        // of stale reads via PlaybackEngine's ME.getAsset() lookup.
        if (window.ForgeCut && window.ForgeCut.MediaEngine) {
            window.ForgeCut.MediaEngine.removeAsset(assetId);
        } else if (asset.objectUrl) {
            URL.revokeObjectURL(asset.objectUrl);
        }
        assetCache.delete(assetId);

        const grid = document.getElementById('catalog-media-grid');
        if (grid) grid.innerHTML = '';
        const list = document.getElementById('catalog-audio-list');
        if (list) list.innerHTML = '';

        assetCache.forEach(a => {
            const matchType = a.element && a.element.tagName === 'VIDEO' ? 'video' : (a.element && a.element.tagName === 'AUDIO' ? 'audio' : 'image');
            addUploadFileItem(a, matchType);
        });

        renderTimeline();
        updateInspector();
        renderCanvasComposition();
        syncMediaPlayback();
    };

    window.addNewTextClip = function (type = 'Textbox') {
        const track = state.tracks.find(t => t.id === 'textTrack');
        const newClip = {
            id: `clip_${Date.now()}`,
            name: type,
            text: type === 'Textbox' ? 'Double click or edit text' : `New ${type} {{name}}`,
            startTime: state.currentTime,
            duration: 5.0,
            x: canvas.width / 2,
            y: canvas.height * (type === 'Heading' ? 0.25 : 0.75),
            font: 'Arial',
            size: type === 'Heading' ? 96 : 72,
            color: '#ffffff',
            rotation: 0,
            opacity: 1.0
        };
        track.clips.push(newClip);
        renderTimeline();
        selectClip(newClip.id);
    };
