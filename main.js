// ============================================
// FLIGHT SIMULATOR — main.js
// Aerodynamic physics + Combat system
// ============================================
(function () {
    'use strict';

    // ─── PHYSICS CONSTANTS ───
    const G = 9.81, RHO = 1.225, WING_AREA = 16.2, WING_SPAN = 11;
    const AR = WING_SPAN * WING_SPAN / WING_AREA, MASS = 1200, MAX_THRUST = 18000;
    const CL_ALPHA = 5, CL0 = 0.28, CL_MAX = 1.6, CD0 = 0.027, CD_GEAR = 0.015;
    const OSWALD = 0.8, PITCH_AUTH = 2.5, YAW_AUTH = 0.8, ROLL_AUTH = 3.5, ANG_DAMP = 4.0;
    const GEAR_H = 2, BRAKE_DECEL = 15, ROLL_FRIC = 0.03;

    // ─── COMBAT CONSTANTS ───
    const BOMB_BLAST = 35, MISSILE_SPEED = 600, MISSILE_TURN = 15;
    const GUN_SPEED = 900, GUN_DAMAGE_RADIUS = 8, GUN_FIRE_RATE = 0.08; // 12.5 rounds/sec
    const NUM_TARGETS = 30, DEATH_DELAY = 3;
    const TARGET_TYPES = ['bunker', 'sam', 'radar', 'fuel', 'convoy', 'command'];

    // ─── STATE ───
    let throttle = 0, gearDeployed = true, braking = false;
    const vel = new THREE.Vector3(), angVel = { x: 0, y: 0, z: 0 };
    const keys = {};
    let dead = false, deathTimer = 0;
    let currentWeapon = 0;
    const weaponNames = ['BOMBS', 'MISSILES', 'GUN'];
    const ammo = [20, 20, 500];
    let gunFireTimer = 0, mouseHeld = false;
    // Nitro boost
    let nitroActive = false, nitroFuel = 5.0, nitroCooldown = 0;
    const NITRO_DURATION = 5, NITRO_RECHARGE = 30, NITRO_MULTIPLIER = 3;
    const projectiles = [], explosions = [];
    const targets = [];
    let lockedTarget = null, score = 0;

    // ─── RENDERER ───
    const canvas = document.getElementById('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x7ec8e3);
    scene.fog = new THREE.FogExp2(0xc8dff5, 0.00018);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 15000);

    // ─── LIGHTS ───
    scene.add(new THREE.AmbientLight(0x6688cc, 0.4));
    scene.add(new THREE.HemisphereLight(0x87ceeb, 0x3a7d44, 0.5));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
    sun.position.set(500, 800, 300);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.near = 1; sc.far = 2000;
    sc.left = sc.bottom = -200; sc.right = sc.top = 200;
    scene.add(sun);

    // ─── TERRAIN ───
    function buildTerrain() {
        const geo = new THREE.PlaneGeometry(10000, 10000, 150, 150);
        geo.rotateX(-Math.PI / 2);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), z = pos.getZ(i);
            if (Math.abs(x) < 40 && z > -600 && z < 600) continue;
            let h = Math.sin(x * 0.005) * Math.cos(z * 0.005) * 30
                + Math.sin(x * 0.01 + 1) * Math.cos(z * 0.008 + 2) * 15
                + Math.sin(x * 0.02 + 3) * Math.sin(z * 0.015 + 1) * 8;
            const d = Math.sqrt(x * x + z * z);
            if (d > 2000) h += Math.pow((d - 2000) / 2000, 1.5) * 200 + Math.sin(x * 0.003) * Math.cos(z * 0.004) * 100;
            const t = THREE.MathUtils.smoothstep(Math.abs(x), 40, 200);
            pos.setY(i, h * t);
        }
        geo.computeVertexNormals();
        const cols = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i), x = pos.getX(i), z = pos.getZ(i);
            let r, g, b;
            if (Math.abs(x) < 25 && z > -500 && z < 500) { r = 0.25; g = 0.25; b = 0.27; }
            else if (y < 5) { r = 0.2 + Math.random() * 0.04; g = 0.45 + Math.random() * 0.08; b = 0.15; }
            else if (y < 80) { const f = y / 80; r = 0.2 + f * 0.25; g = 0.45 - f * 0.15; b = 0.15 + f * 0.05; }
            else { const f = Math.min((y - 80) / 200, 1); r = 0.4 + f * 0.5; g = 0.35 + f * 0.5; b = 0.3 + f * 0.55; }
            cols[i * 3] = r; cols[i * 3 + 1] = g; cols[i * 3 + 2] = b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
        mesh.receiveShadow = true; scene.add(mesh);

        // runway markings
        const wh = new THREE.MeshBasicMaterial({ color: 0xffffff });
        for (let z = -480; z < 480; z += 30) {
            const d = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 12), wh);
            d.rotation.x = -Math.PI / 2; d.position.set(0, 0.05, z); scene.add(d);
        }
        for (let e = -1; e <= 1; e += 2)
            for (let i = -8; i <= 8; i += 4) {
                const b = new THREE.Mesh(new THREE.PlaneGeometry(2, 20), wh);
                b.rotation.x = -Math.PI / 2; b.position.set(i, 0.05, e * 480); scene.add(b);
            }
        for (let s = -1; s <= 1; s += 2) {
            const l = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 960), wh);
            l.rotation.x = -Math.PI / 2; l.position.set(s * 22, 0.05, 0); scene.add(l);
        }
    }

    // ─── TERRAIN HEIGHT SAMPLING ───
    function getTerrainHeight(x, z) {
        if (Math.abs(x) < 40 && z > -600 && z < 600) return 0;
        let h = Math.sin(x * 0.005) * Math.cos(z * 0.005) * 30
            + Math.sin(x * 0.01 + 1) * Math.cos(z * 0.008 + 2) * 15
            + Math.sin(x * 0.02 + 3) * Math.sin(z * 0.015 + 1) * 8;
        const d = Math.sqrt(x * x + z * z);
        if (d > 2000) h += Math.pow((d - 2000) / 2000, 1.5) * 200 + Math.sin(x * 0.003) * Math.cos(z * 0.004) * 100;
        const t = THREE.MathUtils.smoothstep(Math.abs(x), 40, 200);
        return Math.max(h * t, 0);
    }

    // ─── TREES ───
    function buildTrees() {
        const tg = new THREE.CylinderGeometry(0.3, 0.4, 3, 5);
        const tm = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
        const lg = new THREE.ConeGeometry(2.5, 6, 5);
        const lm = new THREE.MeshLambertMaterial({ color: 0x2d5a27 });
        for (let i = 0; i < 350; i++) {
            const x = (Math.random() - 0.5) * 4000, z = (Math.random() - 0.5) * 4000;
            if (Math.abs(x) < 60 && Math.abs(z) < 600) continue;
            const g = new THREE.Group();
            const trunk = new THREE.Mesh(tg, tm); trunk.position.y = 1.5; g.add(trunk);
            const leaf = new THREE.Mesh(lg, lm); leaf.position.y = 5.5; g.add(leaf);
            const s = 0.8 + Math.random() * 1.2; g.scale.set(s, s, s);
            g.position.set(x, 0, z); g.castShadow = true; scene.add(g);
        }
    }

    // ─── AIRCRAFT ───
    let aircraft, propeller, gearGroup;
    function buildAircraft() {
        aircraft = new THREE.Group();
        const bodyMat = new THREE.MeshPhongMaterial({ color: 0x6b7b8d, shininess: 90 });
        const darkMat = new THREE.MeshPhongMaterial({ color: 0x2a2a2a, shininess: 40 });
        const accentMat = new THREE.MeshPhongMaterial({ color: 0x4a5568, shininess: 60 });
        const glassMat = new THREE.MeshPhongMaterial({ color: 0x66bbff, transparent: true, opacity: 0.5, shininess: 120 });
        const glowMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.6 });

        // ── FUSELAGE ── angular stealth body
        const fuseGeo = new THREE.BoxGeometry(1.6, 0.9, 10);
        aircraft.add(new THREE.Mesh(fuseGeo, bodyMat));
        // nose — angular pointed
        const noseGeo = new THREE.ConeGeometry(0.85, 4, 4);
        noseGeo.rotateX(-Math.PI / 2); noseGeo.rotateY(Math.PI / 4);
        const nose = new THREE.Mesh(noseGeo, bodyMat);
        nose.position.z = -7; nose.scale.set(0.95, 0.55, 1);
        aircraft.add(nose);
        // radome tip
        const radome = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.2, 4), darkMat);
        radome.rotation.x = -Math.PI / 2; radome.rotation.y = Math.PI / 4;
        radome.position.z = -9; radome.scale.set(1, 0.5, 1);
        aircraft.add(radome);

        // ── INTAKE ── DSI under nose
        const intake = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 2.5), darkMat);
        intake.position.set(0, -0.6, -4.5);
        aircraft.add(intake);

        // ── CANOPY ── bubble
        const canopyGeo = new THREE.SphereGeometry(0.65, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        const canopy = new THREE.Mesh(canopyGeo, glassMat);
        canopy.position.set(0, 0.45, -3.5); canopy.scale.set(0.9, 0.5, 2.2);
        aircraft.add(canopy);

        // ── WINGS ── trapezoidal delta
        for (let s = -1; s <= 1; s += 2) {
            // main wing
            const wGeo = new THREE.BufferGeometry();
            const verts = new Float32Array([
                0, 0, 1.5, s * 7, 0, -0.5, 0, 0, -1.5,  // top tri
                0, -0.1, 1.5, s * 7, -0.1, -0.5, 0, -0.1, -1.5, // bottom tri
                0, 0, 1.5, s * 7, 0, -0.5, 0, -0.1, 1.5,  // front
                s * 7, 0, -0.5, s * 7, -0.1, -0.5, 0, -0.1, 1.5,
                s * 7, 0, -0.5, 0, 0, -1.5, s * 7, -0.1, -0.5, // back
                0, 0, -1.5, 0, -0.1, -1.5, s * 7, -0.1, -0.5,
            ]);
            wGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
            wGeo.computeVertexNormals();
            aircraft.add(new THREE.Mesh(wGeo, bodyMat));
            // nav light
            const navLight = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 6, 6),
                new THREE.MeshBasicMaterial({ color: s === 1 ? 0x00ff00 : 0xff0000 })
            );
            navLight.position.set(s * 7, 0, -0.5);
            aircraft.add(navLight);
        }

        // ── CANTED VERTICAL STABILIZERS ──
        for (let s = -1; s <= 1; s += 2) {
            const vGeo = new THREE.BufferGeometry();
            const vv = new Float32Array([
                0, 0, 0, -0.3, 2.5, 0, 1.2, 0, 0,
                -0.3, 2.5, 0, 0.8, 2.2, 0, 1.2, 0, 0,
            ]);
            vGeo.setAttribute('position', new THREE.BufferAttribute(vv, 3));
            vGeo.computeVertexNormals();
            const vstab = new THREE.Mesh(vGeo, accentMat);
            vstab.position.set(s * 1.2, 0.3, 5);
            vstab.rotation.z = s * -0.25;
            aircraft.add(vstab);
        }

        // ── HORIZONTAL STABILIZERS ──
        for (let s = -1; s <= 1; s += 2) {
            const hstab = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.08, 1.5), bodyMat);
            hstab.position.set(s * 2.5, 0, 6.5);
            aircraft.add(hstab);
        }

        // ── ENGINE EXHAUST + AFTERBURNER ──
        const exGeo = new THREE.CylinderGeometry(0.5, 0.6, 1.5, 8);
        exGeo.rotateX(Math.PI / 2);
        aircraft.add(new THREE.Mesh(exGeo, darkMat)).position.set(0, 0, 7.5);
        const abGeo = new THREE.ConeGeometry(0.4, 2.5, 8);
        abGeo.rotateX(Math.PI / 2);
        const afterburner = new THREE.Mesh(abGeo, glowMat);
        afterburner.position.set(0, 0, 9);
        afterburner.name = 'afterburner';
        aircraft.add(afterburner);

        // ── WEAPON PYLONS ──
        const pylonMat = new THREE.MeshPhongMaterial({ color: 0x555555 });
        const missileMat = new THREE.MeshPhongMaterial({ color: 0xcccccc, shininess: 60 });
        const missileRedMat = new THREE.MeshPhongMaterial({ color: 0xdd3333 });
        for (let s = -1; s <= 1; s += 2) {
            const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.7), pylonMat);
            pylon.position.set(s * 3.5, -0.5, 0); aircraft.add(pylon);
            const mBody = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.8, 8), missileMat);
            mBody.rotation.x = Math.PI / 2; mBody.position.set(s * 3.5, -0.85, 0); aircraft.add(mBody);
            const mNose = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.35, 8), missileRedMat);
            mNose.rotation.x = -Math.PI / 2; mNose.position.set(s * 3.5, -0.85, -1.1); aircraft.add(mNose);
        }

        // propeller placeholder (jets don't have one, but keep reference)
        propeller = new THREE.Group();
        propeller.visible = false;
        aircraft.add(propeller);

        // ── LANDING GEAR ──
        gearGroup = new THREE.Group();
        const strutMat = new THREE.MeshPhongMaterial({ color: 0x555555, shininess: 40 });
        const tireMat = new THREE.MeshPhongMaterial({ color: 0x222222, shininess: 10 });
        const sg = new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8);
        const tireGeo = new THREE.TorusGeometry(0.25, 0.1, 8, 16);
        const noseStrut = new THREE.Mesh(sg, strutMat); noseStrut.position.set(0, -1.2, -4); gearGroup.add(noseStrut);
        const noseTire = new THREE.Mesh(tireGeo, tireMat); noseTire.rotation.y = Math.PI / 2; noseTire.position.set(0, -2, -4); gearGroup.add(noseTire);
        for (let s = -1; s <= 1; s += 2) {
            const ms = new THREE.Mesh(sg, strutMat); ms.position.set(s * 2, -1.2, 1); gearGroup.add(ms);
            const mt = new THREE.Mesh(tireGeo, tireMat); mt.rotation.y = Math.PI / 2; mt.position.set(s * 2, -2, 1); gearGroup.add(mt);
        }
        aircraft.add(gearGroup);

        // ── SCALE 2x ──
        aircraft.scale.set(2, 2, 2);

        aircraft.position.set(0, GEAR_H, 400);
        scene.add(aircraft);
    }

    // ─── TARGETS ───
    const targetDefs = [
        // [x, z, type]
        [-300, -200, 'bunker'], [400, -500, 'bunker'], [600, 300, 'bunker'], [-400, 500, 'bunker'], [900, -100, 'bunker'],
        [-500, -800, 'sam'], [800, -300, 'sam'], [-200, 800, 'sam'], [350, 700, 'sam'], [-700, 400, 'sam'],
        [-600, -600, 'radar'], [500, 100, 'radar'], [-900, 600, 'radar'], [1000, -400, 'radar'], [200, -900, 'radar'],
        [700, -700, 'fuel'], [-300, 1000, 'fuel'], [1100, 200, 'fuel'], [-800, -400, 'fuel'], [450, -1100, 'fuel'],
        [-1000, 300, 'convoy'], [600, 900, 'convoy'], [-500, -1000, 'convoy'], [1200, -600, 'convoy'], [300, 1200, 'convoy'],
        [1000, 700, 'command'], [-1100, -200, 'command'], [700, 500, 'command'], [-600, 900, 'command'], [200, -700, 'command']
    ];

    function buildTargetMesh(type) {
        const g = new THREE.Group();
        const concrete = new THREE.MeshPhongMaterial({ color: 0x8b8b7a, shininess: 20 });
        const redMat = new THREE.MeshPhongMaterial({ color: 0xcc2222, emissive: 0x661111 });
        const metalMat = new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 60 });
        const darkMat = new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 30 });
        const greenMat = new THREE.MeshPhongMaterial({ color: 0x556b2f, shininess: 20 });
        const orangeMat = new THREE.MeshPhongMaterial({ color: 0xcc6600, shininess: 30 });
        switch (type) {
            case 'bunker': {
                const base = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 8), concrete);
                base.position.y = 2.5; base.castShadow = true; g.add(base);
                const top = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 1, 8), redMat);
                top.position.y = 5.5; g.add(top);
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 8, 4), new THREE.MeshBasicMaterial({ color: 0xcc2222 }));
                pole.position.y = 9; g.add(pole);
                const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), new THREE.MeshBasicMaterial({ color: 0xff3333, side: THREE.DoubleSide }));
                flag.position.set(1.5, 12, 0); g.add(flag);
                break;
            }
            case 'sam': {
                const platform = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.5, 1.5, 8), greenMat);
                platform.position.y = 0.75; platform.castShadow = true; g.add(platform);
                // launcher rail
                const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 6), metalMat);
                rail.position.set(0, 2.5, 0); rail.rotation.x = -0.4; g.add(rail);
                // missile on rail
                const m = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 3, 6), new THREE.MeshPhongMaterial({ color: 0xdddddd }));
                m.rotation.x = Math.PI / 2; m.position.set(0, 3, 0); m.rotation.z = -0.4; g.add(m);
                // radar dish
                const dish = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6, 0, Math.PI), metalMat);
                dish.position.set(2, 3, 0); dish.rotation.y = Math.PI / 2; g.add(dish);
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3, 4), darkMat);
                pole.position.set(2, 1.5, 0); g.add(pole);
                break;
            }
            case 'radar': {
                const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 12, 6), concrete);
                tower.position.y = 6; tower.castShadow = true; g.add(tower);
                const dome = new THREE.Mesh(new THREE.SphereGeometry(2, 10, 8), new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 80, transparent: true, opacity: 0.7 }));
                dome.position.y = 13; g.add(dome);
                // spinning dish inside
                const dish = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 1), metalMat);
                dish.position.y = 13; g.add(dish);
                // base building
                const base = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), concrete);
                base.position.y = 1.5; g.add(base);
                // red light on top
                const light = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4), redMat);
                light.position.y = 15; g.add(light);
                break;
            }
            case 'fuel': {
                for (let i = -1; i <= 1; i++) {
                    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 5, 12), metalMat);
                    tank.position.set(i * 5, 2.5, 0); tank.castShadow = true; g.add(tank);
                    const cap = new THREE.Mesh(new THREE.SphereGeometry(2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), metalMat);
                    cap.position.set(i * 5, 5, 0); g.add(cap);
                }
                // pipes
                const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 12, 6), orangeMat);
                pipe.rotation.z = Math.PI / 2; pipe.position.set(0, 1, 2.5); g.add(pipe);
                // warning sign
                const sign = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0xffcc00, side: THREE.DoubleSide }));
                sign.position.set(0, 4, -2.5); g.add(sign);
                break;
            }
            case 'convoy': {
                for (let i = -1; i <= 1; i++) {
                    const truck = new THREE.Group();
                    const body = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 5), greenMat);
                    body.position.y = 1.5; body.castShadow = true; truck.add(body);
                    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.5, 2), greenMat);
                    cab.position.set(0, 2.5, -1.5); truck.add(cab);
                    // wheels
                    for (let w = -1; w <= 1; w += 2) {
                        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 8), darkMat);
                        wheel.rotation.z = Math.PI / 2; wheel.position.set(w * 1.7, 0.5, 1); truck.add(wheel);
                        const wheel2 = wheel.clone(); wheel2.position.set(w * 1.7, 0.5, -1); truck.add(wheel2);
                    }
                    truck.position.set(0, 0, i * 8);
                    g.add(truck);
                }
                break;
            }
            case 'command': {
                const bldg = new THREE.Mesh(new THREE.BoxGeometry(7, 6, 7), concrete);
                bldg.position.y = 3; bldg.castShadow = true; g.add(bldg);
                // roof
                const roof = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 8), darkMat);
                roof.position.y = 6.25; g.add(roof);
                // antennas
                for (let a = -1; a <= 1; a += 2) {
                    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5, 4), metalMat);
                    ant.position.set(a * 2.5, 8.5, 0); g.add(ant);
                    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 4, 4), redMat);
                    tip.position.set(a * 2.5, 11, 0); g.add(tip);
                }
                // door
                const door = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3), darkMat);
                door.position.set(0, 1.5, -3.51); g.add(door);
                // flag
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 10, 4), metalMat);
                pole.position.set(3, 5, 3); g.add(pole);
                const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.5), new THREE.MeshBasicMaterial({ color: 0xff3333, side: THREE.DoubleSide }));
                flag.position.set(4.25, 9.5, 3); g.add(flag);
                break;
            }
        }
        return g;
    }

    function buildTargets() {
        targets.forEach(t => { if (t.mesh) scene.remove(t.mesh); });
        targets.length = 0;
        for (let i = 0; i < NUM_TARGETS; i++) {
            const [tx, tz, type] = targetDefs[i];
            const g = buildTargetMesh(type);
            g.position.set(tx, 0, tz);
            scene.add(g);
            targets.push({ mesh: g, pos: new THREE.Vector3(tx, 3, tz), alive: true, type });
        }
    }

    // ─── INPUT ───
    function setupInput() {
        window.addEventListener('keydown', e => {
            // Don't intercept keys when typing in an input field
            if (e.target.tagName === 'INPUT') return;
            keys[e.key.toLowerCase()] = true;
            if (e.key === 'Shift') keys['shift'] = true;
            if (e.key.toLowerCase() === 'm' && !dead) {
                const th = getTerrainHeight(aircraft.position.x, aircraft.position.z);
                const airborne = aircraft.position.y > th + GEAR_H + 5;
                if (airborne || !gearDeployed) {
                    gearDeployed = !gearDeployed;
                    if (gearGroup) gearGroup.visible = gearDeployed;
                }
            }
            if (e.key.toLowerCase() === 'b' && !dead) {
                braking = !braking;
            }
            if (e.key === '`' && !dead) {
                currentWeapon = (currentWeapon + 1) % weaponNames.length;
            }
            if (e.key.toLowerCase() === 'n' && !dead && !nitroActive && nitroCooldown <= 0 && nitroFuel > 0) {
                nitroActive = true;
            }
            e.preventDefault();
        });
        window.addEventListener('keyup', e => {
            keys[e.key.toLowerCase()] = false;
            if (e.key === 'Shift') keys['shift'] = false;
        });
        window.addEventListener('mousedown', e => {
            if (e.button === 0) { mouseHeld = true; if (!dead) fireWeaponMP(); }
        });
        window.addEventListener('mouseup', e => {
            if (e.button === 0) mouseHeld = false;
        });
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    // ─── WEAPONS ───
    function fireWeapon() {
        if (ammo[currentWeapon] <= 0) return;
        ammo[currentWeapon]--;

        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(aircraft.quaternion);
        const spawnPos = aircraft.position.clone().add(new THREE.Vector3(0, -2, 0).applyQuaternion(aircraft.quaternion));

        if (currentWeapon === 0) {
            // BOMB
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(0.5, 8, 6),
                new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 20 })
            );
            mesh.position.copy(spawnPos);
            scene.add(mesh);
            projectiles.push({
                mesh, type: 'bomb',
                vel: vel.clone(),
                life: 15
            });
        } else if (currentWeapon === 1) {
            // MISSILE
            const g = new THREE.Group();
            const mb = new THREE.Mesh(
                new THREE.CylinderGeometry(0.15, 0.15, 2, 6),
                new THREE.MeshPhongMaterial({ color: 0xdddddd })
            );
            mb.rotation.x = Math.PI / 2; g.add(mb);
            // fins
            for (let s = -1; s <= 1; s += 2) {
                const fin = new THREE.Mesh(
                    new THREE.BoxGeometry(0.6, 0.05, 0.4),
                    new THREE.MeshPhongMaterial({ color: 0xee3333 })
                );
                fin.position.set(s * 0.3, 0, 0.8); g.add(fin);
            }
            g.position.copy(aircraft.position.clone().add(fwd.clone().multiplyScalar(15)));
            scene.add(g);
            projectiles.push({
                mesh: g, type: 'missile',
                vel: fwd.clone().multiplyScalar(100),
                target: lockedTarget,
                life: 10,
                owner: 'local',
                age: 0
            });
        } else if (currentWeapon === 2) {
            // GUN
            const bulletMesh = new THREE.Mesh(
                new THREE.SphereGeometry(0.6, 6, 6),
                new THREE.MeshBasicMaterial({ color: 0xffff00 })
            );
            bulletMesh.position.copy(aircraft.position.clone().add(fwd.clone().multiplyScalar(8)));
            scene.add(bulletMesh);
            const spread = new THREE.Vector3(
                (Math.random() - 0.5) * 0.02,
                (Math.random() - 0.5) * 0.02,
                (Math.random() - 0.5) * 0.02
            );
            projectiles.push({
                mesh: bulletMesh, type: 'bullet',
                vel: fwd.clone().add(spread).normalize().multiplyScalar(GUN_SPEED).add(vel),
                life: 3,
                owner: 'local'
            });
        }
    }

    function updateProjectiles(dt) {
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            p.life -= dt;
            if (p.life <= 0) { scene.remove(p.mesh); projectiles.splice(i, 1); continue; }

            if (p.type === 'bomb') {
                p.vel.y -= G * dt; // gravity
                p.mesh.position.add(p.vel.clone().multiplyScalar(dt));
                // ground hit
                if (p.mesh.position.y <= 0) {
                    createExplosion(p.mesh.position.clone(), 1);
                    checkTargetHit(p.mesh.position, BOMB_BLAST);
                    scene.remove(p.mesh); projectiles.splice(i, 1);
                }
            } else if (p.type === 'missile') {
                // accelerate missile
                if (!p.speed) p.speed = 100; // start speed
                p.speed = Math.min(p.speed + 1200 * dt, MISSILE_SPEED); // ramp fast to max

                // guided toward target
                if (p.target) {
                    const tPos = p.target.pos ? p.target.pos : (p.target.mesh ? p.target.mesh.position : null);
                    if (tPos) {
                        // always follow the target
                        const toTarget = tPos.clone().sub(p.mesh.position).normalize();
                        p.vel.copy(toTarget.multiplyScalar(p.speed));
                        p.mesh.lookAt(tPos);

                        // guaranteed kill at exactly 5s
                        if (p.age > 5) {
                            createExplosion(tPos.clone(), 2.5);
                            checkTargetHit(tPos, 30);
                            // if target is a remote player, broadcast the kill
                            if (p.target.conn) {
                                broadcastData({ type: 'playerKill', peerId: Object.keys(connections).find(k => connections[k] === p.target) });
                            }
                            scene.remove(p.mesh); projectiles.splice(i, 1); continue;
                        }
                    }
                } else {
                    // unguided — maintain speed
                    const dir = p.vel.clone().normalize();
                    p.vel.copy(dir.multiplyScalar(p.speed));
                }

                p.mesh.position.add(p.vel.clone().multiplyScalar(dt));
                p.age = (p.age || 0) + dt;

                // hit player check (immune to own missiles)
                if (!dead && p.owner !== 'local') {
                    const distToPlayer = p.mesh.position.distanceTo(aircraft.position);
                    if (distToPlayer < 15) {
                        createExplosion(p.mesh.position.clone(), 2);
                        scene.remove(p.mesh); projectiles.splice(i, 1);
                        die();
                        continue;
                    }
                }

                // ground hit
                if (p.mesh.position.y <= 0) {
                    createExplosion(p.mesh.position.clone(), 1);
                    checkTargetHit(p.mesh.position, 15);
                    scene.remove(p.mesh); projectiles.splice(i, 1);
                }
            } else if (p.type === 'bullet') {
                p.mesh.position.add(p.vel.clone().multiplyScalar(dt));
                // hit targets
                checkTargetHit(p.mesh.position, GUN_DAMAGE_RADIUS);
                // hit remote players
                if (!dead && p.owner !== 'local') {
                    const distToPlayer = p.mesh.position.distanceTo(aircraft.position);
                    if (distToPlayer < 10) {
                        createExplosion(p.mesh.position.clone(), 0.5);
                        scene.remove(p.mesh); projectiles.splice(i, 1);
                        die();
                        continue;
                    }
                }
                // ground hit
                if (p.mesh.position.y <= 0) {
                    scene.remove(p.mesh); projectiles.splice(i, 1);
                }
            }
        }
    }

    function checkTargetHit(pos, radius) {
        for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            if (!t.alive) continue;
            if (t.pos.distanceTo(pos) < radius) {
                t.alive = false;
                t.mesh.visible = false;
                createExplosion(t.pos.clone(), 2);
                score++;
                if (!isSolo) broadcastData({ type: 'targetHit', idx: i });
            }
        }
    }

    // ─── EXPLOSIONS ───
    function createExplosion(pos, size) {
        const g = new THREE.Group();
        // fireball
        const ball = new THREE.Mesh(
            new THREE.SphereGeometry(1, 12, 8),
            new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 1 })
        );
        g.add(ball);
        // debris particles
        for (let i = 0; i < 15; i++) {
            const p = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.5, 0.5),
                new THREE.MeshBasicMaterial({ color: i < 5 ? 0xffcc00 : 0xff4400, transparent: true, opacity: 1 })
            );
            p.userData.vel = new THREE.Vector3(
                (Math.random() - 0.5) * 40,
                Math.random() * 30 + 10,
                (Math.random() - 0.5) * 40
            );
            g.add(p);
        }
        g.position.copy(pos);
        g.userData.timer = 0;
        g.userData.maxTime = 1.5;
        g.userData.size = size;
        scene.add(g);
        explosions.push(g);
    }

    function updateExplosions(dt) {
        for (let i = explosions.length - 1; i >= 0; i--) {
            const ex = explosions[i];
            ex.userData.timer += dt;
            const t = ex.userData.timer / ex.userData.maxTime;
            if (t >= 1) { scene.remove(ex); explosions.splice(i, 1); continue; }

            const sz = ex.userData.size;
            // expand fireball
            const ball = ex.children[0];
            const scale = sz * (1 + t * 8);
            ball.scale.setScalar(scale);
            ball.material.opacity = Math.max(1 - t * 1.5, 0);
            ball.material.color.setHex(t < 0.3 ? 0xffffaa : t < 0.6 ? 0xff8800 : 0x662200);

            // debris
            for (let j = 1; j < ex.children.length; j++) {
                const p = ex.children[j];
                if (p.userData.vel) {
                    p.position.add(p.userData.vel.clone().multiplyScalar(dt));
                    p.userData.vel.y -= G * dt * 2;
                    p.material.opacity = Math.max(1 - t * 2, 0);
                    p.scale.setScalar(Math.max(1 - t, 0.1));
                }
            }
        }
    }

    // ─── LOCK-ON MINI-GAME ───
    let lockProgress = 0; // 0 to 1
    const LOCK_TIME = 0.5; // seconds to full lock
    const LOCK_DECAY = 1.5; // decay rate when off-target
    let lockCandidate = null; // target or remote player being tracked
    let lockRingAngle = 0;
    let lockRingWobbleX = 0, lockRingWobbleY = 0;
    let lockWobbleTimer = 0;
    let lockComplete = false;

    const lockonEl = document.getElementById('lockon-minigame');
    const lockonCanvas = document.getElementById('lockon-canvas');
    const lockonCtx = lockonCanvas.getContext('2d');
    const lockonFill = document.getElementById('lockon-fill');

    function getLockableTargets() {
        // combine ground targets + remote players
        const lockables = [];
        for (const t of targets) {
            if (t.alive) lockables.push({ pos: t.pos, obj: t, isBldg: true });
        }
        for (const pid in connections) {
            const c = connections[pid];
            if (c.mesh) lockables.push({ pos: c.mesh.position, obj: c, isPlayer: true, name: c.name });
        }
        return lockables;
    }

    function updateLockOn(dt) {
        if (currentWeapon !== 1 || dead) {
            lockedTarget = null;
            lockCandidate = null;
            lockProgress = 0;
            lockonEl.style.display = 'none';
            return;
        }

        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(aircraft.quaternion);
        const lockables = getLockableTargets();
        let bestDist = Infinity;
        let candidate = null;

        for (const l of lockables) {
            const toT = l.pos.clone().sub(aircraft.position);
            const dist = toT.length();
            if (dist > 3000) continue;
            const angle = fwd.angleTo(toT.normalize());
            if (angle < 0.4 && dist < bestDist) { // ~23 degrees cone
                bestDist = dist;
                candidate = l;
            }
        }

        if (candidate) {
            lockCandidate = candidate;
            // Check if crosshair is closely aligned (tighter cone for progress)
            const toT = candidate.pos.clone().sub(aircraft.position);
            const preciseAngle = fwd.angleTo(toT.normalize());

            // Wobble the tracking ring
            lockWobbleTimer += dt;
            lockRingWobbleX = Math.sin(lockWobbleTimer * 3.7) * 15 + Math.cos(lockWobbleTimer * 5.3) * 8;
            lockRingWobbleY = Math.cos(lockWobbleTimer * 4.1) * 12 + Math.sin(lockWobbleTimer * 6.7) * 6;

            if (preciseAngle < 0.15) { // tight aim = lock progresses
                lockProgress = Math.min(lockProgress + dt / LOCK_TIME, 1);
            } else if (preciseAngle < 0.3) { // medium aim = slow progress
                lockProgress = Math.min(lockProgress + dt / (LOCK_TIME * 3), 1);
            } else {
                lockProgress = Math.max(lockProgress - LOCK_DECAY * dt, 0);
            }

            // Lock complete!
            if (lockProgress >= 1 && !lockComplete) {
                lockComplete = true;
                if (candidate.isBldg) {
                    lockedTarget = candidate.obj;
                } else {
                    lockedTarget = candidate.obj; // remote player
                }
                // Auto-fire missile
                if (ammo[1] > 0) fireWeaponMP();
                // reset after fire
                setTimeout(() => {
                    lockProgress = 0;
                    lockComplete = false;
                }, 500);
            }

            // Show mini-game overlay
            lockonEl.style.display = 'block';
            lockonFill.style.width = (lockProgress * 100) + '%';
            drawLockOnCanvas(preciseAngle);
            lockRingAngle += dt * 2;
        } else {
            lockCandidate = null;
            lockProgress = Math.max(lockProgress - LOCK_DECAY * dt * 2, 0);
            if (lockProgress <= 0) {
                lockonEl.style.display = 'none';
                lockedTarget = null;
            } else {
                lockonFill.style.width = (lockProgress * 100) + '%';
                drawLockOnCanvas(1); // fading
            }
        }
    }

    function drawLockOnCanvas(aimAngle) {
        const w = lockonCanvas.width, h = lockonCanvas.height;
        const cx = w / 2, cy = h / 2;
        lockonCtx.clearRect(0, 0, w, h);

        // Outer ring
        lockonCtx.strokeStyle = `rgba(239, 71, 111, ${0.3 + lockProgress * 0.5})`;
        lockonCtx.lineWidth = 2;
        lockonCtx.beginPath();
        lockonCtx.arc(cx, cy, 85, 0, Math.PI * 2);
        lockonCtx.stroke();

        // Wobbling tracking ring
        const ringX = cx + lockRingWobbleX * (1 - lockProgress * 0.7);
        const ringY = cy + lockRingWobbleY * (1 - lockProgress * 0.7);
        const ringR = 30 - lockProgress * 10; // shrinks as lock progresses

        lockonCtx.strokeStyle = lockProgress > 0.8 ? '#00f5d4' : '#ef476f';
        lockonCtx.lineWidth = 2;
        lockonCtx.beginPath();
        lockonCtx.arc(ringX, ringY, ringR, 0, Math.PI * 2);
        lockonCtx.stroke();

        // Spinning diamond markers
        for (let i = 0; i < 4; i++) {
            const a = lockRingAngle + i * Math.PI / 2;
            const dr = 70 + Math.sin(lockRingAngle * 3 + i) * 5;
            const dx = cx + Math.cos(a) * dr;
            const dy = cy + Math.sin(a) * dr;
            lockonCtx.save();
            lockonCtx.translate(dx, dy);
            lockonCtx.rotate(a + Math.PI / 4);
            lockonCtx.fillStyle = lockProgress > 0.8 ? '#00f5d4' : '#ef476f';
            lockonCtx.fillRect(-4, -4, 8, 8);
            lockonCtx.restore();
        }

        // Center dot (your aim)
        lockonCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        lockonCtx.beginPath();
        lockonCtx.arc(cx, cy, 3, 0, Math.PI * 2);
        lockonCtx.fill();

        // Aim quality indicator — inner crosshair changes color
        const aimFactor = Math.max(1 - aimAngle / 0.4, 0);
        const aimColor = aimFactor > 0.6 ? '#00f5d4' : aimFactor > 0.3 ? '#f77f00' : '#ef476f';
        lockonCtx.strokeStyle = aimColor;
        lockonCtx.lineWidth = 1.5;
        // small crosshair
        lockonCtx.beginPath();
        lockonCtx.moveTo(cx - 12, cy); lockonCtx.lineTo(cx - 5, cy);
        lockonCtx.moveTo(cx + 5, cy); lockonCtx.lineTo(cx + 12, cy);
        lockonCtx.moveTo(cx, cy - 12); lockonCtx.lineTo(cx, cy - 5);
        lockonCtx.moveTo(cx, cy + 5); lockonCtx.lineTo(cx, cy + 12);
        lockonCtx.stroke();

        // Lock progress arc
        lockonCtx.strokeStyle = lockProgress > 0.8 ? '#00f5d4' : '#ef476f';
        lockonCtx.lineWidth = 3;
        lockonCtx.beginPath();
        lockonCtx.arc(cx, cy, 90, -Math.PI / 2, -Math.PI / 2 + lockProgress * Math.PI * 2);
        lockonCtx.stroke();

        // Distance text
        if (lockCandidate) {
            const dist = Math.round(lockCandidate.pos.distanceTo(aircraft.position));
            lockonCtx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            lockonCtx.font = '10px JetBrains Mono';
            lockonCtx.textAlign = 'center';
            lockonCtx.fillText(dist + 'm', cx, cy + 50);
            if (lockCandidate.isPlayer) {
                lockonCtx.fillStyle = '#ef476f';
                lockonCtx.fillText(lockCandidate.name || 'PLAYER', cx, cy - 45);
            } else {
                lockonCtx.fillStyle = '#f77f00';
                lockonCtx.fillText(lockCandidate.obj.type ? lockCandidate.obj.type.toUpperCase() : 'TARGET', cx, cy - 45);
            }
        }
    }

    // ─── DEATH / RESTART ───
    const deathOverlay = document.getElementById('death-overlay');
    const deathTimerEl = document.getElementById('death-timer');

    function die() {
        if (dead) return;
        dead = true;
        deathTimer = DEATH_DELAY;
        createExplosion(aircraft.position.clone(), 3);
        aircraft.visible = false;
        deathOverlay.classList.add('active');
    }

    function restart() {
        dead = false;
        deathOverlay.classList.remove('active');
        aircraft.visible = true;
        aircraft.position.set(0, 80, 400);
        aircraft.quaternion.identity();
        vel.set(0, 0, -30); // start with some forward speed in the air
        angVel.x = angVel.y = angVel.z = 0;
        throttle = 0.5;
        gearDeployed = false;
        gearGroup.visible = false;
        braking = false;
        ammo[0] = 20; ammo[1] = 20; ammo[2] = 500;
        nitroActive = false; nitroFuel = 5.0; nitroCooldown = 0;
        // clear projectiles
        projectiles.forEach(p => scene.remove(p.mesh));
        projectiles.length = 0;
        // respawn targets
        for (const t of targets) {
            if (!t.alive) { t.alive = true; t.mesh.visible = true; }
        }
        score = 0;
    }

    // ─── PHYSICS ───
    function physics(dt) {
        if (dead) {
            deathTimer -= dt;
            deathTimerEl.textContent = Math.ceil(Math.max(deathTimer, 0));
            if (deathTimer <= 0) restart();
            return;
        }
        dt = Math.min(dt, 0.05);

        if (keys['shift']) throttle = Math.min(throttle + 0.4 * dt, 1);
        if (keys['u']) throttle = Math.max(throttle - 0.4 * dt, 0);

        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(aircraft.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(aircraft.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(aircraft.quaternion);

        const spd = vel.length();
        const q = 0.5 * RHO * spd * spd;

        let alpha = 0;
        if (spd > 0.5) {
            const vn = vel.clone().normalize();
            alpha = Math.atan2(-vn.dot(up), vn.dot(fwd));
        }

        let CL = CL0 + CL_ALPHA * alpha;
        const critA = 0.28;
        if (Math.abs(alpha) > critA) CL *= Math.max(1 - (Math.abs(alpha) - critA) / 0.2, 0.15);
        CL = THREE.MathUtils.clamp(CL, -CL_MAX, CL_MAX);

        let liftDir;
        if (spd > 1) {
            liftDir = vel.clone().normalize().cross(right).normalize();
            if (liftDir.dot(up) < 0) liftDir.negate();
        } else { liftDir = new THREE.Vector3(0, 1, 0); }
        const lift = liftDir.multiplyScalar(q * WING_AREA * CL);

        const CDi = (CL * CL) / (Math.PI * AR * OSWALD);
        const CD = CD0 + CDi + (gearDeployed ? CD_GEAR : 0);
        const drag = spd > 0.1 ? vel.clone().normalize().multiplyScalar(-q * WING_AREA * CD) : new THREE.Vector3();

        const nitroMult = nitroActive ? NITRO_MULTIPLIER : 1;
        const thrust = fwd.clone().multiplyScalar(throttle * MAX_THRUST * nitroMult);
        const weight = new THREE.Vector3(0, -MASS * G, 0);

        const F = new THREE.Vector3().add(lift).add(drag).add(thrust).add(weight);

        // GROUND CONTACT — use actual terrain height
        const terrainH = getTerrainHeight(aircraft.position.x, aircraft.position.z);
        const groundLevel = terrainH + GEAR_H + 0.1;
        if (aircraft.position.y <= groundLevel) {
            // Check if landing is survivable: gear down + roughly upright
            const worldUp = new THREE.Vector3(0, 1, 0);
            const uprightness = up.dot(worldUp);
            const isSafeLanding = gearDeployed && uprightness > 0.7;

            if (!isSafeLanding) {
                die();
                return;
            }

            // Safe landing — ground physics
            if (F.y < 0) F.y = 0;
            aircraft.position.y = terrainH + GEAR_H;
            if (vel.y < 0) { vel.y *= -0.2; if (Math.abs(vel.y) < 0.5) vel.y = 0; }
            const gs = new THREE.Vector3(vel.x, 0, vel.z).length();
            if (gs > 0.1) {
                const fd = new THREE.Vector3(vel.x, 0, vel.z).normalize().negate();
                F.add(fd.clone().multiplyScalar(MASS * G * ROLL_FRIC));
                if (braking) F.add(fd.clone().multiplyScalar(MASS * BRAKE_DECEL));
            }
            if (braking && gs < 1.0) { vel.x = 0; vel.z = 0; }
            const cp = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
            const cr = Math.asin(THREE.MathUtils.clamp(right.y, -1, 1));
            angVel.x -= cp * 3 * dt;
            angVel.z += cr * 3 * dt;
        }

        const acc = F.clone().divideScalar(MASS);
        vel.add(acc.multiplyScalar(dt));
        if (vel.length() > 300) vel.normalize().multiplyScalar(300);
        if (aircraft.position.y <= groundLevel && gearDeployed && vel.length() < 0.3 && throttle < 0.01) vel.multiplyScalar(0.9);

        // Sideslip correction — align velocity toward aircraft forward direction
        if (spd > 2) {
            const sideComp = vel.dot(right); // how much velocity is sideways
            vel.add(right.clone().multiplyScalar(-sideComp * 3.0 * dt)); // push velocity forward
        }

        aircraft.position.add(vel.clone().multiplyScalar(dt));
        // Clamp to terrain
        const minY = getTerrainHeight(aircraft.position.x, aircraft.position.z);
        if (aircraft.position.y < minY) aircraft.position.y = minY;

        // angular
        const ce = THREE.MathUtils.clamp(spd / 40, 0.05, 1.0);
        let pi = 0, yi = 0, ri = 0;
        if (keys['s']) pi = 1; if (keys['w']) pi = -1;
        if (keys['a']) yi = 1; if (keys['d']) yi = -1;
        if (keys['q']) ri = 1; if (keys['e']) ri = -1;

        angVel.x += (pi * PITCH_AUTH * ce - angVel.x * ANG_DAMP) * dt;
        angVel.y += (yi * YAW_AUTH * ce - angVel.y * ANG_DAMP) * dt;
        angVel.z += (ri * ROLL_AUTH * ce - angVel.z * ANG_DAMP) * dt;

        // clamp angular velocity to prevent spinning
        const MAX_ANG = 1.2;
        angVel.x = THREE.MathUtils.clamp(angVel.x, -MAX_ANG, MAX_ANG);
        angVel.y = THREE.MathUtils.clamp(angVel.y, -MAX_ANG, MAX_ANG);
        angVel.z = THREE.MathUtils.clamp(angVel.z, -MAX_ANG, MAX_ANG);

        aircraft.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(right, angVel.x * dt));
        aircraft.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(up, angVel.y * dt));
        aircraft.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(fwd, angVel.z * dt));
        aircraft.quaternion.normalize();
    }

    // ─── CAMERA ───
    function updateCamera() {
        const localOffset = new THREE.Vector3(0, 8, 25);
        const worldOffset = localOffset.applyQuaternion(aircraft.quaternion);
        camera.position.copy(aircraft.position).add(worldOffset);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(aircraft.quaternion);
        camera.lookAt(aircraft.position.clone().add(fwd.multiplyScalar(10)));
    }

    // ─── HUD ───
    const elSpeed = document.getElementById('airspeed');
    const elAlt = document.getElementById('altitude');
    const elVS = document.getElementById('vspeed');
    const elThrottle = document.getElementById('throttle-val');
    const elThrottleFill = document.getElementById('throttle-fill');
    const elHeading = document.getElementById('heading');
    const elGear = document.getElementById('gear-status');
    const elBrake = document.getElementById('brake-status');
    const elStall = document.getElementById('stall-warning');
    const elWeaponName = document.getElementById('weapon-name');
    const elWeaponAmmo = document.getElementById('weapon-ammo');
    const elScore = document.getElementById('score-display');
    const elLock = document.getElementById('lock-indicator');
    const attCanvas = document.getElementById('attitude-canvas');
    const attCtx = attCanvas.getContext('2d');

    function drawAttitude() {
        const w = attCanvas.width, h = attCanvas.height, cx = w / 2, cy = h / 2, r = w / 2 - 4;
        attCtx.clearRect(0, 0, w, h);
        attCtx.save();
        attCtx.beginPath(); attCtx.arc(cx, cy, r, 0, Math.PI * 2); attCtx.clip();
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(aircraft.quaternion);
        const right2 = new THREE.Vector3(1, 0, 0).applyQuaternion(aircraft.quaternion);
        const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
        const roll = Math.atan2(right2.y, right2.x);
        attCtx.translate(cx, cy); attCtx.rotate(-roll);
        const pOff = pitch * (r / (Math.PI / 4));
        attCtx.fillStyle = '#2288dd'; attCtx.fillRect(-r * 2, -r * 2, r * 4, r * 2 + pOff);
        attCtx.fillStyle = '#885522'; attCtx.fillRect(-r * 2, pOff, r * 4, r * 4);
        attCtx.strokeStyle = '#fff'; attCtx.lineWidth = 2;
        attCtx.beginPath(); attCtx.moveTo(-r * 2, pOff); attCtx.lineTo(r * 2, pOff); attCtx.stroke();
        attCtx.strokeStyle = 'rgba(255,255,255,0.5)'; attCtx.lineWidth = 1;
        for (let d = -20; d <= 20; d += 10) {
            if (d === 0) continue;
            const y = pOff - d * (r / 45);
            attCtx.beginPath(); attCtx.moveTo(-20, y); attCtx.lineTo(20, y); attCtx.stroke();
            attCtx.fillStyle = '#fff'; attCtx.font = '9px JetBrains Mono';
            attCtx.fillText(Math.abs(d) + '', 24, y + 3);
        }
        attCtx.restore();
        attCtx.strokeStyle = '#f77f00'; attCtx.lineWidth = 3;
        attCtx.beginPath(); attCtx.moveTo(cx - 30, cy); attCtx.lineTo(cx - 10, cy); attCtx.stroke();
        attCtx.beginPath(); attCtx.moveTo(cx + 10, cy); attCtx.lineTo(cx + 30, cy); attCtx.stroke();
        attCtx.fillStyle = '#f77f00';
        attCtx.beginPath(); attCtx.arc(cx, cy, 3, 0, Math.PI * 2); attCtx.fill();
    }

    function updateHUD() {
        if (dead) return;
        const kts = vel.length() * 1.94384;
        const altFt = aircraft.position.y * 3.28084;
        const vsFpm = vel.y * 196.85;
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(aircraft.quaternion);
        let hdg = Math.atan2(fwd.x, -fwd.z) * 180 / Math.PI;
        if (hdg < 0) hdg += 360;

        elSpeed.textContent = Math.round(kts);
        elAlt.textContent = Math.round(altFt);
        elVS.textContent = (vsFpm >= 0 ? '+' : '') + Math.round(vsFpm);
        elThrottle.textContent = Math.round(throttle * 100);
        elThrottleFill.style.width = (throttle * 100) + '%';
        elHeading.textContent = String(Math.round(hdg)).padStart(3, '0');

        elGear.textContent = gearDeployed ? 'GEAR ▼ DOWN' : 'GEAR ▲ UP';
        elGear.className = 'status-item' + (gearDeployed ? '' : ' active');
        elBrake.textContent = braking ? 'BRK ON' : 'BRK OFF';
        elBrake.className = 'status-item' + (braking ? ' active' : '');

        const spd = vel.length();
        const stalling = spd > 5 && spd < 22 && aircraft.position.y > GEAR_H + 2;
        elStall.style.display = stalling ? 'block' : 'none';
        elStall.className = 'status-item warning';

        // nitro
        const elNitro = document.getElementById('nitro-status');
        if (nitroActive) {
            const bar = '█'.repeat(Math.ceil(nitroFuel / NITRO_DURATION * 5));
            elNitro.textContent = 'NITRO ' + bar;
            elNitro.className = 'status-item warning';
        } else if (nitroCooldown > 0) {
            elNitro.textContent = 'NITRO ' + Math.ceil(nitroCooldown) + 's';
            elNitro.className = 'status-item';
        } else {
            elNitro.textContent = 'NITRO [N] READY';
            elNitro.className = 'status-item active';
        }

        // weapons
        elWeaponName.textContent = weaponNames[currentWeapon];
        elWeaponAmmo.textContent = ammo[currentWeapon];
        const aliveTargets = targets.filter(t => t.alive).length;
        elScore.textContent = 'TARGETS: ' + score + ' / ' + NUM_TARGETS;

        // lock indicator
        if (lockedTarget && lockedTarget.alive) {
            const screenPos = lockedTarget.pos.clone().project(camera);
            const sx = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
            const sy = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
            if (screenPos.z > 0 && screenPos.z < 1) {
                elLock.style.display = 'block';
                elLock.style.left = sx + 'px';
                elLock.style.top = sy + 'px';
            } else {
                elLock.style.display = 'none';
            }
        } else {
            elLock.style.display = 'none';
        }

        drawAttitude();
    }

    // ─── MULTIPLAYER ───
    let peer = null, isHost = false, isSolo = false;
    const connections = {}; // peerId -> { conn, mesh, targetPos, targetQuat, name, score }
    let myName = 'PILOT-' + Math.random().toString(36).substring(2, 5).toUpperCase();
    let mpScores = {}; // peerId -> score
    const SYNC_RATE = 1 / 15; // 15 Hz
    let syncTimer = 0;

    function genRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
        return code;
    }

    function buildRemoteAircraft() {
        const g = new THREE.Group();
        const body = new THREE.MeshPhongMaterial({ color: 0xff8844, shininess: 80 });
        const accent = new THREE.MeshPhongMaterial({ color: 0xe63946, shininess: 60 });
        const dark = new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 40 });
        // simplified aircraft mesh
        const fg = new THREE.CylinderGeometry(0.7, 0.5, 8, 12); fg.rotateX(Math.PI / 2);
        g.add(new THREE.Mesh(fg, body));
        const ng = new THREE.ConeGeometry(0.7, 2, 12); ng.rotateX(-Math.PI / 2);
        const nose = new THREE.Mesh(ng, dark); nose.position.z = -5; g.add(nose);
        const tg2 = new THREE.ConeGeometry(0.5, 2.5, 12); tg2.rotateX(Math.PI / 2);
        const tail = new THREE.Mesh(tg2, body); tail.position.z = 5.25; g.add(tail);
        const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 0.12, 1.8), body);
        wing.position.set(0, -0.1, 0); g.add(wing);
        for (let s = -1; s <= 1; s += 2) {
            const tip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 1.8), accent);
            tip.position.set(s * 6.4, -0.1, 0); g.add(tip);
        }
        g.add(new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 1.2), body)).position.set(0, 0.2, 5.5);
        const vs = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.5, 1.8), body);
        vs.position.set(0, 1.3, 5); g.add(vs);
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 1.8), accent);
        st.position.set(0, 2.2, 5); g.add(st);
        // nametag sprite
        const canvas2 = document.createElement('canvas');
        canvas2.width = 512; canvas2.height = 128;
        const ctx2 = canvas2.getContext('2d');
        ctx2.fillStyle = '#00f5d4'; ctx2.font = 'bold 56px monospace';
        ctx2.textAlign = 'center'; ctx2.fillText('REMOTE', 256, 80);
        const tex = new THREE.CanvasTexture(canvas2);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
        sprite.position.y = 6; sprite.scale.set(16, 4, 1); g.add(sprite);
        g.userData.nameSprite = sprite;
        g.userData.nameCanvas = canvas2;
        return g;
    }

    function updateRemoteNameTag(peerData, name) {
        const canvas2 = peerData.mesh.userData.nameCanvas;
        const ctx2 = canvas2.getContext('2d');
        ctx2.clearRect(0, 0, 512, 128);
        ctx2.fillStyle = '#00f5d4'; ctx2.font = 'bold 56px monospace';
        ctx2.textAlign = 'center'; ctx2.fillText(name, 256, 80);
        peerData.mesh.userData.nameSprite.material.map.needsUpdate = true;
    }

    function onPeerData(peerId, data) {
        if (data.type === 'state') {
            const c = connections[peerId];
            if (!c) return;
            c.targetPos = new THREE.Vector3(data.px, data.py, data.pz);
            c.targetQuat = new THREE.Quaternion(data.qx, data.qy, data.qz, data.qw);
            if (data.name && data.name !== c.name) {
                c.name = data.name;
                updateRemoteNameTag(c, data.name);
            }
        } else if (data.type === 'fire') {
            // remote player fired a weapon — show projectile
            const pos = new THREE.Vector3(data.px, data.py, data.pz);
            const dir = new THREE.Vector3(data.dx, data.dy, data.dz);
            if (data.weapon === 0) {
                const mesh = new THREE.Mesh(
                    new THREE.SphereGeometry(0.5, 8, 6),
                    new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 20 })
                );
                mesh.position.copy(pos); scene.add(mesh);
                projectiles.push({ mesh, type: 'bomb', vel: dir.clone(), life: 15 });
            } else {
                const g = new THREE.Group();
                const mb = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2, 6), new THREE.MeshPhongMaterial({ color: 0xdddddd }));
                mb.rotation.x = Math.PI / 2; g.add(mb);
                g.position.copy(pos); scene.add(g);
                const tgt = data.targetIdx >= 0 && targets[data.targetIdx] && targets[data.targetIdx].alive ? targets[data.targetIdx] : null;
                projectiles.push({ mesh: g, type: 'missile', vel: dir.clone().multiplyScalar(MISSILE_SPEED), target: tgt, life: 10 });
            }
        } else if (data.type === 'targetHit') {
            const t = targets[data.idx];
            if (t && t.alive) {
                t.alive = false; t.mesh.visible = false;
                createExplosion(t.pos.clone(), 2);
            }
            mpScores[peerId] = (mpScores[peerId] || 0) + 1;
        } else if (data.type === 'hello') {
            const c = connections[peerId];
            if (c) { c.name = data.name; updateRemoteNameTag(c, data.name); }
        }
    }

    function setupConnection(conn) {
        const peerId = conn.peer;
        conn.on('open', () => {
            const mesh = buildRemoteAircraft();
            mesh.position.set(0, 80, 400);
            scene.add(mesh);
            connections[peerId] = { conn, mesh, targetPos: new THREE.Vector3(0, 80, 400), targetQuat: new THREE.Quaternion(), name: peerId.substring(0, 8), score: 0 };
            mpScores[peerId] = 0;
            conn.send({ type: 'hello', name: myName });
            updatePlayerListUI();
        });
        conn.on('data', d => onPeerData(peerId, d));
        conn.on('close', () => {
            if (connections[peerId]) {
                scene.remove(connections[peerId].mesh);
                delete connections[peerId];
                delete mpScores[peerId];
                updatePlayerListUI();
            }
        });
    }

    function broadcastData(data) {
        for (const pid in connections) {
            const c = connections[pid];
            if (c.conn && c.conn.open) c.conn.send(data);
        }
    }

    function sendState() {
        const data = {
            type: 'state',
            px: aircraft.position.x, py: aircraft.position.y, pz: aircraft.position.z,
            qx: aircraft.quaternion.x, qy: aircraft.quaternion.y,
            qz: aircraft.quaternion.z, qw: aircraft.quaternion.w,
            name: myName
        };
        broadcastData(data);
    }

    function updateRemotePlayers(dt) {
        for (const pid in connections) {
            const c = connections[pid];
            if (c.targetPos) c.mesh.position.lerp(c.targetPos, Math.min(dt * 10, 1));
            if (c.targetQuat) c.mesh.quaternion.slerp(c.targetQuat, Math.min(dt * 10, 1));
        }
    }

    // Override checkTargetHit to broadcast
    const _origCheckTargetHit = checkTargetHit;
    function checkTargetHitMP(pos, radius) {
        for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            if (!t.alive) continue;
            if (t.pos.distanceTo(pos) < radius) {
                t.alive = false; t.mesh.visible = false;
                createExplosion(t.pos.clone(), 2);
                score++;
                if (!isSolo) broadcastData({ type: 'targetHit', idx: i });
            }
        }
    }
    // Patch the original — replace all calls
    // We do this by redefining the function name reference
    // Actually we just need to patch the function in the closure. Let's override via a reference:

    const elPlayerList = document.getElementById('player-list');
    const elPlayerItems = document.getElementById('player-list-items');

    function updatePlayerListUI() {
        const pids = Object.keys(connections);
        if (isSolo || pids.length === 0) {
            elPlayerList.style.display = 'none';
            return;
        }
        elPlayerList.style.display = 'block';
        let html = '<div class="player-entry"><span>' + myName + ' (YOU)</span><span class="player-score">' + score + '</span></div>';
        for (const pid of pids) {
            const c = connections[pid];
            html += '<div class="player-entry"><span>' + (c.name || pid.substring(0, 8)) + '</span><span class="player-score">' + (mpScores[pid] || 0) + '</span></div>';
        }
        elPlayerItems.innerHTML = html;
    }

    // ─── LOBBY ───
    const lobbyEl = document.getElementById('mp-lobby');
    const btnHost = document.getElementById('btn-host');
    const btnSolo = document.getElementById('btn-solo');
    const btnShowJoin = document.getElementById('btn-show-join');
    const btnJoin = document.getElementById('btn-join');
    const btnStart = document.getElementById('btn-start');
    const hostPanel = document.getElementById('host-panel');
    const joinPanel = document.getElementById('join-panel');
    const roomCodeEl = document.getElementById('room-code');
    const hostStatusEl = document.getElementById('host-status');
    const joinStatusEl = document.getElementById('join-status');
    const joinCodeInput = document.getElementById('join-code');

    function startGame() {
        lobbyEl.classList.add('hidden');
        document.getElementById('loading').classList.add('hidden');
        requestAnimationFrame(loop);
    }

    btnSolo.addEventListener('click', () => {
        isSolo = true;
        startGame();
    });

    btnHost.addEventListener('click', () => {
        const code = genRoomCode();
        const peerId = 'flightsim-' + code;
        peer = new Peer(peerId);
        peer.on('open', () => {
            roomCodeEl.textContent = code;
            hostStatusEl.textContent = 'Waiting for players...';
        });
        peer.on('connection', conn => {
            setupConnection(conn);
            hostStatusEl.textContent = Object.keys(connections).length + ' player(s) connected';
        });
        peer.on('error', err => {
            hostStatusEl.textContent = 'Error: ' + err.type;
        });
        isHost = true;
        hostPanel.style.display = 'block';
        joinPanel.style.display = 'none';
        document.querySelector('.lobby-buttons').style.display = 'none';
        document.querySelector('.lobby-or').style.display = 'none';
        btnShowJoin.style.display = 'none';
    });

    btnStart.addEventListener('click', () => {
        broadcastData({ type: 'start' });
        startGame();
    });

    btnShowJoin.addEventListener('click', () => {
        joinPanel.style.display = 'block';
        hostPanel.style.display = 'none';
        document.querySelector('.lobby-buttons').style.display = 'none';
        document.querySelector('.lobby-or').style.display = 'none';
        btnShowJoin.style.display = 'none';
    });

    btnJoin.addEventListener('click', () => {
        const code = joinCodeInput.value.toUpperCase().trim();
        if (code.length !== 4) { joinStatusEl.textContent = 'Enter a 4-char code'; return; }
        joinStatusEl.textContent = 'Connecting...';
        peer = new Peer();
        peer.on('open', () => {
            const conn = peer.connect('flightsim-' + code);
            setupConnection(conn);
            conn.on('open', () => {
                joinStatusEl.textContent = 'Connected! Waiting for host...';
                conn.on('data', d => {
                    if (d.type === 'start') startGame();
                });
            });
        });
        peer.on('error', err => {
            joinStatusEl.textContent = 'Failed: ' + err.type;
        });
    });

    // patch weapon fire to broadcast
    const _origFireWeapon = fireWeapon;
    function fireWeaponMP() {
        if (ammo[currentWeapon] <= 0) return;
        _origFireWeapon();
        if (!isSolo) {
            const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(aircraft.quaternion);
            broadcastData({
                type: 'fire', weapon: currentWeapon,
                px: aircraft.position.x, py: aircraft.position.y, pz: aircraft.position.z,
                dx: currentWeapon === 0 ? vel.x : fwd.x, dy: currentWeapon === 0 ? vel.y : fwd.y, dz: currentWeapon === 0 ? vel.z : fwd.z,
                targetIdx: lockedTarget ? targets.indexOf(lockedTarget) : -1
            });
        }
    }

    // ─── LOOP ───
    let lastTime = 0;
    function loop(t) {
        requestAnimationFrame(loop);
        const dt = lastTime ? (t - lastTime) / 1000 : 0.016;
        lastTime = t;

        physics(dt);
        if (!dead) {
            propeller.rotation.z += throttle * 40 * dt;
            updateLockOn(dt);

            // Gun auto-fire
            if (mouseHeld && currentWeapon === 2) {
                gunFireTimer += dt;
                while (gunFireTimer >= GUN_FIRE_RATE) {
                    gunFireTimer -= GUN_FIRE_RATE;
                    if (ammo[2] > 0) fireWeaponMP();
                }
            } else {
                gunFireTimer = 0;
            }

            // Nitro boost update
            if (nitroActive) {
                nitroFuel -= dt;
                if (nitroFuel <= 0) {
                    nitroFuel = 0;
                    nitroActive = false;
                    nitroCooldown = NITRO_RECHARGE;
                }
            } else if (nitroCooldown > 0) {
                nitroCooldown -= dt;
                if (nitroCooldown <= 0) {
                    nitroCooldown = 0;
                    nitroFuel = NITRO_DURATION;
                }
            }
        }
        updateProjectiles(dt);
        updateExplosions(dt);
        updateRemotePlayers(dt);
        updateCamera();
        updateHUD();
        updatePlayerListUI();

        // sync state
        if (!isSolo && peer) {
            syncTimer += dt;
            if (syncTimer >= SYNC_RATE) {
                syncTimer = 0;
                sendState();
            }
        }

        renderer.render(scene, camera);
    }

    // ─── INIT ───
    buildTerrain();
    buildTrees();
    buildAircraft();
    buildTargets();
    setupInput();



    // start airborne
    aircraft.position.set(0, 80, 400);
    vel.set(0, 0, -30);
    throttle = 0.5;
    gearDeployed = false;
    gearGroup.visible = false;

    // Show lobby (loading screen shows first, then lobby after assets load)
    setTimeout(() => {
        document.getElementById('loading').classList.add('hidden');
        // lobby is visible by default, game starts on button click
    }, 2200);
})();
