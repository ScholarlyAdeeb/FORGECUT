class ForgeCutHeader extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
<!-- Top Ribbon Navigation Header -->
<header class="bg-surface border-b border-outline-variant flex flex-col w-full z-50 select-none">
    <!-- Title Bar -->
    <div class="flex justify-between items-center px-4 h-10 bg-surface border-b border-outline-variant/30">
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-primary" style="font-variation-settings: 'FILL' 1;">movie_edit</span>
            <span class="font-panel-header text-panel-header font-bold text-on-surface">ForgeCut</span>
            <span class="text-xs px-2 py-0.5 bg-primary-container text-on-primary-container rounded font-bold" id="titleBarModeLabel">Professional NLE</span>
        </div>
        <div id="fcQuickAccessToolbar" class="flex items-center gap-4">
            <button class="material-symbols-outlined text-on-surface-variant hover:text-on-surface cursor-pointer text-lg bg-transparent border-none" onclick="window.toggleDarkTheme()" title="Toggle Dark Theme">dark_mode</button>
            <button class="material-symbols-outlined text-on-surface-variant hover:text-on-surface cursor-pointer text-lg bg-transparent border-none" onclick="openProjectSettings()" title="Settings">settings</button>
            <button class="material-symbols-outlined text-on-surface-variant hover:text-on-surface cursor-pointer text-lg bg-transparent border-none" onclick="openHelpCenter()" title="Help">help</button>
        </div>
    </div>
    
    <!-- Ribbon Tabs -->
    <nav id="fcRibbonTabs" class="fc-ribbon-tabs flex items-center px-2 h-9 bg-surface">
        <div class="fc-ribbon-tabs-strip flex items-center h-full">
            <button class="px-4 h-full font-ribbon-tab text-ribbon-tab text-on-surface-variant hover:bg-surface-container-high transition-colors bg-transparent border-none" onclick="openBackstage()">File</button>
            <button class="ribbon-tab-btn px-4 h-full font-ribbon-tab text-ribbon-tab text-primary border-b-2 border-primary font-bold bg-surface-container-low" data-tab="home">Home</button>
            <button class="ribbon-tab-btn px-4 h-full font-ribbon-tab text-ribbon-tab text-on-surface-variant hover:bg-surface-container-high transition-colors" data-tab="insert">Insert</button>
            <button class="ribbon-tab-btn px-4 h-full font-ribbon-tab text-ribbon-tab text-on-surface-variant hover:bg-surface-container-high transition-colors" data-tab="design">Design</button>
            <button class="ribbon-tab-btn px-4 h-full font-ribbon-tab text-ribbon-tab text-on-surface-variant hover:bg-surface-container-high transition-colors" data-tab="transitions">Transitions</button>
            <button class="ribbon-tab-btn px-4 h-full font-ribbon-tab text-ribbon-tab text-on-surface-variant hover:bg-surface-container-high transition-colors" data-tab="animations">Animations</button>
            <button class="ribbon-tab-btn px-4 h-full font-ribbon-tab text-ribbon-tab text-on-surface-variant hover:bg-surface-container-high transition-colors" data-tab="view">View</button>
            <button class="ribbon-tab-btn px-4 h-full font-ribbon-tab text-ribbon-tab text-on-surface-variant hover:bg-surface-container-high transition-colors" data-tab="bulk">Bulk Production</button>
            <button class="ribbon-tab-btn px-4 h-full font-ribbon-tab text-ribbon-tab text-on-surface-variant hover:bg-surface-container-high transition-colors" data-tab="help">Help</button>
        </div>
    </nav>
    
    <!-- Ribbon Content Groups -->
    <div id="fcRibbonRow" class="fc-ribbon-row flex items-stretch bg-surface-container-low h-24 px-2 py-1 border-t border-outline-variant">
        <!-- Only the groups scroll; the actions on the right stay pinned. -->
        <div id="fcRibbonScroll" class="fc-ribbon-scroll flex items-stretch">

        <!-- HOME TAB GROUPS -->
        <div id="ribbon-group-home" class="ribbon-group-container flex items-stretch">
            <!-- Group: History -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center gap-1">
                    <button class="ribbon-button" onclick="triggerUndo()">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">undo</span>
                        <span class="text-[11px] text-on-surface">Undo</span>
                    </button>
                    <button class="ribbon-button" onclick="triggerRedo()">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">redo</span>
                        <span class="text-[11px] text-on-surface">Redo</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">History</span>
            </div>
            
            <!-- Group: Clipboard -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <button class="ribbon-button bg-primary-container/10 text-primary border border-primary/20 rounded px-3 py-1" onclick="timelinePaste()">
                        <span class="material-symbols-outlined text-[24px]" style="font-variation-settings: 'FILL' 1;">content_paste</span>
                        <span class="text-[11px] font-bold text-primary">Paste</span>
                    </button>
                    <div class="grid grid-rows-3 gap-0.5">
                        <button class="flex items-center gap-2 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="timelineCut()">
                            <span class="material-symbols-outlined text-[16px]">content_cut</span>
                            <span class="text-[10px] text-on-surface">Cut</span>
                        </button>
                        <button class="flex items-center gap-2 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="timelineCopy()">
                            <span class="material-symbols-outlined text-[16px]">content_copy</span>
                            <span class="text-[10px] text-on-surface">Copy</span>
                        </button>
                        <button class="flex items-center gap-2 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="timelineDuplicate()">
                            <span class="material-symbols-outlined text-[16px]">control_point_duplicate</span>
                            <span class="text-[10px] text-on-surface">Duplicate</span>
                        </button>
                    </div>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Clipboard</span>
            </div>

            <!-- Group: Timeline Tools -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <button class="ribbon-button" onclick="triggerSplit()">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">content_cut</span>
                        <span class="text-[11px] text-on-surface">Split (S)</span>
                    </button>
                    <button class="ribbon-button" onclick="triggerTrim()">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">hourglass_empty</span>
                        <span class="text-[11px] text-on-surface">Trim</span>
                    </button>
                    <button class="ribbon-button" onclick="timelineRippleDelete()">
                        <span class="material-symbols-outlined text-[24px] text-error">delete_sweep</span>
                        <span class="text-[11px] text-error font-medium">Ripple Del</span>
                    </button>
                    <button class="ribbon-button" onclick="timelineDeleteSelected()">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">delete</span>
                        <span class="text-[11px] text-on-surface">Delete</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Timeline</span>
            </div>
            
            <!-- Group: Arrange -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <div class="grid grid-cols-2 gap-1">
                        <button class="flex flex-col items-center p-1.5 hover:bg-surface-container rounded" onclick="arrangeClip('forward')">
                            <span class="material-symbols-outlined text-sm">flip_to_front</span>
                            <span class="text-[9px]">Forward</span>
                        </button>
                        <button class="flex flex-col items-center p-1.5 hover:bg-surface-container rounded" onclick="arrangeClip('backward')">
                            <span class="material-symbols-outlined text-sm">flip_to_back</span>
                            <span class="text-[9px]">Backward</span>
                        </button>
                    </div>
                    <div class="w-px h-10 bg-outline-variant/30"></div>
                    <div class="flex gap-1 px-1">
                        <button class="ribbon-button" onclick="arrangeClip('align')">
                            <span class="material-symbols-outlined text-[20px]">align_horizontal_center</span>
                            <span class="text-[11px]">Align</span>
                        </button>
                        <button class="ribbon-button" onclick="arrangeClip('group')">
                            <span class="material-symbols-outlined text-[20px]">group</span>
                            <span class="text-[11px]">Group</span>
                        </button>
                    </div>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Arrange</span>
            </div>

        </div>
        
        <!-- INSERT TAB GROUPS -->
        <div id="ribbon-group-insert" class="ribbon-group-container hidden flex items-stretch">
            <!-- Group: Import Media -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <button class="ribbon-button relative">
                        <span class="material-symbols-outlined text-[24px] text-primary">video_library</span>
                        <span class="text-[11px] text-on-surface font-semibold">Video</span>
                        <input type="file" id="mediaFileInput" accept="video/*" class="absolute inset-0 opacity-0 cursor-pointer">
                    </button>
                    <button class="ribbon-button relative">
                        <span class="material-symbols-outlined text-[24px] text-primary">audio_file</span>
                        <span class="text-[11px] text-on-surface font-semibold">Audio</span>
                        <input type="file" id="audioFileInput" accept="audio/*" class="absolute inset-0 opacity-0 cursor-pointer">
                    </button>
                    <div class="grid grid-rows-3 gap-0.5">
                        <button class="flex items-center gap-2 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left relative">
                            <span class="material-symbols-outlined text-[16px] text-primary">image</span>
                            <span class="text-[10px] text-on-surface">Image</span>
                            <input type="file" id="imageFileInput" accept="image/*" class="absolute inset-0 opacity-0 cursor-pointer">
                        </button>
                        <button class="flex items-center gap-2 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="addNewGifClip()">
                            <span class="material-symbols-outlined text-[16px] text-primary">gif_box</span>
                            <span class="text-[10px] text-on-surface">GIF</span>
                        </button>
                        <button class="flex items-center gap-2 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="toggleRecordingDialog()">
                            <span class="material-symbols-outlined text-[16px] text-primary">screen_record</span>
                            <span class="text-[10px] text-on-surface">Record</span>
                        </button>
                    </div>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Media</span>
            </div>

            <!-- Group: Text -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <button class="ribbon-button" onclick="addNewTextClip('Heading')">
                        <span class="material-symbols-outlined text-[24px] text-primary">title</span>
                        <span class="text-[11px] text-on-surface font-semibold">Heading</span>
                    </button>
                    <div class="grid grid-cols-2 gap-x-2 gap-y-0.5">
                        <button class="flex items-center gap-1 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="addNewTextClip('Textbox')">
                            <span class="material-symbols-outlined text-[16px] text-primary">text_fields</span>
                            <span class="text-[10px] text-on-surface">Text Box</span>
                        </button>
                        <button class="flex items-center gap-1 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="addNewTextClip('Caption')">
                            <span class="material-symbols-outlined text-[16px] text-primary">closed_caption</span>
                            <span class="text-[10px] text-on-surface">Caption</span>
                        </button>
                        <button class="flex items-center gap-1 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="insertSymbol('SlideNumber')">
                            <span class="material-symbols-outlined text-[16px] text-primary">pin</span>
                            <span class="text-[10px] text-on-surface">Counter</span>
                        </button>
                        <button class="flex items-center gap-1 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="insertSymbol('DateTime')">
                            <span class="material-symbols-outlined text-[16px] text-primary">timer</span>
                            <span class="text-[10px] text-on-surface">Timer</span>
                        </button>
                    </div>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Text</span>
            </div>

            <!-- Group: Shapes -->
            <div class="flex flex-col justify-between items-center px-3 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <button class="ribbon-button" onclick="insertShape('Rectangle')">
                        <span class="material-symbols-outlined text-[24px] text-primary">rectangle</span>
                        <span class="text-[11px] text-on-surface font-semibold">Rectangle</span>
                    </button>
                    <div class="grid grid-cols-2 gap-x-2 gap-y-0.5">
                        <button class="flex items-center gap-1 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="insertShape('Circle')">
                            <span class="material-symbols-outlined text-[16px] text-primary">circle</span>
                            <span class="text-[10px] text-on-surface">Circle</span>
                        </button>
                        <button class="flex items-center gap-1 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="insertShape('Arrow')">
                            <span class="material-symbols-outlined text-[16px] text-primary">trending_flat</span>
                            <span class="text-[10px] text-on-surface">Arrow</span>
                        </button>
                        <button class="flex items-center gap-1 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="insertShape('Line')">
                            <span class="material-symbols-outlined text-[16px] text-primary">horizontal_rule</span>
                            <span class="text-[10px] text-on-surface">Line</span>
                        </button>
                        <button class="flex items-center gap-1 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="insertShape('Callout')">
                            <span class="material-symbols-outlined text-[16px] text-primary">chat_bubble</span>
                            <span class="text-[10px] text-on-surface">Callout</span>
                        </button>
                    </div>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Shapes</span>
            </div>
        </div>
        
        <!-- DESIGN TAB GROUPS -->
        <div id="ribbon-group-design" class="ribbon-group-container hidden flex items-stretch">
            <!-- Group: Canvas Aspect Ratios -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center gap-1">
                    <button class="ribbon-button" onclick="setAspectRatio(16, 9)">
                        <span class="material-symbols-outlined text-[24px] text-primary">aspect_ratio</span>
                        <span class="text-[11px] text-on-surface">16:9</span>
                    </button>
                    <button class="ribbon-button" onclick="setAspectRatio(9, 16)">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">stay_current_portrait</span>
                        <span class="text-[11px] text-on-surface">9:16</span>
                    </button>
                    <button class="ribbon-button" onclick="setAspectRatio(1, 1)">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">crop_square</span>
                        <span class="text-[11px] text-on-surface">1:1</span>
                    </button>
                    <button class="ribbon-button" onclick="setAspectRatio(4, 5)">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">crop_portrait</span>
                        <span class="text-[11px] text-on-surface">4:5</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Canvas</span>
            </div>
            
            <!-- Group: Theme -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <button class="ribbon-button" onclick="applyThemePreset('default')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">palette</span>
                        <span class="text-[11px] text-on-surface">Colors</span>
                    </button>
                    <button class="ribbon-button" onclick="applyThemePreset('classic')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">font_download</span>
                        <span class="text-[11px] text-on-surface">Fonts</span>
                    </button>
                    <button class="ribbon-button" onclick="applyThemePreset('modern')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">dashboard_customize</span>
                        <span class="text-[11px] text-on-surface">Presets</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Theme</span>
            </div>

            <!-- Group: Background -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="grid grid-cols-2 gap-x-2 gap-y-0.5 items-center justify-center flex-1">
                    <button class="flex items-center gap-2 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="changeBackgroundType('solid')">
                        <span class="material-symbols-outlined text-[16px] text-on-surface-variant">format_color_fill</span>
                        <span class="text-[10px] text-on-surface">Solid</span>
                    </button>
                    <button class="flex items-center gap-2 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="changeBackgroundType('gradient')">
                        <span class="material-symbols-outlined text-[16px] text-on-surface-variant">gradient</span>
                        <span class="text-[10px] text-on-surface">Gradient</span>
                    </button>
                    <button class="flex items-center gap-2 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="changeBackgroundType('image')">
                        <span class="material-symbols-outlined text-[16px] text-on-surface-variant">image</span>
                        <span class="text-[10px] text-on-surface">Image</span>
                    </button>
                    <button class="flex items-center gap-2 hover:bg-surface-container-high px-2 py-0.5 rounded transition-colors text-left" onclick="changeBackgroundType('blur')">
                        <span class="material-symbols-outlined text-[16px] text-on-surface-variant">blur_on</span>
                        <span class="text-[10px] text-on-surface">Blur</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Background</span>
            </div>

            <!-- Group: Brand Kit -->
            <div class="flex flex-col items-center justify-between px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex gap-2 items-center h-full">
                    <button class="flex flex-col items-center gap-1 p-2 bg-primary-container/10 text-primary rounded w-16" onclick="applyBrandKit()">
                        <span class="material-symbols-outlined text-2xl">auto_awesome_motion</span>
                        <span class="text-[10px] font-bold">Brand</span>
                    </button>
                    <div class="flex flex-col gap-1">
                        <button class="flex items-center gap-1 px-2 py-0.5 hover:bg-surface-container-high rounded text-left" onclick="uploadBrandAsset('logo')">
                            <span class="material-symbols-outlined text-xs text-on-surface-variant">id_card</span>
                            <span class="text-[10px] text-on-surface">Logo</span>
                        </button>
                        <button class="flex items-center gap-1 px-2 py-0.5 hover:bg-surface-container-high rounded text-left" onclick="uploadBrandAsset('font')">
                            <span class="material-symbols-outlined text-xs text-on-surface-variant">text_fields</span>
                            <span class="text-[10px] text-on-surface">Font</span>
                        </button>
                        <button class="flex items-center gap-1 px-2 py-0.5 hover:bg-surface-container-high rounded text-left" onclick="uploadBrandAsset('colors')">
                            <span class="material-symbols-outlined text-xs text-on-surface-variant">brush</span>
                            <span class="text-[10px] text-on-surface">Colors</span>
                        </button>
                    </div>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Brand Kit</span>
            </div>

            <!-- Group: Safe zones -->
            <div class="flex flex-col justify-between items-center px-3 min-w-fit">
                <div class="flex-1 flex items-center justify-center gap-1">
                    <button class="ribbon-button" id="toggleSafeAreaBtnDesign" onclick="toggleSafeAreaGuide()">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">square_foot</span>
                        <span class="text-[11px] text-on-surface">Safe Zones</span>
                    </button>
                    <div class="flex flex-col gap-0.5 border-r border-outline-variant/30 pr-2 mr-2">
                        <button class="text-[9px] px-1 py-0.5 hover:bg-surface-container-high rounded text-left" onclick="selectSafeZonePlatform('YouTube')">YouTube (16:9)</button>
                        <button class="text-[9px] px-1 py-0.5 hover:bg-surface-container-high rounded text-left" onclick="selectSafeZonePlatform('TikTok')">TikTok (9:16)</button>
                        <button class="text-[9px] px-1 py-0.5 hover:bg-surface-container-high rounded text-left" onclick="selectSafeZonePlatform('Instagram')">Instagram (1:1)</button>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <label class="text-[9px] flex items-center gap-1 cursor-pointer"><input type="checkbox" checked onchange="window.toggleSafeZoneItem('title', this.checked)"> Title Safe</label>
                        <label class="text-[9px] flex items-center gap-1 cursor-pointer"><input type="checkbox" checked onchange="window.toggleSafeZoneItem('action', this.checked)"> Action Safe</label>
                        <label class="text-[9px] flex items-center gap-1 cursor-pointer"><input type="checkbox" checked onchange="window.toggleSafeZoneItem('caption', this.checked)"> Caption Safe</label>
                        <label class="text-[9px] flex items-center gap-1 cursor-pointer"><input type="checkbox" checked onchange="window.toggleSafeZoneItem('danger', this.checked)"> UI Danger</label>
                    </div>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Safe Zones</span>
            </div>
        </div>
        
        <!-- TRANSITIONS TAB GROUPS -->
        <div id="ribbon-group-transitions" class="ribbon-group-container hidden flex items-stretch">
            <!-- Group: Preview -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center justify-center">
                    <button class="ribbon-button" onclick="playTransitionPreview()">
                        <span class="material-symbols-outlined text-[24px] text-primary">play_circle</span>
                        <span class="text-[11px] text-on-surface">Preview</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Preview</span>
            </div>

            <!-- Group: Gallery -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex gap-2 items-center flex-1 px-1">
                    <button class="flex flex-col items-center p-1 w-16 hover:bg-surface-container-high transition-colors rounded cursor-pointer animate-in fade-in" onclick="setTransition('None')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">block</span>
                        <span class="text-[10px] text-on-surface">None</span>
                    </button>
                    <button class="flex flex-col items-center p-1 w-16 hover:bg-surface-container-high transition-colors rounded cursor-pointer transition-card-active animate-in fade-in" onclick="setTransition('Fade')">
                        <span class="material-symbols-outlined text-[24px] text-primary">blur_on</span>
                        <span class="text-[10px] text-on-surface">Fade</span>
                    </button>
                    <button class="flex flex-col items-center p-1 w-16 hover:bg-surface-container-high transition-colors rounded cursor-pointer animate-in fade-in" onclick="setTransition('Dissolve')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">texture</span>
                        <span class="text-[10px] text-on-surface">Dissolve</span>
                    </button>
                    <button class="flex flex-col items-center p-1 w-16 hover:bg-surface-container-high transition-colors rounded cursor-pointer animate-in fade-in" onclick="setTransition('Push')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">arrow_forward</span>
                        <span class="text-[10px] text-on-surface">Push</span>
                    </button>
                    <button class="flex flex-col items-center p-1 w-16 hover:bg-surface-container-high transition-colors rounded cursor-pointer animate-in fade-in" onclick="setTransition('Wipe')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">horizontal_distribute</span>
                        <span class="text-[10px] text-on-surface">Wipe</span>
                    </button>
