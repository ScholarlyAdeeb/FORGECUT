/**
 * ForgeCut ShapeRenderer — Procedural vector shape drawing for canvas.
 * Supports: PowerPoint-style shape categories, image/pattern fills, outline styling, reflections, glows, blur.
 */
(function() {
    'use strict';

    const DEFAULT_PROPS = {
        fill: '#ffc107',
        stroke: '#000000',
        strokeWidth: 0,
        opacity: 1.0,
        rotation: 0,
        shadow: null,        // { color, blur, offsetX, offsetY }
        cornerRadius: 0,     // For rounded rectangle
        sides: 5,            // For polygon
        innerRadius: 0.4,    // For star (ratio of outer radius)
        points: 5,           // For star
        arrowHeadSize: 20,   // For arrow
        calloutRadius: 10,   // For callout bubble corner
        calloutTailWidth: 20,
        calloutTailHeight: 30,
        fillType: 'solid',   // 'solid', 'gradient', 'pattern', 'image'
        gradientStartColor: '#ffc107',
        gradientEndColor: '#ff5722',
        patternType: 'stripes', // 'stripes', 'grid', 'dots'
        patternColor: '#ffffff',
        fillImage: '',       // Object URL or data URL
        strokeStyle: 'solid', // 'solid', 'dashed', 'dotted'
        strokeDashPattern: [12, 6],
        blur: 0,
        glow: null,          // { color, size }
        reflection: false
    };

    const CATEGORIES = {
        'Recently Used': ['Rectangle', 'Rounded Rectangle', 'Circle', 'Arrow', 'Star'],
        'Lines': ['Line', 'Arrow Line', 'Double Arrow Line'],
        'Rectangles': ['Rectangle', 'Rounded Rectangle', 'Single Corner Snipped Rectangle', 'Snip and Round Single Corner Rectangle'],
        'Basic Shapes': ['Circle', 'Ellipse', 'Triangle', 'Polygon', 'Diamond', 'Parallelogram', 'Trapezoid', 'Hexagon', 'Octagon', 'Heart'],
        'Block Arrows': ['Arrow', 'Left Arrow', 'Up Arrow', 'Down Arrow'],
        'Flowchart': ['Flowchart Process', 'Flowchart Decision', 'Flowchart Data', 'Flowchart Terminal'],
        'Stars & Banners': ['Star', '4-Point Star', '6-Point Star', '8-Point Star'],
        'Callouts': ['Callout', 'Oval Callout']
    };

    function applyTransform(ctx, x, y, w, h, rotation) {
        ctx.translate(x, y);
        if (rotation) {
            ctx.rotate(rotation * Math.PI / 180);
        }
    }

    function createPattern(ctx, type, color = '#ffffff') {
        const pCanvas = document.createElement('canvas');
        pCanvas.width = 16;
        pCanvas.height = 16;
        const pCtx = pCanvas.getContext('2d');
        pCtx.strokeStyle = color;
        pCtx.lineWidth = 2;
        if (type === 'stripes') {
            pCtx.beginPath();
            pCtx.moveTo(0, 16);
            pCtx.lineTo(16, 0);
            pCtx.stroke();
        } else if (type === 'grid') {
            pCtx.strokeRect(0, 0, 16, 16);
        } else if (type === 'dots') {
            pCtx.fillStyle = color;
            pCtx.beginPath();
            pCtx.arc(8, 8, 3, 0, Math.PI * 2);
            pCtx.fill();
        }
        return ctx.createPattern(pCanvas, 'repeat');
    }

    function fillAndStroke(ctx, props, w, h) {
        if (props.blur > 0) {
            ctx.filter = `blur(${props.blur}px)`;
        }

        if (props.glow && props.glow.size > 0) {
            ctx.shadowColor = props.glow.color || '#ff00ff';
            ctx.shadowBlur = props.glow.size;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        } else if (props.shadow) {
            ctx.shadowColor = props.shadow.color || 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = props.shadow.blur || 8;
            ctx.shadowOffsetX = props.shadow.offsetX || 0;
            ctx.shadowOffsetY = props.shadow.offsetY || 4;
        }

        if (props.strokeStyle === 'dashed') {
            ctx.setLineDash(props.strokeDashPattern || [12, 6]);
        } else if (props.strokeStyle === 'dotted') {
            ctx.setLineDash([3, 3]);
        } else {
            ctx.setLineDash([]);
        }

        // Fill
        if (props.fillType === 'gradient') {
            const startColor = props.gradientStartColor || '#ff9800';
            const endColor = props.gradientEndColor || '#ff5722';
            const g = ctx.createLinearGradient(-w/2, -h/2, w/2, h/2);
            g.addColorStop(0, startColor);
            g.addColorStop(1, endColor);
            ctx.fillStyle = g;
            ctx.fill();
        } else if (props.fillType === 'pattern') {
            ctx.fillStyle = createPattern(ctx, props.patternType || 'stripes', props.patternColor || '#ffffff');
            ctx.fill();
        } else if (props.fillType === 'image' && props.fillImageElement) {
            ctx.save();
            ctx.clip();
            ctx.drawImage(props.fillImageElement, -w/2, -h/2, w, h);
            ctx.restore();
        } else if (props.fill && props.fill !== 'none') {
            ctx.fillStyle = props.fill;
            ctx.fill();
        }

        // Stroke
        if (props.strokeWidth > 0 && props.stroke && props.stroke !== 'none') {
            ctx.strokeStyle = props.stroke;
            ctx.lineWidth = props.strokeWidth;
            ctx.stroke();
        }

        // Reset filter and shadows
        ctx.filter = 'none';
        ctx.setLineDash([]);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
    }

    // ─────────── Shape Renderers ───────────

    function drawRectangle(ctx, x, y, w, h, props) {
        ctx.beginPath();
        ctx.rect(-w/2, -h/2, w, h);
        fillAndStroke(ctx, props, w, h);
    }

    function drawRoundedRectangle(ctx, x, y, w, h, props) {
        const r = Math.min(props.cornerRadius !== undefined ? props.cornerRadius : 20, w/2, h/2);
        ctx.beginPath();
        ctx.moveTo(-w/2 + r, -h/2);
        ctx.lineTo(w/2 - r, -h/2);
        ctx.arcTo(w/2, -h/2, w/2, -h/2 + r, r);
        ctx.lineTo(w/2, h/2 - r);
        ctx.arcTo(w/2, h/2, w/2 - r, h/2, r);
        ctx.lineTo(-w/2 + r, h/2);
        ctx.arcTo(-w/2, h/2, -w/2, h/2 - r, r);
        ctx.lineTo(-w/2, -h/2 + r);
        ctx.arcTo(-w/2, -h/2, -w/2 + r, -h/2, r);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawSnippedRectangle(ctx, x, y, w, h, props) {
        ctx.beginPath();
        const snip = Math.min(props.cornerRadius !== undefined ? props.cornerRadius : 20, w/2, h/2);
        ctx.moveTo(-w/2 + snip, -h/2);
        ctx.lineTo(w/2, -h/2);
        ctx.lineTo(w/2, h/2);
        ctx.lineTo(-w/2, h/2);
        ctx.lineTo(-w/2, -h/2 + snip);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawSnipRoundRectangle(ctx, x, y, w, h, props) {
        ctx.beginPath();
        const snip = Math.min(props.cornerRadius !== undefined ? props.cornerRadius : 20, w/2, h/2);
        ctx.moveTo(-w/2 + snip, -h/2);
        ctx.arcTo(w/2, -h/2, w/2, h/2, snip);
        ctx.lineTo(w/2, h/2);
        ctx.lineTo(-w/2, h/2);
        ctx.lineTo(-w/2, -h/2 + snip);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawCircle(ctx, x, y, w, h, props) {
        const radius = Math.min(w, h) / 2;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        fillAndStroke(ctx, props, w, h);
    }

    function drawEllipse(ctx, x, y, w, h, props) {
        ctx.beginPath();
        ctx.ellipse(0, 0, w/2, h/2, 0, 0, Math.PI * 2);
        fillAndStroke(ctx, props, w, h);
    }

    function drawTriangle(ctx, x, y, w, h, props) {
        ctx.beginPath();
        ctx.moveTo(0, -h/2);
        ctx.lineTo(w/2, h/2);
        ctx.lineTo(-w/2, h/2);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawPolygon(ctx, x, y, w, h, props) {
        const sides = props.sides || 5;
        const radius = Math.min(w, h) / 2;
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
            const px = Math.cos(angle) * radius;
            const py = Math.sin(angle) * radius;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawStar(ctx, x, y, w, h, props) {
        const numPoints = props.points || 5;
        const outerRadius = Math.min(w, h) / 2;
        const innerRadius = outerRadius * (props.innerRadius || 0.4);
        ctx.beginPath();
        for (let i = 0; i < numPoints * 2; i++) {
            const angle = (i * Math.PI / numPoints) - Math.PI / 2;
            const r = i % 2 === 0 ? outerRadius : innerRadius;
            const px = Math.cos(angle) * r;
            const py = Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawDiamond(ctx, x, y, w, h, props) {
        ctx.beginPath();
        ctx.moveTo(0, -h/2);
        ctx.lineTo(w/2, 0);
        ctx.lineTo(0, h/2);
        ctx.lineTo(-w/2, 0);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawParallelogram(ctx, x, y, w, h, props) {
        ctx.beginPath();
        const shift = w * 0.2;
        ctx.moveTo(-w/2 + shift, -h/2);
        ctx.lineTo(w/2, -h/2);
        ctx.lineTo(w/2 - shift, h/2);
        ctx.lineTo(-w/2, h/2);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawTrapezoid(ctx, x, y, w, h, props) {
        ctx.beginPath();
        const shift = w * 0.2;
        ctx.moveTo(-w/2 + shift, -h/2);
        ctx.lineTo(w/2 - shift, -h/2);
        ctx.lineTo(w/2, h/2);
        ctx.lineTo(-w/2, h/2);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawHexagon(ctx, x, y, w, h, props) {
        ctx.beginPath();
        const shift = w * 0.25;
        ctx.moveTo(-w/2 + shift, -h/2);
        ctx.lineTo(w/2 - shift, -h/2);
        ctx.lineTo(w/2, 0);
        ctx.lineTo(w/2 - shift, h/2);
        ctx.lineTo(-w/2 + shift, h/2);
        ctx.lineTo(-w/2, 0);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawOctagon(ctx, x, y, w, h, props) {
        ctx.beginPath();
        const shift = w * 0.29;
        ctx.moveTo(-w/2 + shift, -h/2);
        ctx.lineTo(w/2 - shift, -h/2);
        ctx.lineTo(w/2, -h/2 + shift);
        ctx.lineTo(w/2, h/2 - shift);
        ctx.lineTo(w/2 - shift, h/2);
        ctx.lineTo(-w/2 + shift, h/2);
        ctx.lineTo(-w/2, h/2 - shift);
        ctx.lineTo(-w/2, -h/2 + shift);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawHeart(ctx, x, y, w, h, props) {
        ctx.beginPath();
        const topY = -h/4;
        ctx.moveTo(0, h/2);
        ctx.bezierCurveTo(-w/2, h/8, -w/2, -h/2, -w/4, -h/2);
        ctx.bezierCurveTo(0, -h/2, 0, topY, 0, topY);
        ctx.bezierCurveTo(0, topY, 0, -h/2, w/4, -h/2);
        ctx.bezierCurveTo(w/2, -h/2, w/2, h/8, 0, h/2);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawFlowchartTerminal(ctx, x, y, w, h, props) {
        const r = Math.min(h / 2, w / 2);
        ctx.beginPath();
        ctx.arc(-w/2 + r, 0, r, Math.PI * 0.5, Math.PI * 1.5);
        ctx.arc(w/2 - r, 0, r, Math.PI * 1.5, Math.PI * 0.5);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawArrow(ctx, x, y, w, h, props) {
        const headSize = props.arrowHeadSize || (w * 0.3);
        const shaftHeight = h * 0.3;
        ctx.beginPath();
        ctx.moveTo(-w/2, -shaftHeight/2);
        ctx.lineTo(w/2 - headSize, -shaftHeight/2);
        ctx.lineTo(w/2 - headSize, -h/2);
        ctx.lineTo(w/2, 0);
        ctx.lineTo(w/2 - headSize, h/2);
        ctx.lineTo(w/2 - headSize, shaftHeight/2);
        ctx.lineTo(-w/2, shaftHeight/2);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawLeftArrow(ctx, x, y, w, h, props) {
        const headSize = props.arrowHeadSize || (w * 0.3);
        const shaftHeight = h * 0.3;
        ctx.beginPath();
        ctx.moveTo(w/2, -shaftHeight/2);
        ctx.lineTo(-w/2 + headSize, -shaftHeight/2);
        ctx.lineTo(-w/2 + headSize, -h/2);
        ctx.lineTo(-w/2, 0);
        ctx.lineTo(-w/2 + headSize, h/2);
        ctx.lineTo(-w/2 + headSize, shaftHeight/2);
        ctx.lineTo(w/2, shaftHeight/2);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawUpArrow(ctx, x, y, w, h, props) {
        const headSize = props.arrowHeadSize || (h * 0.3);
        const shaftWidth = w * 0.3;
        ctx.beginPath();
        ctx.moveTo(-shaftWidth/2, h/2);
        ctx.lineTo(-shaftWidth/2, -h/2 + headSize);
        ctx.lineTo(-w/2, -h/2 + headSize);
        ctx.lineTo(0, -h/2);
        ctx.lineTo(w/2, -h/2 + headSize);
        ctx.lineTo(shaftWidth/2, -h/2 + headSize);
        ctx.lineTo(shaftWidth/2, h/2);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawDownArrow(ctx, x, y, w, h, props) {
        const headSize = props.arrowHeadSize || (h * 0.3);
        const shaftWidth = w * 0.3;
        ctx.beginPath();
        ctx.moveTo(-shaftWidth/2, -h/2);
        ctx.lineTo(-shaftWidth/2, h/2 - headSize);
        ctx.lineTo(-w/2, h/2 - headSize);
        ctx.lineTo(0, h/2);
        ctx.lineTo(w/2, h/2 - headSize);
        ctx.lineTo(shaftWidth/2, h/2 - headSize);
        ctx.lineTo(shaftWidth/2, -h/2);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawLine(ctx, x, y, w, h, props) {
        ctx.beginPath();
        ctx.moveTo(-w/2, 0);
        ctx.lineTo(w/2, 0);
        // Apply Stroke Styling
        if (props.strokeStyle === 'dashed') {
            ctx.setLineDash(props.strokeDashPattern || [12, 6]);
        } else if (props.strokeStyle === 'dotted') {
            ctx.setLineDash([3, 3]);
        } else {
            ctx.setLineDash([]);
        }
        ctx.strokeStyle = props.stroke || '#ffffff';
        ctx.lineWidth = props.strokeWidth || 4;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.setLineDash([]);
    }

    function drawArrowLine(ctx, x, y, w, h, props) {
        ctx.beginPath();
        ctx.moveTo(-w/2, 0);
        ctx.lineTo(w/2, 0);
        ctx.strokeStyle = props.stroke || '#ffffff';
        ctx.lineWidth = props.strokeWidth || 4;
        ctx.stroke();

        // Draw head at end
        ctx.beginPath();
        ctx.moveTo(w/2, 0);
        ctx.lineTo(w/2 - 15, -8);
        ctx.lineTo(w/2 - 15, 8);
        ctx.closePath();
        ctx.fillStyle = props.stroke || '#ffffff';
        ctx.fill();
    }

    function drawDoubleArrowLine(ctx, x, y, w, h, props) {
        ctx.beginPath();
        ctx.moveTo(-w/2, 0);
        ctx.lineTo(w/2, 0);
        ctx.strokeStyle = props.stroke || '#ffffff';
        ctx.lineWidth = props.strokeWidth || 4;
        ctx.stroke();

        // End head
        ctx.beginPath();
        ctx.moveTo(w/2, 0);
        ctx.lineTo(w/2 - 15, -8);
        ctx.lineTo(w/2 - 15, 8);
        ctx.closePath();
        ctx.fillStyle = props.stroke || '#ffffff';
        ctx.fill();

        // Start head
        ctx.beginPath();
        ctx.moveTo(-w/2, 0);
        ctx.lineTo(-w/2 + 15, -8);
        ctx.lineTo(-w/2 + 15, 8);
        ctx.closePath();
        ctx.fill();
    }

    function drawCallout(ctx, x, y, w, h, props) {
        const r = Math.min(props.calloutRadius || 10, w/4, h/4);
        const tw = props.calloutTailWidth || 20;
        const th = props.calloutTailHeight || 30;
        const bodyH = h - th;

        ctx.beginPath();
        ctx.moveTo(-w/2 + r, -bodyH/2);
        ctx.lineTo(w/2 - r, -bodyH/2);
        ctx.arcTo(w/2, -bodyH/2, w/2, -bodyH/2 + r, r);
        ctx.lineTo(w/2, bodyH/2 - r);
        ctx.arcTo(w/2, bodyH/2, w/2 - r, bodyH/2, r);
        ctx.lineTo(tw/2 + 10, bodyH/2);
        ctx.lineTo(0, bodyH/2 + th);
        ctx.lineTo(-tw/2 + 10, bodyH/2);
        ctx.lineTo(-w/2 + r, bodyH/2);
        ctx.arcTo(-w/2, bodyH/2, -w/2, bodyH/2 - r, r);
        ctx.lineTo(-w/2, -bodyH/2 + r);
        ctx.arcTo(-w/2, -bodyH/2, -w/2 + r, -bodyH/2, r);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    function drawOvalCallout(ctx, x, y, w, h, props) {
        const tw = props.calloutTailWidth || 20;
        const th = props.calloutTailHeight || 30;
        const bodyH = h - th;
        
        ctx.beginPath();
        ctx.ellipse(0, -th/2, w/2, bodyH/2, 0, 0, Math.PI * 2);
        fillAndStroke(ctx, props, w, h);

        // Draw tail separate path
        ctx.beginPath();
        ctx.moveTo(-tw/2, -th);
        ctx.lineTo(-tw, th);
        ctx.lineTo(tw/2, -th);
        ctx.closePath();
        fillAndStroke(ctx, props, w, h);
    }

    const SHAPE_MAP = {
        'Rectangle': drawRectangle,
        'Rounded Rectangle': drawRoundedRectangle,
        'RoundedRectangle': drawRoundedRectangle,
        'Single Corner Snipped Rectangle': drawSnippedRectangle,
        'Snip and Round Single Corner Rectangle': drawSnipRoundRectangle,
        'Circle': drawCircle,
        'Ellipse': drawEllipse,
        'Triangle': drawTriangle,
        'Polygon': drawPolygon,
        'Star': drawStar,
        '4-Point Star': drawStar,
        '6-Point Star': drawStar,
        '8-Point Star': drawStar,
        'Diamond': drawDiamond,
        'Parallelogram': drawParallelogram,
        'Trapezoid': drawTrapezoid,
        'Hexagon': drawHexagon,
        'Octagon': drawOctagon,
        'Heart': drawHeart,
        'Flowchart Process': drawRectangle,
        'Flowchart Decision': drawDiamond,
        'Flowchart Data': drawParallelogram,
        'Flowchart Terminal': drawFlowchartTerminal,
        'Arrow': drawArrow,
        'Left Arrow': drawLeftArrow,
        'Up Arrow': drawUpArrow,
        'Down Arrow': drawDownArrow,
        'Line': drawLine,
        'Arrow Line': drawArrowLine,
        'Double Arrow Line': drawDoubleArrowLine,
        'Callout': drawCallout,
        'Oval Callout': drawOvalCallout
    };

    function renderShape(ctx, clip) {
        const shapeType = clip.shapeType || clip.name || 'Rectangle';
        const drawFn = SHAPE_MAP[shapeType];
        if (!drawFn) return;

        const x = clip.x !== undefined ? clip.x : 0;
        const y = clip.y !== undefined ? clip.y : 0;
        const w = clip.shapeWidth || 200;
        const h = clip.shapeHeight || 150;
        const rotation = clip.rotation || 0;

        const props = Object.assign({}, DEFAULT_PROPS, clip.shapeProps || {});
        if (clip.color) props.fill = clip.color;
        if (clip.opacity !== undefined) props.opacity = clip.opacity;
        if (clip.cornerRadius !== undefined) props.cornerRadius = clip.cornerRadius;

        if (props.fillType === 'image' && props.fillImage && !props.fillImageElement) {
            if (!window._shapeImageCache) window._shapeImageCache = {};
            if (window._shapeImageCache[props.fillImage]) {
                props.fillImageElement = window._shapeImageCache[props.fillImage];
            } else {
                const img = new Image();
                img.src = props.fillImage;
                img.onload = () => {
                    window._shapeImageCache[props.fillImage] = img;
                    props.fillImageElement = img;
                    if (window.renderCanvasComposition) window.renderCanvasComposition();
                };
            }
        }

        ctx.save();
        ctx.globalAlpha = props.opacity;
        applyTransform(ctx, x, y, w, h, rotation);

        // Reflection Layer
        if (props.reflection) {
            ctx.save();
            ctx.translate(0, h * 0.95);
            ctx.scale(1, -0.4);
            ctx.globalAlpha *= 0.25;
            drawFn(ctx, x, y, w, h, props);
            ctx.restore();
        }

        drawFn(ctx, x, y, w, h, props);
        ctx.restore();
    }

    function createShapeClip(shapeType, canvasWidth, canvasHeight, startTime) {
        const sizes = {
            'Line': { w: 300, h: 8 },
            'Arrow Line': { w: 300, h: 8 },
            'Double Arrow Line': { w: 300, h: 8 }
        };
        const size = sizes[shapeType] || { w: 200, h: 150 };

        let sides = 5;
        let points = 5;
        if (shapeType === '4-Point Star') points = 4;
        if (shapeType === '6-Point Star') points = 6;
        if (shapeType === '8-Point Star') points = 8;

        return {
            id: 'clip_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            name: shapeType,
            type: 'shape',
            shapeType: shapeType,
            startTime: startTime || 0,
            duration: 5.0,
            x: canvasWidth / 2,
            y: canvasHeight / 2,
            shapeWidth: size.w,
            shapeHeight: size.h,
            rotation: 0,
            opacity: 1.0,
            color: '#ffc107',
            shapeProps: {
                fill: '#ffc107',
                stroke: '#000000',
                strokeWidth: 2,
                cornerRadius: 20,
                shadow: { color: 'rgba(0,0,0,0.3)', blur: 8, offsetX: 0, offsetY: 4 },
                sides: sides,
                points: points,
                innerRadius: 0.4,
                fillType: 'solid',
                gradientStartColor: '#ffc107',
                gradientEndColor: '#ff5722',
                patternType: 'stripes',
                patternColor: '#ffffff',
                fillImage: '',
                strokeStyle: 'solid',
                strokeDashPattern: [12, 6],
                blur: 0,
                glow: { color: '#ff00ff', size: 0 },
                reflection: false
            }
        };
    }

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.ShapeRenderer = {
        renderShape,
        createShapeClip,
        CATEGORIES,
        SHAPE_MAP,
        DEFAULT_PROPS
    };
})();
