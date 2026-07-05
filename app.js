/* ===========================================================
   FLOWER BLOOM — Real-time Hand Gesture Flower Controller
   ===========================================================
   Uses MediaPipe Hands to track hand gestures and render a
   procedural glowing flower that blooms, grows, and sways
   with wind — all on a Canvas overlay atop the webcam feed.

   When the flower is held in full bloom for a moment, a
   personal message gently reveals itself (see message.js).
   =========================================================== */

// =============================================================
// NOISE — Organic movement via layered sine waves
// =============================================================
class OrganicNoise {
    constructor() {
        this.seeds = Array.from({ length: 8 }, () => Math.random() * 1000);
    }

    /** Returns a value roughly in [-1, 1] */
    get(t, channel = 0) {
        const s = this.seeds[channel % this.seeds.length];
        return (
            Math.sin(t * 0.7 + s) * 0.4 +
            Math.sin(t * 1.3 + s * 1.7) * 0.3 +
            Math.sin(t * 2.1 + s * 0.3) * 0.2 +
            Math.sin(t * 3.7 + s * 2.1) * 0.1
        );
    }
}

// =============================================================
// BOKEH ORB — soft drifting light in the background for depth
// =============================================================
class BokehOrb {
    constructor(cw, ch) {
        this.cw = cw;
        this.ch = ch;
        this.reset();
    }

    reset() {
        this.x = Math.random() * this.cw;
        this.y = Math.random() * this.ch;
        this.radius = 40 + Math.random() * 90;
        this.baseAlpha = 0.03 + Math.random() * 0.05;
        this.hue = 320 + Math.random() * 45;
        this.driftX = (Math.random() - 0.5) * 0.15;
        this.driftY = (Math.random() - 0.5) * 0.1;
        this.phase = Math.random() * Math.PI * 2;
    }

    update(dt, time) {
        this.x += this.driftX * dt;
        this.y += this.driftY * dt;
        if (this.x < -this.radius) this.x = this.cw + this.radius;
        if (this.x > this.cw + this.radius) this.x = -this.radius;
        if (this.y < -this.radius) this.y = this.ch + this.radius;
        if (this.y > this.ch + this.radius) this.y = -this.radius;
        this._pulse = 0.7 + 0.3 * Math.sin(time * 0.4 + this.phase);
    }

