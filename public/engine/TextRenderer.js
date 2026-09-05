/**
 * ForgeCut TextRenderer — Advanced typography rendering for canvas.
 * Supports: font loading, weight, italic, underline, letter spacing,
 * line height, stroke, shadow, background highlight, text alignment,
 * multi-line parsing, and text wrapping.
 */
(function() {
    'use strict';

    const DEFAULT_TEXT_PROPS = {
        font: 'Arial',
        size: 72,
        color: '#ffffff',
        weight: 'bold',
        italic: false,
        underline: false,
        letterSpacing: 0,
        lineHeight: 1.3,
        strokeColor: null,
        strokeWidth: 0,
        shadow: { color: 'rgba(0,0,0,0.85)', blur: 12, offsetX: 0, offsetY: 4 },
        backgroundColor: null,
        backgroundPadding: 8,
        textAlign: 'center',
        maxWidth: 0,        // 0 = no wrapping
        verticalAlign: 'middle'
    };

    /**
     * Build CSS font string from clip properties.
     */
    function buildFontString(clip) {
        const props = getTextProps(clip);
        let fontStr = '';
        if (props.italic) fontStr += 'italic ';
        fontStr += (props.weight || 'bold') + ' ';
        fontStr += (props.size || 72) + 'px ';
        fontStr += (props.font || 'Arial');
        return fontStr;
    }

    function getTextProps(clip) {
        return Object.assign({}, DEFAULT_TEXT_PROPS, {
            font: clip.font || DEFAULT_TEXT_PROPS.font,
            size: clip.size || DEFAULT_TEXT_PROPS.size,
            color: clip.color || DEFAULT_TEXT_PROPS.color,
            weight: clip.fontWeight || DEFAULT_TEXT_PROPS.weight,
            italic: clip.italic || false,
            underline: clip.underline || false,
            letterSpacing: clip.letterSpacing || 0,
            lineHeight: clip.lineHeight || DEFAULT_TEXT_PROPS.lineHeight,
            strokeColor: clip.strokeColor || null,
            strokeWidth: clip.textStrokeWidth !== undefined ? clip.textStrokeWidth : 0,
            shadow: {
                color: clip.shadowColor !== undefined ? clip.shadowColor : (clip.textShadow ? clip.textShadow.color : 'rgba(0,0,0,0.85)'),
                blur: clip.shadowBlur !== undefined ? clip.shadowBlur : (clip.textShadow ? clip.textShadow.blur : 12),
                offsetX: clip.shadowOffsetX !== undefined ? clip.shadowOffsetX : (clip.textShadow ? clip.textShadow.offsetX : 0),
                offsetY: clip.shadowOffsetY !== undefined ? clip.shadowOffsetY : (clip.textShadow ? clip.textShadow.offsetY : 4)
            },
            backgroundColor: clip.textBackground || null,
            backgroundPadding: clip.textBackgroundPadding || 8,
            textAlign: clip.textAlign || 'center',
            maxWidth: clip.maxWidth || 0
        });
    }

    /**
     * Wrap text into lines respecting maxWidth.
     */
    function wrapText(ctx, text, maxWidth) {
        if (!maxWidth || maxWidth <= 0) {
            return text.split('\n');
        }

        const rawLines = text.split('\n');
        const wrappedLines = [];

        for (const rawLine of rawLines) {
            const words = rawLine.split(' ');
            let currentLine = '';

            for (const word of words) {
                const testLine = currentLine ? (currentLine + ' ' + word) : word;
                const metrics = ctx.measureText(testLine);

                if (metrics.width > maxWidth && currentLine) {
                    wrappedLines.push(currentLine);
                    currentLine = word;
                } else {
                    currentLine = testLine;
                }
            }
            wrappedLines.push(currentLine);
        }

        return wrappedLines;
    }

    /**
     * Draw text with letter spacing (character-by-character for non-zero spacing).
     */
    function drawTextWithSpacing(ctx, text, x, y, letterSpacing, fill) {
        if (!letterSpacing || letterSpacing === 0) {
            if (fill) ctx.fillText(text, x, y);
            else ctx.strokeText(text, x, y);
            return;
        }

        // Measure total width for alignment
        let totalWidth = 0;
        for (let i = 0; i < text.length; i++) {
            totalWidth += ctx.measureText(text[i]).width + letterSpacing;
        }
        totalWidth -= letterSpacing;

        let offsetX = 0;
        const align = ctx.textAlign;
        if (align === 'center') offsetX = -totalWidth / 2;
        else if (align === 'right') offsetX = -totalWidth;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (fill) ctx.fillText(char, x + offsetX, y);
            else ctx.strokeText(char, x + offsetX, y);
            offsetX += ctx.measureText(char).width + letterSpacing;
        }
    }

    /**
     * Render text clip onto canvas context.
     * @param {CanvasRenderingContext2D} ctx
     * @param {Object} clip - The text clip data
     * @param {number} canvasWidth
     * @param {number} canvasHeight
     * @param {Object} [activeRow] - CSV row data for placeholder substitution
     * @param {Array} [placeholders] - List of placeholder names
     */
    function renderText(ctx, clip, canvasWidth, canvasHeight, activeRow, placeholders) {
        let text = clip.text || '';

        // Placeholder substitution
        if (activeRow && placeholders) {
            placeholders.forEach(ph => {
                const val = activeRow[ph] || activeRow[`{${ph}}`] || activeRow[`{{${ph}}}`] || '';
                text = text.replaceAll(`{{${ph}}}`, val);
                text = text.replaceAll(`{${ph}}`, val);
            });
        }

        if (!text) return;

        const props = getTextProps(clip);
        const x = clip.x !== undefined ? clip.x : canvasWidth / 2;
        const y = clip.y !== undefined ? clip.y : canvasHeight / 2;
        const rotation = clip.rotation || 0;

        ctx.save();
        ctx.globalAlpha = clip.opacity !== undefined ? clip.opacity : 1.0;
        ctx.translate(x, y);
        if (rotation) ctx.rotate(rotation * Math.PI / 180);

        // Set font
        ctx.font = buildFontString(clip);
        ctx.textAlign = props.textAlign;
        ctx.textBaseline = 'middle';

        // Wrap text
        const maxW = props.maxWidth > 0 ? props.maxWidth : 0;
        const lines = wrapText(ctx, text, maxW);
        const lineHeightPx = props.size * props.lineHeight;
        const totalHeight = lines.length * lineHeightPx;
        const startY = -totalHeight / 2 + lineHeightPx / 2;

        // Draw background highlight
        if (props.backgroundColor) {
            const pad = props.backgroundPadding;
            let maxLineWidth = 0;
            for (const line of lines) {
                const lw = ctx.measureText(line).width;
                if (lw > maxLineWidth) maxLineWidth = lw;
            }
            ctx.fillStyle = props.backgroundColor;
            const bgX = props.textAlign === 'center' ? -maxLineWidth/2 - pad :
                         props.textAlign === 'right' ? -maxLineWidth - pad : -pad;
            ctx.fillRect(bgX, startY - lineHeightPx/2 - pad, maxLineWidth + pad*2, totalHeight + pad*2);
        }

        // Apply shadow
        if (props.shadow) {
            ctx.shadowColor = props.shadow.color || 'rgba(0,0,0,0.85)';
            ctx.shadowBlur = props.shadow.blur || 12;
            ctx.shadowOffsetX = props.shadow.offsetX || 0;
            ctx.shadowOffsetY = props.shadow.offsetY || 4;
        }

        // Draw each line
        for (let i = 0; i < lines.length; i++) {
            const ly = startY + i * lineHeightPx;
            const line = lines[i];

            // Stroke
            if (props.strokeColor && props.strokeWidth > 0) {
                ctx.strokeStyle = props.strokeColor;
                ctx.lineWidth = props.strokeWidth;
                ctx.lineJoin = 'round';
                drawTextWithSpacing(ctx, line, 0, ly, props.letterSpacing, false);
            }

            // Fill
            if (clip.colorType === 'gradient') {
                const startColor = clip.gradientStartColor || '#ff007f';
                const endColor = clip.gradientEndColor || '#7f00ff';
                const grad = ctx.createLinearGradient(0, ly - props.size / 2, 0, ly + props.size / 2);
                grad.addColorStop(0, startColor);
                grad.addColorStop(1, endColor);
                ctx.fillStyle = grad;
            } else {
                ctx.fillStyle = props.color;
            }
            drawTextWithSpacing(ctx, line, 0, ly, props.letterSpacing, true);

            // Underline
            if (props.underline) {
                const metrics = ctx.measureText(line);
                const lineWidth = metrics.width;
                let ulX = 0;
                if (props.textAlign === 'center') ulX = -lineWidth / 2;
                else if (props.textAlign === 'right') ulX = -lineWidth;

                ctx.beginPath();
                ctx.moveTo(ulX, ly + props.size * 0.15);
                ctx.lineTo(ulX + lineWidth, ly + props.size * 0.15);
                ctx.strokeStyle = props.color;
                ctx.lineWidth = Math.max(1, props.size * 0.04);
                ctx.stroke();
            }
        }

        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        ctx.restore();

        // Return bounding box info for hit-testing
        return {
            x, y,
            width: maxW || ctx.measureText(text).width + 40,
            height: totalHeight + 20
        };
    }

    /**
     * Measure text bounding box without drawing.
     */
    function measureText(ctx, clip, placeholders, activeRow) {
        let text = clip.text || '';
        if (activeRow && placeholders) {
            placeholders.forEach(ph => {
                const val = activeRow[ph] || '';
                text = text.replaceAll(`{{${ph}}}`, val);
                text = text.replaceAll(`{${ph}}`, val);
            });
        }

        ctx.font = buildFontString(clip);
        const props = getTextProps(clip);
        const maxW = props.maxWidth > 0 ? props.maxWidth : 0;
        const lines = wrapText(ctx, text, maxW);
        const lineHeightPx = props.size * props.lineHeight;

        let maxLineWidth = 0;
        for (const line of lines) {
            const w = ctx.measureText(line).width;
            if (w > maxLineWidth) maxLineWidth = w;
        }

        return {
            width: maxLineWidth + 40,
            height: lines.length * lineHeightPx + 20
        };
    }

    /**
     * Get all available font families (system + loaded custom fonts).
     */
    function getAvailableFonts() {
        const systemFonts = ['Inter', 'Arial', 'Helvetica', 'Roboto', 'Open Sans',
            'Montserrat', 'Poppins', 'Lato', 'Bebas Neue', 'Playfair Display'];
        const customFonts = (window.state && window.state.customFonts) ? window.state.customFonts : [];
        return [...new Set([...systemFonts, ...customFonts])];
    }

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.TextRenderer = {
        renderText,
        measureText,
        buildFontString,
        wrapText,
        getAvailableFonts,
        getTextProps,
        DEFAULT_TEXT_PROPS
    };
})();
