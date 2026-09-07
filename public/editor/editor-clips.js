/**
 * ForgeCut editor — Clip lookup, selection and splitting
 *
 * Split out of the original editor.js. These files are plain classic
 * scripts sharing one global scope and MUST be loaded in the order listed
 * in index.html; the concatenation is byte-identical to the original file.
 */
function findClipById(clipId) {
    let found = null;
    state.tracks.forEach(track => {
        const c = track.clips.find(x => x.id === clipId);
        if (c) found = c;
    });
    return found;
}

function selectClip(clipId, isCtrl = false) {
    if (!state.selectedClipIds) state.selectedClipIds = [];
    if (isCtrl) {
        const idx = state.selectedClipIds.indexOf(clipId);
        if (idx !== -1) {
            state.selectedClipIds.splice(idx, 1);
        } else {
            state.selectedClipIds.push(clipId);
        }
        state.selectedClipId = state.selectedClipIds.length > 0 ? state.selectedClipIds[state.selectedClipIds.length - 1] : null;
    } else {
        state.selectedClipIds = clipId ? [clipId] : [];
        state.selectedClipId = clipId;
    }
    renderTracks();
    updateInspector();
}

function splitClipAtPlayhead(clipId) {
    const clip = findClipById(clipId);
    if (!clip) return;

    const playheadLocal = state.currentTime;
    if (playheadLocal <= clip.startTime || playheadLocal >= (clip.startTime + clip.duration)) {
        return;
    }

    const track = state.tracks.find(t => t.clips.includes(clip));
    if (!track || state.trackLock[track.id]) return;

    saveStateToHistory();

    const originalDuration = clip.duration;
    const splitPoint = playheadLocal - clip.startTime;

    clip.duration = splitPoint;

    const newClipId = `clip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const newClip = {
        ...clip,
        id: newClipId,
        startTime: playheadLocal,
        duration: originalDuration - splitPoint,
        trimStart: (clip.trimStart || 0) + splitPoint
    };
    track.clips.push(newClip);

    // Split linked clip if it exists
    const linkedClip = clip.linkedClipId ? findClipById(clip.linkedClipId) : null;
    if (linkedClip) {
        const linkedTrack = state.tracks.find(t => t.clips.includes(linkedClip));
        if (linkedTrack && !state.trackLock[linkedTrack.id]) {
            const originalLinkedDuration = linkedClip.duration;
            linkedClip.duration = splitPoint;

            const newLinkedClipId = `clip_${Date.now()}_linked_${Math.random().toString(36).substr(2, 5)}`;
            const newLinkedClip = {
                ...linkedClip,
                id: newLinkedClipId,
                startTime: playheadLocal,
                duration: originalLinkedDuration - splitPoint,
                trimStart: (linkedClip.trimStart || 0) + splitPoint,
                linkedClipId: newClipId
            };
            linkedTrack.clips.push(newLinkedClip);
            newClip.linkedClipId = newLinkedClipId;
        }
    }

    selectClip(newClip.id);
    renderTimeline();
    syncMediaPlayback();
}

// Inspector Collapsible Toggle
window.toggleInspectorSection = function (id) {
    if (!state.inspectorCollapsed) state.inspectorCollapsed = {};
    const content = document.getElementById(`sec-${id}`);
    const chev = document.getElementById(`chevron-${id}`);
    if (content) {
        if (content.classList.contains('hidden')) {
            content.classList.remove('hidden');
            if (chev) chev.textContent = 'expand_more';
            state.inspectorCollapsed[id] = false;
        } else {
            content.classList.add('hidden');
            if (chev) chev.textContent = 'chevron_right';
            state.inspectorCollapsed[id] = true;
        }
    }
};

// Inspector Sync