    draw(ctx) {
        const alpha = this.baseAlpha * this._pulse;
        const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
        g.addColorStop(0, `hsla(${this.hue}, 90%, 70%, ${alpha})`);
        g.addColorStop(1, `hsla(${this.hue}, 90%, 70%, 0)`);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// =============================================================
// PARTICLE — Floating pollen / sparkle / occasional heart
// =============================================================
class Particle {
    constructor(cw, ch) {
        this.cw = cw;
        this.ch = ch;
        this.reset(true);
    }

    reset(initial = false) {
        this.x = Math.random() * this.cw;
        this.y = initial ? Math.random() * this.ch : this.ch + Math.random() * 40;
        this.isHeart = Math.random() < 0.24;
        // Hearts are drawn noticeably bigger than pollen dots, or the shape just looks like a blurry speck
        this.radius = this.isHeart ? (Math.random() * 2.5 + 3.5) : (Math.random() * 2.5 + 0.5);
        this.vx = (Math.random() - 0.5) * 0.3;
        this.vy = -(Math.random() * 0.6 + 0.15);
        this.life = Math.random() * 300 + 150;
        this.maxLife = this.life;
        this.hue = 330 + Math.random() * 40;          // pink-ish
        this.brightness = 70 + Math.random() * 20;
        this.flickerPhase = Math.random() * Math.PI * 2;
        this.rotation = (Math.random() - 0.5) * 0.6;
    }

    update(windForce, dt) {
        this.x += this.vx + windForce * 1.8;
        this.y += this.vy;
        this.life -= dt;
        if (this.isBurst) {
            // Burst hearts fade out permanently rather than recycling
            this.vy += 0.01 * dt; // slight gravity as they drift
            if (this.life <= 0) this.dead = true;
            return;
        }
        if (this.life <= 0 || this.y < -20 || this.x < -20 || this.x > this.cw + 20) {
            this.reset();
        }
    }

    draw(ctx) {
        const t = this.life / this.maxLife;
        const flicker = 0.5 + 0.5 * Math.sin(this.life * 0.08 + this.flickerPhase);
        const alpha = t * 0.75 * flicker;
        if (alpha < 0.02) return;

        ctx.save();
        ctx.globalAlpha = this.isHeart ? Math.min(1, alpha * 1.3) : alpha;
        ctx.shadowBlur = this.isHeart ? 6 : 12;
        ctx.shadowColor = `hsla(${this.hue}, 100%, ${this.brightness}%, 0.8)`;
        ctx.fillStyle = `hsla(${this.hue}, 95%, ${this.brightness}%, 1)`;

        if (this.isHeart) {
            const s = this.radius * 1.7;
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation);
            ctx.beginPath();
            ctx.moveTo(0, s * 0.3);
            ctx.bezierCurveTo(-s, -s * 0.5, -s * 0.3, -s * 1.1, 0, -s * 0.35);
            ctx.bezierCurveTo(s * 0.3, -s * 1.1, s, -s * 0.5, 0, s * 0.3);
            ctx.fill();
            // Thin bright outline so the heart notch reads clearly even when small
            ctx.shadowBlur = 0;
            ctx.strokeStyle = `hsla(${this.hue - 15}, 100%, 88%, 0.55)`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

// =============================================================
// MAIN APPLICATION
// =============================================================
class FlowerBloomApp {
    constructor() {
        // DOM
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.video = document.getElementById('webcam');
        this.loadingEl = document.getElementById('loading');
        this.instructionsEl = document.getElementById('instructions');
        this.messageCardEl = document.getElementById('messageCard');
        this.messageHeadingEl = document.getElementById('messageHeading');
        this.messageBodyEl = document.getElementById('messageBody');
        this.messageSignatureEl = document.getElementById('messageSignature');
        this.cameraErrorEl = document.getElementById('cameraError');
        this.replayBtnEl = document.getElementById('replayBtn');
        this.photoFrameEl = document.getElementById('photoFrame');
        this.photoFrameImgEl = document.getElementById('photoFrameImg');
        this.photoRevealEl = document.getElementById('photoReveal');
        this.photoRevealImgEl = document.getElementById('photoRevealImg');
        this.messageAutoHideTimer = null;
        this.photoRevealShown = false;

        // Wire up the photo from message.js, if provided
        if (typeof MESSAGE_CONFIG !== 'undefined' && MESSAGE_CONFIG.photo) {
            if (this.photoFrameImgEl) this.photoFrameImgEl.src = MESSAGE_CONFIG.photo;
            if (this.photoRevealImgEl) this.photoRevealImgEl.src = MESSAGE_CONFIG.photo;
        } else {
            this.photoFrameEl?.classList.add('hidden');
        }

        this.replayBtnEl?.addEventListener('click', () => {
            this.messageCardEl?.classList.add('visible');
            this.replayBtnEl?.classList.add('hidden');
            this.scheduleMessageAutoHide();
        });

        // Wire up the personal message text from message.js
        if (typeof MESSAGE_CONFIG !== 'undefined') {
            this.messageHeadingEl.textContent = MESSAGE_CONFIG.heading || '';
            this.messageBodyEl.textContent = MESSAGE_CONFIG.body || '';
            this.messageSignatureEl.textContent = MESSAGE_CONFIG.signature || '';
        }

        // Noise
        this.noise = new OrganicNoise();

        // Time
        this.time = 0;
        this.lastTimestamp = 0;

        // Gesture state (smoothed values)
        this.bloom = 0;
        this.growth = 0;
        this.windForce = 0;

        // Gesture targets (raw from detection)
        this.targetBloom = 0;
        this.targetGrowth = 0;
        this.targetWindForce = 0;

        // Previous hand X for velocity-based wind
        this.prevHandX = 0.5;

        // Hand landmarks (updated each frame by MediaPipe)
        this.handLandmarks = [];
        this.handHandedness = [];
        this.handsDetected = 0;

        // Particles
        this.particles = [];
        this.orbs = [];

        // Message reveal state — flower must be held near full bloom
        // for a sustained moment before the message appears
        this.fullBloomHoldFrames = 0;
        this.fullBloomHoldThreshold = 65; // ~ a bit over a second at 60fps
        this.messageRevealed = false;

        // Setup
        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.initParticles();
        this.initHandTracking();

        // Hide instructions after 8 seconds
        setTimeout(() => {
            this.instructionsEl?.classList.add('hidden');
        }, 8000);

        // Kick off render
        requestAnimationFrame((ts) => this.animate(ts));
    }

    // ---------------------------------------------------------
    // Setup
    // ---------------------------------------------------------
    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        // Re-bound particles
        for (const p of this.particles) {
            p.cw = this.canvas.width;
            p.ch = this.canvas.height;
        }
        for (const o of this.orbs) {
            o.cw = this.canvas.width;
            o.ch = this.canvas.height;
        }
    }

    initParticles() {
        const count = 90;
        for (let i = 0; i < count; i++) {
            this.particles.push(new Particle(this.canvas.width, this.canvas.height));
        }
        const orbCount = 10;
        for (let i = 0; i < orbCount; i++) {
            this.orbs.push(new BokehOrb(this.canvas.width, this.canvas.height));
        }
    }

    initHandTracking() {
        const hands = new Hands({
            locateFile: (file) =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`,
        });

        hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.65,
            minTrackingConfidence: 0.5,
        });

        hands.onResults((r) => this.onHandResults(r));

        const cam = new Camera(this.video, {
            onFrame: async () => {
                await hands.send({ image: this.video });
            },
            width: 1280,
            height: 720,
        });

        cam.start()
            .then(() => {
                setTimeout(() => this.loadingEl?.classList.add('hidden'), 600);
            })
            .catch(() => {
                this.loadingEl?.classList.add('hidden');
                this.cameraErrorEl?.classList.remove('hidden');
            });
    }

    // ---------------------------------------------------------
    // Message auto-hide / replay
    // ---------------------------------------------------------
    scheduleMessageAutoHide() {
        this.clearMessageAutoHide();
        this.messageAutoHideTimer = setTimeout(() => {
            this.messageCardEl?.classList.remove('visible');
            this.replayBtnEl?.classList.remove('hidden');
        }, 14000);
    }

    clearMessageAutoHide() {
        if (this.messageAutoHideTimer) {
            clearTimeout(this.messageAutoHideTimer);
            this.messageAutoHideTimer = null;
        }
    }

    // ---------------------------------------------------------
    // Hand results callback
    // ---------------------------------------------------------
    onHandResults(results) {
        this.handLandmarks = results.multiHandLandmarks || [];
        this.handHandedness = results.multiHandedness || [];
        this.handsDetected = this.handLandmarks.length;

        let leftPinch = 0;
        let rightPinch = 0;
        let hasLeft = false;
        let hasRight = false;
        let windAccum = 0;
        let windSamples = 0;

        if (this.handsDetected > 0) {
            for (let i = 0; i < this.handsDetected; i++) {
                const hand = this.handLandmarks[i];
                const handedness = results.multiHandedness[i];
                // MediaPipe handedness label is 'Left' or 'Right'
                const isLeft = handedness && handedness.label === 'Left';
                const pinch = this.calcPinchDistance(hand);

                if (isLeft) {
                    leftPinch = pinch;
                    hasLeft = true;
                } else {
                    rightPinch = pinch;
                    hasRight = true;
                }

                // Wind from hand horizontal velocity (averaged across hands)
                const c = this.palmCenter(hand);
                const dx = c.x - this.prevHandX;
                windAccum += dx * 12;
                windSamples++;
                this.prevHandX = c.x;
            }

            if (windSamples > 0) {
                this.targetWindForce = windAccum / windSamples;
            }

            // Left hand controls Bloom
            this.targetBloom = hasLeft ? leftPinch : 0;

            // Right hand controls Growth
            this.targetGrowth = hasRight ? rightPinch : 0;
        } else {
            // No hands → slowly close and shrink back to 0
            this.targetBloom *= 0.94;
            this.targetGrowth *= 0.94;
            this.targetWindForce *= 0.9;
        }
    }

    /**
     * Pinch distance: distance between thumb tip (4) and index fingertip (8),
     * normalized by hand size so it works at any distance from the camera.
     * Returns 0 (pinched) → 1 (fully spread).
     */
    calcPinchDistance(lm) {
        const thumb = lm[4];   // thumb tip
        const index = lm[8];   // index fingertip
        const wrist = lm[0];
        const mcp = lm[9];     // middle-finger MCP

        // Reference = wrist-to-MCP distance (scales with hand size in frame)
        const ref = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
        if (ref < 0.01) return 0;

        const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
        // Normalize: pinch ~0 when touching, ~1 when spread wide
        return Math.min(1, Math.max(0, (dist / ref - 0.15) * 1.6));
    }

    /** Rough palm center (average of wrist + MCP joints) */
    palmCenter(lm) {
        const ids = [0, 5, 9, 13, 17];
        let x = 0, y = 0;
        for (const i of ids) { x += lm[i].x; y += lm[i].y; }
        return { x: x / ids.length, y: y / ids.length };
    }

    // =============================================================
    // RENDERING
    // =============================================================

    // ----- Hand Skeleton -----
    drawHandSkeleton(lm, handedness) {
        const ctx = this.ctx;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        // Draw guide line between thumb tip (4) and index fingertip (8)
        const thumbTip = lm[4];
        const indexTip = lm[8];
        if (thumbTip && indexTip) {
            const tx = thumbTip.x * cw;
            const ty = thumbTip.y * ch;
            const ix = indexTip.x * cw;
            const iy = indexTip.y * ch;

            const isLeft = handedness && handedness.label === 'Left';
            const labelText = isLeft ? '✿ Left Hand: Bloom' : '🌱 Right Hand: Grow';
            const glowColor = isLeft ? 'rgba(255, 80, 130, 0.85)' : 'rgba(56, 193, 114, 0.85)';
            const strokeStyle = isLeft ? '#ff5082' : '#38c172';

            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 2;
            ctx.strokeStyle = strokeStyle;
            ctx.shadowBlur = 8;
            ctx.shadowColor = glowColor;
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(ix, iy);
            ctx.stroke();
            ctx.restore();

            // Draw glowing circles at thumb and index tips
            ctx.save();
            ctx.shadowBlur = 10;
            ctx.shadowColor = glowColor;
            ctx.fillStyle = strokeStyle;
            ctx.beginPath();
            ctx.arc(tx, ty, 6, 0, Math.PI * 2);
            ctx.arc(ix, iy, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // Draw unmirrored text label at the midpoint
            const midX = (tx + ix) / 2;
            const midY = (ty + iy) / 2;

            ctx.save();
            // Counter-flip coordinates on X around the canvas center to make text unmirrored
            ctx.translate(cw, 0);
            ctx.scale(-1, 1);

            ctx.font = 'bold 12px Inter, sans-serif';
            const textWidth = ctx.measureText(labelText).width;
            const paddingX = 10;
            const paddingY = 6;
            const pillWidth = textWidth + paddingX * 2;
            const pillHeight = 22;

            const drawX = cw - midX;
            const drawY = midY - 20; // draw slightly above the midpoint

            // Draw background pill
            ctx.fillStyle = 'rgba(10, 5, 20, 0.8)';
            ctx.strokeStyle = strokeStyle;
            ctx.lineWidth = 1;
            ctx.shadowBlur = 6;
            ctx.shadowColor = glowColor;
            ctx.beginPath();
            ctx.roundRect(drawX - pillWidth / 2, drawY - pillHeight / 2, pillWidth, pillHeight, 6);
            ctx.fill();
            ctx.stroke();

            // Draw text
            ctx.fillStyle = '#ffffff';
            ctx.shadowBlur = 0;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelText, drawX, drawY);

            ctx.restore();
        }
    }

    // ----- Stem -----
    drawStem(baseX, baseY, height, windAngle) {
        const ctx = this.ctx;
        const segs = 24;
        const segH = height / segs;

        // Build stem path points
        const pts = [{ x: baseX, y: baseY }];
        for (let i = 1; i <= segs; i++) {
            const t = i / segs;
            const windBend = windAngle * t * t * 40;
            const sway = this.noise.get(this.time * 0.6 + i * 0.25, 0) * 10 * t;
            pts.push({
                x: baseX + windBend + sway,
                y: baseY - segH * i,
            });
        }

        // Draw stem (thick gradient line)
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Outer glow
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(40, 120, 35, 0.25)';
        ctx.shadowBlur = 8;
        ctx.shadowColor = 'rgba(80, 180, 60, 0.3)';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();

        // Core stem
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#3a8a30';
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();

        // Leaves
        this.drawLeaves(pts);

        ctx.restore();

        return { tip: pts[pts.length - 1], pts };
    }

    drawLeaves(stemPts) {
        const ctx = this.ctx;
        const positions = [0.25, 0.45, 0.65];

        for (let li = 0; li < positions.length; li++) {
            const idx = Math.floor(positions[li] * (stemPts.length - 1));
            const pt = stemPts[idx];
            const side = li % 2 === 0 ? 1 : -1;
            const len = 22 + this.growth * 18;
            const angle = side * (0.45 + this.noise.get(this.time * 0.6 + li * 3, 2) * 0.2);

            ctx.save();
            ctx.translate(pt.x, pt.y);
            ctx.rotate(angle);

            const grad = ctx.createLinearGradient(0, 0, len, 0);
            grad.addColorStop(0, 'rgba(55, 140, 45, 0.8)');
            grad.addColorStop(1, 'rgba(75, 170, 60, 0.4)');
            ctx.fillStyle = grad;
            ctx.shadowBlur = 4;
            ctx.shadowColor = 'rgba(80, 200, 60, 0.25)';

            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(len * 0.5, -10, len, -1);
            ctx.quadraticCurveTo(len * 0.5, 10, 0, 0);
            ctx.fill();

            // Leaf vein
            ctx.strokeStyle = 'rgba(90, 180, 70, 0.3)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(3, 0);
            ctx.lineTo(len * 0.8, 0);
            ctx.stroke();

            ctx.restore();
        }
    }

    // ----- Flower Head (Tulip facing upward) -----
    drawFlowerHead(cx, cy, bloom, windAngle, scale) {
        // Boost scale as it blooms to make it feel more dynamic and organic
        const bloomScaleFactor = 1.0 + bloom * 0.18;
        const adjustedScale = scale * bloomScaleFactor;
        const ctx = this.ctx;

        ctx.save();
        ctx.translate(cx, cy);

        // --- Ambient glow behind flower ---
        const glowR = (70 + bloom * 150) * adjustedScale;
        if (bloom > 0.02) {
            const glow = ctx.createRadialGradient(0, -glowR * 0.4, 0, 0, -glowR * 0.4, glowR);
            glow.addColorStop(0, `rgba(255, 100, 150, ${0.5 * bloom})`);
            glow.addColorStop(0.4, `rgba(255, 70, 120, ${0.26 * bloom})`);
            glow.addColorStop(0.75, `rgba(255, 40, 90, ${0.1 * bloom})`);
            glow.addColorStop(1, 'rgba(255, 30, 70, 0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(0, -glowR * 0.4, glowR, 0, Math.PI * 2);
            ctx.fill();
        }

        // Base color definitions (tulip uses beautiful pink/coral/yellow tones)
        const hue = 345; // Pink/crimson base
        const sat = 85;
        const light = 55;

        // --- Outer highlight petals (drawn first, wider spread, adds fullness) ---
        const outerPetals = [
            { angle: -0.32 - bloom * 0.95, lengthMul: 0.8, widthMul: 0.34, hueOffset: 15, lightOffset: -6 },
            { angle: 0.32 + bloom * 0.95, lengthMul: 0.8, widthMul: 0.34, hueOffset: 15, lightOffset: -6 }
        ];

        // --- Tulip Petal Layers ---
        const backPetals = [
            { angle: 0, lengthMul: 1.0, widthMul: 0.4, hueOffset: 0, lightOffset: -4 },
            { angle: -0.15 - bloom * 0.7, lengthMul: 0.95, widthMul: 0.38, hueOffset: 10, lightOffset: -2 },
            { angle: 0.15 + bloom * 0.7, lengthMul: 0.95, widthMul: 0.38, hueOffset: 10, lightOffset: -2 }
        ];

        const frontPetals = [
            { angle: -0.05 - bloom * 0.55, lengthMul: 0.9, widthMul: 0.35, hueOffset: 5, lightOffset: 2 },
            { angle: 0.05 + bloom * 0.55, lengthMul: 0.9, widthMul: 0.35, hueOffset: 5, lightOffset: 2 },
            { angle: 0, lengthMul: 0.85, widthMul: 0.32, hueOffset: -5, lightOffset: 5 }
        ];

        const maxPetalLen = 85 * adjustedScale;

        // Draw outer highlight petals (soft, wide, behind everything)
        for (const p of outerPetals) {
            const flutter = this.noise.get(this.time * 1.0 + p.angle * 8, 6) * 0.05 * (1 + bloom);
            const finalAngle = p.angle + flutter + windAngle * 0.12;
            const len = maxPetalLen * p.lengthMul;
            const wid = maxPetalLen * p.widthMul * (0.55 + bloom * 0.85);

            ctx.save();
            ctx.globalAlpha = 0.55 + bloom * 0.25;
            this.drawTulipPetal(ctx, finalAngle, len, wid, hue + p.hueOffset, sat - 5, light + p.lightOffset, bloom);
            ctx.restore();
        }

        // Draw back petals
        for (const p of backPetals) {
            const flutter = this.noise.get(this.time * 1.2 + p.angle * 10, 3) * 0.04 * (1 + bloom);
            const finalAngle = p.angle + flutter + windAngle * 0.1;
            const len = maxPetalLen * p.lengthMul;
            const wid = maxPetalLen * p.widthMul * (0.6 + bloom * 0.8);

            this.drawTulipPetal(ctx, finalAngle, len, wid, hue + p.hueOffset, sat, light + p.lightOffset, bloom);
        }

        // Draw center details (stamen/pistil) if open
        if (bloom > 0.15) {
            ctx.save();
            ctx.shadowBlur = 0;
            ctx.fillStyle = `rgba(180, 220, 100, ${bloom})`;
            ctx.beginPath();
            ctx.arc(0, -maxPetalLen * 0.2, 5 * adjustedScale, 0, Math.PI * 2);
            ctx.fill();

            const stamenCount = 4;
            for (let i = 0; i < stamenCount; i++) {
                const a = (i / stamenCount) * Math.PI * 2 + this.time * 0.5;
                const r = 8 * adjustedScale * bloom;
                const sx = Math.cos(a) * r;
                const sy = -maxPetalLen * 0.2 + Math.sin(a) * r;

                ctx.strokeStyle = `rgba(220, 200, 80, ${bloom * 0.7})`;
                ctx.lineWidth = 1.5 * adjustedScale;
                ctx.beginPath();
                ctx.moveTo(0, -maxPetalLen * 0.1);
                ctx.lineTo(sx, sy);
                ctx.stroke();

                ctx.fillStyle = `rgba(255, 235, 120, ${bloom})`;
                ctx.beginPath();
                ctx.arc(sx, sy, 2.5 * adjustedScale, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // Draw front petals
        for (const p of frontPetals) {
            const flutter = this.noise.get(this.time * 1.4 + p.angle * 10, 4) * 0.03 * (1 + bloom);
            const finalAngle = p.angle + flutter + windAngle * 0.05;
            const len = maxPetalLen * p.lengthMul;
            const wid = maxPetalLen * p.widthMul * (0.65 + bloom * 0.75);

            this.drawTulipPetal(ctx, finalAngle, len, wid, hue + p.hueOffset, sat, light + p.lightOffset, bloom);
        }

        ctx.restore();
    }

    drawTulipPetal(ctx, angle, length, width, hue, sat, light, bloom) {
        ctx.save();
        ctx.rotate(angle);

        const grad = ctx.createLinearGradient(0, 0, 0, -length);
        grad.addColorStop(0, `hsla(${hue + 25}, ${sat}%, ${light - 8}%, 0.9)`);
        grad.addColorStop(0.4, `hsla(${hue}, ${sat}%, ${light}%, 0.85)`);
        grad.addColorStop(0.85, `hsla(${hue - 10}, ${sat + 10}%, ${light + 10}%, 0.85)`);
        grad.addColorStop(1, `hsla(${hue - 20}, ${sat + 15}%, ${light + 18}%, 0.95)`);

        ctx.fillStyle = grad;
        ctx.shadowBlur = 14 + bloom * 20;
        ctx.shadowColor = `hsla(${hue}, 100%, 68%, ${0.28 + bloom * 0.42})`;

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(
            -width * 1.1, -length * 0.3,
            -width * 0.9, -length * 0.85,
            0, -length
        );
        ctx.bezierCurveTo(
            width * 0.9, -length * 0.85,
            width * 1.1, -length * 0.3,
            0, 0
        );
        ctx.fill();

        // Rim highlight along the petal edge for a radiant, glossy feel
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `hsla(${hue - 20}, ${Math.min(sat + 20, 100)}%, ${Math.min(light + 28, 92)}%, ${0.35 + bloom * 0.25})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(
            width * 0.9, -length * 0.3,
            width * 1.1, -length * 0.85,
            0, -length
        );
        ctx.stroke();

        // Subtle petal vein
        ctx.strokeStyle = `hsla(${hue + 15}, ${sat}%, ${light + 15}%, 0.25)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -length * 0.85);
        ctx.stroke();

        ctx.restore();
    }

    // ----- Side Branches -----
    drawBranch(startX, startY, baseAngle, length, windAngle, scale) {
        const ctx = this.ctx;
        const segs = 12;
        const segL = length / segs;
        const pts = [{ x: startX, y: startY }];

        for (let i = 1; i <= segs; i++) {
            const t = i / segs;
            const windBend = windAngle * t * t * 15;
            const sway = this.noise.get(this.time * 0.8 + i * 0.3, 5) * 4 * t;
            const angle = baseAngle + windBend * 0.02 + sway * 0.01;

            pts.push({
                x: pts[pts.length - 1].x + Math.cos(angle) * segL + windBend * 0.3,
                y: pts[pts.length - 1].y + Math.sin(angle) * segL
            });
        }

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.lineWidth = 4 * scale;
        ctx.strokeStyle = 'rgba(40, 120, 35, 0.2)';
        ctx.shadowBlur = 6;
        ctx.shadowColor = 'rgba(80, 180, 60, 0.25)';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();

        ctx.lineWidth = 2.5 * scale;
        ctx.strokeStyle = '#3a8a30';
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();

        ctx.restore();

        this.drawBranchLeaves(pts, scale);

        return pts[pts.length - 1];
    }

    drawBranchLeaves(branchPts, scale) {
        const ctx = this.ctx;
        if (branchPts.length < 5) return;

        const midIdx = Math.floor(branchPts.length * 0.5);
        const pt = branchPts[midIdx];
        const prevPt = branchPts[midIdx - 1];
        if (!pt || !prevPt) return;

        const angle = Math.atan2(pt.y - prevPt.y, pt.x - prevPt.x) + Math.PI / 2;
        const len = 12 * scale * (1 + this.growth);

        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate(angle);

        const grad = ctx.createLinearGradient(0, 0, len, 0);
        grad.addColorStop(0, 'rgba(55, 140, 45, 0.8)');
        grad.addColorStop(1, 'rgba(75, 170, 60, 0.4)');
        ctx.fillStyle = grad;

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(len * 0.5, -5, len, -1);
        ctx.quadraticCurveTo(len * 0.5, 5, 0, 0);
        ctx.fill();

        ctx.restore();
    }

    // ----- HUD Overlay -----
    drawHUD() {
        const ctx = this.ctx;
        const cw = this.canvas.width;

        ctx.save();

        ctx.translate(cw, 0);
        ctx.scale(-1, 1);

        ctx.font = '600 15px Inter, sans-serif';
        ctx.textAlign = 'left';

        const px = 20;
        const py = 22;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.beginPath();
        ctx.roundRect(px - 10, py - 14, 138, 78, 10);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 170, 200, 0.95)';
        ctx.shadowBlur = 6;
        ctx.shadowColor = 'rgba(255, 100, 150, 0.4)';
        ctx.fillText(`Bloom: ${this.bloom.toFixed(2)}`, px, py + 6);

        ctx.fillStyle = 'rgba(140, 255, 140, 0.95)';
        ctx.shadowColor = 'rgba(80, 255, 80, 0.4)';
        ctx.fillText(`Grow: ${this.growth.toFixed(2)}`, px, py + 28);

        ctx.fillStyle = 'rgba(140, 200, 255, 0.95)';
        ctx.shadowColor = 'rgba(80, 150, 255, 0.4)';
        ctx.fillText(`Wind: ${this.windForce.toFixed(2)}`, px, py + 50);

        ctx.restore();
    }

    // ----- Post-process Glow -----
    drawPostGlow(cx, cy) {
        if (this.bloom < 0.05) return;
        const ctx = this.ctx;

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const r = 120 + this.bloom * 170;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(255, 120, 155, ${this.bloom * 0.2})`);
        g.addColorStop(0.5, `rgba(255, 75, 115, ${this.bloom * 0.09})`);
        g.addColorStop(1, 'rgba(255, 50, 80, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    /** Occasionally spawns a single soft heart drifting up from the flower head */
    maybeEmitFlowerHeart(x, y, dt) {
        if (this.bloom < 0.3) return;
        this.heartEmitTimer = (this.heartEmitTimer || 0) - dt;
        if (this.heartEmitTimer > 0) return;

        // Spawn rate scales gently with how open the flower is
        this.heartEmitTimer = 26 - this.bloom * 12 + Math.random() * 10;

        const p = new Particle(this.canvas.width, this.canvas.height);
        p.x = x + (Math.random() - 0.5) * 20;
        p.y = y;
        p.vx = (Math.random() - 0.5) * 0.25;
        p.vy = -(0.35 + Math.random() * 0.35);
        p.isHeart = true;
        p.isBurst = true; // fades out permanently rather than recycling
        p.radius = 4 + Math.random() * 2.5;
        p.hue = 340 + Math.random() * 20;
        p.life = 140 + Math.random() * 60;
        p.maxLife = p.life;
        this.particles.push(p);
    }

    // ----- Message reveal logic -----
    updateMessageReveal(dt) {
        if (this.messageRevealed) return;

        const heldFully = this.bloom > 0.82 && this.growth > 0.6;
        if (heldFully) {
            this.fullBloomHoldFrames += dt;
        } else {
            // Decay slowly rather than resetting instantly, so a brief
            // wobble of the hands doesn't undo the progress
            this.fullBloomHoldFrames = Math.max(0, this.fullBloomHoldFrames - dt * 0.5);
        }

        if (this.fullBloomHoldFrames >= this.fullBloomHoldThreshold) {
            this.messageRevealed = true;
            this.messageCardEl?.classList.add('visible');
            this.scheduleMessageAutoHide();
            this.spawnHeartBurst();

            if (!this.photoRevealShown) {
                this.photoRevealShown = true;
                this.photoRevealEl?.classList.add('visible');
                // Let it linger softly, then fade back so it doesn't compete with the card
                setTimeout(() => {
                    this.photoRevealEl?.classList.remove('visible');
                }, 5000);
            }
        }
    }

    /** A gentle burst of hearts radiating outward, used once when the message reveals */
    spawnHeartBurst() {
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        const cx = cw / 2;
        const cy = ch / 2;
        const burstCount = 18;

        for (let i = 0; i < burstCount; i++) {
            const p = new Particle(cw, ch);
            const angle = (i / burstCount) * Math.PI * 2 + Math.random() * 0.3;
            const speed = 1.2 + Math.random() * 1.4;
            p.x = cx;
            p.y = cy;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed - 0.6;
            p.isHeart = true;
            p.isBurst = true;
            p.radius = 4.5 + Math.random() * 2.5;
            p.hue = 340 + Math.random() * 25;
            p.life = 90 + Math.random() * 40;
            p.maxLife = p.life;
            this.particles.push(p);
        }
    }

    // =============================================================
    // ANIMATION LOOP
    // =============================================================
    animate(timestamp) {
        const dt = this.lastTimestamp ? (timestamp - this.lastTimestamp) / 16.67 : 1;
        this.lastTimestamp = timestamp;
        this.time += 0.016 * dt;

        const ctx = this.ctx;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        // ---- Smooth interpolation ----
        const lerpSpeed = 0.07 * dt;
        this.bloom += (this.targetBloom - this.bloom) * lerpSpeed;
        this.growth += (this.targetGrowth - this.growth) * 0.05 * dt;
        this.windForce += (this.targetWindForce - this.windForce) * 0.06 * dt;

        // Natural wind always present
        const naturalWind = this.noise.get(this.time * 0.7, 1) * 0.12;
        const totalWind = naturalWind + this.windForce * 0.18;

        // ---- Clear ----
        ctx.clearRect(0, 0, cw, ch);

        // ---- Ambient bokeh (behind everything else) ----
        for (const o of this.orbs) {
            o.update(dt, this.time);
            o.draw(ctx);
        }

        // ---- Draw hand skeletons ----
        for (let i = 0; i < this.handLandmarks.length; i++) {
            const lm = this.handLandmarks[i];
            const handedness = this.handHandedness[i];
            this.drawHandSkeleton(lm, handedness);
        }

        // ---- Particles ----
        for (const p of this.particles) {
            p.update(totalWind, dt);
            p.draw(ctx);
        }
        if (this.particles.some(p => p.dead)) {
            this.particles = this.particles.filter(p => !p.dead);
        }

        // ---- Main flower ----
        if (this.growth > 0.005) {
            const stemBaseX = cw * 0.75;
            const stemBaseY = ch * 0.95;
            const stemH = ch * 0.45 * this.growth;
            const flowerScale = 1.25 * this.growth;

            const stemData = this.drawStem(stemBaseX, stemBaseY, stemH, totalWind);
            const tip = stemData.tip;
            const pts = stemData.pts;

            const branchConfigs = [
                { heightRatio: 0.3, direction: -1, lengthFactor: 0.16, scaleFactor: 0.42 },
                { heightRatio: 0.45, direction: 1, lengthFactor: 0.14, scaleFactor: 0.45 },
                { heightRatio: 0.6, direction: -1, lengthFactor: 0.12, scaleFactor: 0.48 },
                { heightRatio: 0.75, direction: 1, lengthFactor: 0.1, scaleFactor: 0.4 }
            ];

            for (const config of branchConfigs) {
                const idx = Math.floor(pts.length * config.heightRatio);
                if (idx > 0 && idx < pts.length) {
                    const pt = pts[idx];
                    const prevPt = pts[idx - 1] || pt;
                    const tangent = Math.atan2(pt.y - prevPt.y, pt.x - prevPt.x);

                    const branchAngle = tangent + (config.direction * 0.75);
                    const branchLength = ch * config.lengthFactor * this.growth;

                    const branchTip = this.drawBranch(pt.x, pt.y, branchAngle, branchLength, totalWind, this.growth);
                    const subFlowerScale = flowerScale * config.scaleFactor;

                    this.drawFlowerHead(branchTip.x, branchTip.y, this.bloom, totalWind, subFlowerScale);
                    this.drawPostGlow(branchTip.x, branchTip.y);
                }
            }

            // Main flower head
            this.drawFlowerHead(tip.x, tip.y, this.bloom, totalWind, flowerScale);
            this.drawPostGlow(tip.x, tip.y);

            // Gentle hearts rising from the main flower while it blooms
            this.maybeEmitFlowerHeart(tip.x, tip.y, dt);
        }

        // ---- HUD ----
        this.drawHUD();

        // ---- Message reveal ----
        this.updateMessageReveal(dt);

        requestAnimationFrame((ts) => this.animate(ts));
    }
}

// =============================================================
// BOOT
// =============================================================
window.addEventListener('DOMContentLoaded', () => {
    new FlowerBloomApp();
});