<!-- Morph removed: TransitionEngine.applyTransition has no case for it, so it
                         fell through to the default branch and silently produced a hard cut.
                         Verified by passing an invalid transition name, which rendered
                         identically. Reinstate this button if a renderMorph is added. -->
                    <button class="flex flex-col items-center p-1 w-16 hover:bg-surface-container-high transition-colors rounded cursor-pointer animate-in fade-in" onclick="setTransition('Split')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">call_split</span>
                        <span class="text-[10px] text-on-surface">Split</span>
                    </button>
                    <button class="flex flex-col items-center p-1 w-16 hover:bg-surface-container-high transition-colors rounded cursor-pointer animate-in fade-in" onclick="setTransition('Reveal')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">visibility</span>
                        <span class="text-[10px] text-on-surface">Reveal</span>
                    </button>
                    <button class="flex flex-col items-center p-1 w-16 hover:bg-surface-container-high transition-colors rounded cursor-pointer animate-in fade-in" onclick="setTransition('Cut')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">content_cut</span>
                        <span class="text-[10px] text-on-surface">Cut</span>
                    </button>
                    <button class="flex flex-col items-center p-1 w-16 hover:bg-surface-container-high transition-colors rounded cursor-pointer animate-in fade-in" onclick="setTransition('Random')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">casino</span>
                        <span class="text-[10px] text-on-surface">Random</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Transition Gallery</span>
            </div>

            <!-- Group: Options -->
            <div class="flex flex-col justify-between items-center px-3 min-w-fit">
                <div class="grid grid-cols-2 gap-x-4 gap-y-1 w-full h-full pt-1 flex-1 items-center">
                    <div class="flex flex-col gap-1">
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] w-12 text-on-surface-variant">Duration:</span>
                            <div class="flex items-center bg-white border border-outline-variant rounded px-1 h-5 w-20">
                                <input class="w-full text-[10px] focus:outline-none border-none p-0 bg-transparent text-on-surface" type="text" id="transitionDurationInput" value="01.50" oninput="updateTransitionDuration(this.value)">
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] w-12 text-on-surface-variant">Sound:</span>
                            <select class="text-[10px] border border-outline-variant rounded px-1 h-5 w-20 bg-white" id="transitionSoundSelect" onchange="applyTransitionSound(this.value)">
                                <option value="none">[None]</option>
                                <option value="swoosh">Swoosh</option>
                                <option value="click">Click</option>
                                <option value="chime">Chime</option>
                            </select>
                        </div>
                    </div>
                    <div class="flex flex-col gap-1">
                        <button class="bg-surface hover:bg-surface-container-high border border-outline-variant rounded h-5 px-2 flex items-center gap-1 transition-colors" onclick="applyTransitionToSelected()">
                            <span class="material-symbols-outlined text-[12px]">done</span>
                            <span class="text-[9px] whitespace-nowrap">Apply Selected</span>
                        </button>
                        <button class="bg-surface hover:bg-surface-container-high border border-outline-variant rounded h-5 px-2 flex items-center gap-1 transition-colors" onclick="applyTransitionToAll()">
                            <span class="material-symbols-outlined text-[12px]">done_all</span>
                            <span class="text-[9px] whitespace-nowrap">Apply To All</span>
                        </button>
                    </div>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Options</span>
            </div>
        </div>
        
        <!-- ANIMATIONS TAB GROUPS -->
        <div id="ribbon-group-animations" class="ribbon-group-container hidden flex items-stretch">
            <!-- Group: Entrance -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <button class="ribbon-button" onclick="setAnimation('entrance', 'Fade')">
                        <span class="material-symbols-outlined text-[24px] text-primary">blur_on</span>
                        <span class="text-[11px] text-on-surface">Fade In</span>
                    </button>
                    <button class="ribbon-button" onclick="setAnimation('entrance', 'Slide')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">arrow_forward</span>
                        <span class="text-[11px] text-on-surface">Slide In</span>
                    </button>
                    <button class="ribbon-button" onclick="setAnimation('entrance', 'Zoom')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">zoom_in</span>
                        <span class="text-[11px] text-on-surface">Zoom In</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Entrance</span>
            </div>
            
            <!-- Group: Exit -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <button class="ribbon-button" onclick="setAnimation('exit', 'Fade')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">blur_off</span>
                        <span class="text-[11px] text-on-surface">Fade Out</span>
                    </button>
                    <button class="ribbon-button" onclick="setAnimation('exit', 'Slide')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">arrow_back</span>
                        <span class="text-[11px] text-on-surface">Slide Out</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Exit</span>
            </div>

            <!-- Group: Emphasis -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <button class="ribbon-button" onclick="setAnimation('emphasis', 'Pulse')">
                        <span class="material-symbols-outlined text-[24px] text-tertiary-container">flare</span>
                        <span class="text-[11px] text-on-surface">Pulse</span>
                    </button>
                    <button class="ribbon-button" onclick="setAnimation('emphasis', 'Rotate')">
                        <span class="material-symbols-outlined text-[24px] text-tertiary-container">rotate_right</span>
                        <span class="text-[11px] text-on-surface">Rotate</span>
                    </button>
                    <button class="ribbon-button" onclick="setAnimation('emphasis', 'Scale')">
                        <span class="material-symbols-outlined text-[24px] text-tertiary-container">aspect_ratio</span>
                        <span class="text-[11px] text-on-surface">Scale</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Emphasis</span>
            </div>

            <!-- Group: Animation Pane Controls -->
            <div class="flex flex-col justify-between items-center px-3 min-w-fit">
                <div class="flex-1 flex gap-2 items-center">
                    <button class="flex flex-col items-center justify-center px-3 py-1 hover:bg-surface-container-high rounded" onclick="toggleAnimationPane()">
                        <span class="material-symbols-outlined text-[28px] text-on-surface-variant">view_sidebar</span>
                        <span class="text-[10px] text-on-surface">Anim List</span>
                    </button>
                    <div class="flex flex-col justify-center gap-1">
                        <div class="flex items-center gap-2 px-1.5 py-0.5 bg-surface-container rounded border border-outline-variant/30">
                            <span class="text-[9px] uppercase text-outline">Delay:</span>
                            <input class="bg-transparent border-none p-0 w-10 text-right text-[10px] focus:ring-0 text-on-surface" type="text" id="animationDelayInput" value="0.00s" onchange="updateAnimationParameters()">
                        </div>
                        <div class="flex items-center gap-2 px-1.5 py-0.5 bg-surface-container rounded border border-outline-variant/30">
                            <span class="text-[9px] uppercase text-outline">Dur:</span>
                            <input class="bg-transparent border-none p-0 w-10 text-right text-[10px] focus:ring-0 text-on-surface" type="text" id="animationDurationInput" value="0.50s" onchange="updateAnimationParameters()">
                        </div>
                    </div>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Animation Pane</span>
            </div>
        </div>
        
        <!-- VIEW TAB GROUPS -->
        <div id="ribbon-group-view" class="ribbon-group-container hidden flex items-stretch">
            <!-- Group: Themes & Modes -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <button class="ribbon-button" onclick="setAppTheme('dark')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">dark_mode</span>
                        <span class="text-[11px] text-on-surface">Dark Mode</span>
                    </button>
                    <button class="ribbon-button" onclick="setAppTheme('light')">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">light_mode</span>
                        <span class="text-[11px] text-on-surface">Light Mode</span>
                    </button>
                    <button class="ribbon-button" onclick="resetLayout()">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">restart_alt</span>
                        <span class="text-[11px] text-on-surface">Reset Layout</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Application View</span>
            </div>

            <!-- Group: Guides & Indicators -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <label class="flex items-center gap-1.5 cursor-pointer text-xs">
                        <input type="checkbox" id="chkShowGrid" checked onchange="toggleViewElement('grid', this.checked)" class="rounded border-outline-variant text-primary focus:ring-primary h-3.5 w-3.5">
                        <span class="text-on-surface">Gridlines</span>
                    </label>
                    <label class="flex items-center gap-1.5 cursor-pointer text-xs">
                        <input type="checkbox" id="chkShowGuides" checked onchange="toggleViewElement('guides', this.checked)" class="rounded border-outline-variant text-primary focus:ring-primary h-3.5 w-3.5">
                        <span class="text-on-surface">Guides</span>
                    </label>
                    <label class="flex items-center gap-1.5 cursor-pointer text-xs">
                        <input type="checkbox" id="chkShowLayers" checked onchange="toggleViewElement('layers', this.checked)" class="rounded border-outline-variant text-primary focus:ring-primary h-3.5 w-3.5">
                        <span class="text-on-surface">Layers Bin</span>
                    </label>
                    <label class="flex items-center gap-1.5 cursor-pointer text-xs">
                        <input type="checkbox" id="chkMagneticSnapping" checked onchange="toggleMagneticSnapping(this.checked)" class="rounded border-outline-variant text-primary focus:ring-primary h-3.5 w-3.5">
                        <span class="text-on-surface">Snapping</span>
                    </label>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Show / Hide</span>
            </div>

            <!-- Group: Zoom -->
            <div class="flex flex-col justify-between items-center px-3 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <button class="ribbon-button" onclick="adjustZoom(-5)">
                        <span class="material-symbols-outlined text-[20px]">zoom_out</span>
                        <span class="text-[11px] text-on-surface">Zoom Out</span>
                    </button>
                    <span class="text-xs font-bold text-on-surface" id="ribbonZoomLabel">20%</span>
                    <button class="ribbon-button" onclick="adjustZoom(5)">
                        <span class="material-symbols-outlined text-[20px]">zoom_in</span>
                        <span class="text-[11px] text-on-surface">Zoom In</span>
                    </button>
                    <button class="ribbon-button" onclick="zoomFitToScreen()">
                        <span class="material-symbols-outlined text-[20px]">fit_screen</span>
                        <span class="text-[11px] text-on-surface">Fit View</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Zoom</span>
            </div>
        </div>
        
        <!-- BULK PRODUCTION TAB GROUPS -->
        <div id="ribbon-group-bulk" class="ribbon-group-container hidden flex items-stretch">
            <!-- Group: CSV -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <button class="ribbon-button relative">
                        <span class="material-symbols-outlined text-[24px] text-primary">upload_file</span>
                        <span class="text-[11px] text-on-surface font-semibold">Import CSV</span>
                        <input type="file" id="bulkCsvFileInput" accept=".csv" class="absolute inset-0 opacity-0 cursor-pointer">
                    </button>
                    <button class="ribbon-button" onclick="openColumnMapper()">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">view_column</span>
                        <span class="text-[11px] text-on-surface">Map Columns</span>
                    </button>
                    <button class="ribbon-button" onclick="validateCsvMapping()">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">fact_check</span>
                        <span class="text-[11px] text-on-surface">Validate</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">CSV Config</span>
            </div>

            <!-- Group: Preview Variations -->
            <div class="flex flex-col justify-between items-center px-3 border-r border-outline-variant/50 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <button class="ribbon-button" onclick="generateSampleVariation()">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">science</span>
                        <span class="text-[11px] text-on-surface">Gen Sample</span>
                    </button>
                    <button class="ribbon-button" onclick="openBatchGalleryOverlay()">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">collections</span>
                        <span class="text-[11px] text-on-surface font-semibold">Variation Grid</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Preview Variations</span>
            </div>

            <!-- Group: Batch Production -->
            <div class="flex flex-col justify-between items-center px-3 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <button class="ribbon-button bg-primary/10 hover:bg-primary/20 transition-colors border border-primary/20 rounded px-3 py-1" onclick="startBulkExport()">
                        <span class="material-symbols-outlined text-[24px] text-primary" style="font-variation-settings: 'FILL' 1;">play_circle</span>
                        <span class="text-[11px] font-bold text-primary">Generate Batch</span>
                    </button>
                    <div class="flex flex-col gap-1 justify-center">
                        <button class="flex items-center gap-1.5 px-2 py-0.5 hover:bg-surface-container-high rounded" onclick="retryFailedBatchJobs()">
                            <span class="material-symbols-outlined text-sm">replay</span>
                            <span class="text-[10px] text-on-surface">Retry Failed</span>
                        </button>
                        <button class="flex items-center gap-1.5 px-2 py-0.5 hover:bg-surface-container-high rounded text-error" onclick="cancelBatchExport()">
                            <span class="material-symbols-outlined text-sm">cancel</span>
                            <span class="text-[10px] text-error font-medium">Cancel All</span>
                        </button>
                    </div>
                    <button class="ribbon-button" id="bulkDownloadTemplateBtn">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">download_for_offline</span>
                        <span class="text-[11px] text-on-surface">Get Template</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Batch Engine</span>
            </div>
        </div>

        <!-- HELP TAB GROUPS -->
        <div id="ribbon-group-help" class="ribbon-group-container hidden flex items-stretch">
            <div class="flex flex-col justify-between items-center px-3 min-w-fit">
                <div class="flex-1 flex items-center gap-2">
                    <button class="ribbon-button" onclick="openHelpCenter()">
                        <span class="material-symbols-outlined text-[24px] text-primary">help</span>
                        <span class="text-[11px] text-on-surface">Help Center</span>
                    </button>
                    <button class="ribbon-button" onclick="showAboutDialog()">
                        <span class="material-symbols-outlined text-[24px] text-on-surface-variant">info</span>
                        <span class="text-[11px] text-on-surface">About</span>
                    </button>
                </div>
                <span class="font-ribbon-group-label text-ribbon-group-label text-on-surface-variant/60 uppercase tracking-wider py-0.5">Support</span>
            </div>
        </div>
        
        </div><!-- /fcRibbonScroll -->

        <!-- Export/Preview Ribbon Buttons Fixed on Right -->
        <div class="fc-ribbon-actions ml-auto flex items-center gap-3 pr-2 border-l border-outline-variant/30 pl-4">
            <button class="fc-ribbon-action flex items-center gap-2 px-4 py-2 hover:bg-surface-container-highest transition-colors rounded-lg text-on-surface bg-transparent border-none cursor-pointer" onclick="togglePlay()">
                <span class="material-symbols-outlined text-lg">play_circle</span>
                <span class="fc-action-label font-medium text-xs">Preview</span>
            </button>
            <button class="fc-ribbon-action flex items-center gap-2 px-6 py-2 bg-primary text-white font-bold rounded-lg hover:shadow-lg transition-all active:scale-95 cursor-pointer border-none" onclick="startBulkExport()">
                <span class="material-symbols-outlined text-lg">upload</span>
                <span class="fc-action-label text-xs">Export</span>
            </button>
            <!-- Ribbon display options (Word's "Ribbon Display Options" chevron) -->
            <button id="fcRibbonDisplayBtn" class="fc-ribbon-display-btn" title="Ribbon Display Options" aria-haspopup="menu" aria-expanded="false">
                <span class="material-symbols-outlined">keyboard_arrow_down</span>
            </button>
        </div>
    </div>
</header>
        `;
    }
}

customElements.define('forgecut-header', ForgeCutHeader);
