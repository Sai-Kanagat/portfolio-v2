/* Shadow Theatre: shape recognition from hand landmarks.
   Works on 21-point hands ({x,y} in any consistent units, y down).
   Pure functions, no DOM, so it runs in the browser and in Node tests. */
(function (root) {
  'use strict';

  var F = { thumb: [1, 2, 3, 4], index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };

  function d(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function handSize(h) { return d(h[0], h[9]) || 1e-6; }

  // A finger is extended when its tip is clearly further from the wrist than its middle joint.
  function extended(h, name) {
    var j = F[name];
    if (name === 'thumb') return d(h[4], h[17]) > d(h[2], h[17]) * 1.15 && d(h[4], h[5]) > handSize(h) * 0.45;
    return d(h[j[3]], h[0]) > d(h[j[1]], h[0]) * 1.12;
  }

  function angleBetween(a0, a1, b0, b1) {
    var ax = a1.x - a0.x, ay = a1.y - a0.y, bx = b1.x - b0.x, by = b1.y - b0.y;
    var c = (ax * bx + ay * by) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1e-6);
    return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  }

  function features(h) {
    var s = handSize(h);
    return {
      size: s,
      ext: { thumb: extended(h, 'thumb'), index: extended(h, 'index'), middle: extended(h, 'middle'), ring: extended(h, 'ring'), pinky: extended(h, 'pinky') },
      pinch: Math.max(d(h[4], h[8]), d(h[4], h[12])) / s,            // thumb to index and middle tips
      vSpread: d(h[8], h[12]) / s,                                     // gap between index and middle tips
      tipsTight: (d(h[8], h[12]) + d(h[12], h[16])) / ((d(h[5], h[9]) + d(h[9], h[13])) || 1e-6),              // index, middle, ring held together
      thumbAngle: angleBetween(h[2], h[4], h[5], h[8])                 // thumb vs pointing direction
    };
  }

  // Which way the fingers point on screen.
  function orient(h) {
    var vx = h[9].x - h[0].x, vy = h[9].y - h[0].y, L = Math.hypot(vx, vy) || 1e-6;
    return vy / L < -0.55 ? 'up' : (vy / L > 0.55 ? 'down' : 'side');
  }
  function bits(e) { return (e.thumb ? '1' : '0') + (e.index ? '1' : '0') + (e.middle ? '1' : '0') + (e.ring ? '1' : '0') + (e.pinky ? '1' : '0'); }

  // Finger signature (thumb, index, middle, ring, pinky) + direction -> creature.
  var TABLE = {
    '01001 up': 'lion', '11001 up': 'bat', '10001 up': 'deer', '10001 side': 'whale',
    '01000 up': 'giraffe', '01000 side': 'snake', '01000 down': 'spider',
    '11000 up': 'moon', '11000 side': 'crocodile', '10000 up': 'penguin', '10000 down': 'ghost',
    '00001 up': 'mouse', '01100 side': 'horse', '01101 up': 'peacock',
    '01110 up': 'trident', '01110 side': 'fox', '11111 side': 'fish', '11111 down': 'jellyfish',
    '00000 up': 'hedgehog', '00000 side': 'turtle', '01111 side': 'shark'
  };


  // Single-hand shapes. Order matters: the most specific test runs first.
  function classifyHand(h) {
    var f = features(h), e = f.ext, o = orient(h);
    // Duck: every fingertip gathered onto the thumb to form a beak.
    if (f.pinch < 0.38 && d(h[4], h[16]) / f.size < 0.55 && d(h[4], h[0]) / f.size > 1.1) return 'duck';
    // Swan (Hamsasya): thumb and index tips touch as the beak, the other three fingers up.
    if (d(h[4], h[8]) / f.size < 0.3 && e.middle && e.ring && e.pinky) return 'swan';
    // Lotus (Alapadma): every finger open and fanned wide, pointing up.
    if (o === 'up' && e.thumb && e.index && e.middle && e.ring && e.pinky && f.tipsTight > 1.7) return 'lotus';
    // Rabbit: index and middle up as ears, ring and pinky folded.
    if (o === 'up' && e.index && e.middle && !e.ring && !e.pinky && f.vSpread > 0.22) return 'rabbit';
    // Dog: index, middle, ring held together as the snout, thumb raised as an ear, pinky as the jaw.
    if (e.index && e.middle && e.ring && !e.pinky && f.tipsTight < 1.45 && e.thumb && f.thumbAngle > 35) return 'dog';
    return TABLE[bits(e) + ' ' + o] || null;
  }

  // Two hands.
  function classifyPair(a, b) {
    var s = (handSize(a) + handSize(b)) / 2;
    var thumbs = d(a[4], b[4]) / s, apart = d(a[9], b[9]) / s, wrists = d(a[0], b[0]) / s;
    var ea = features(a).ext, eb = features(b).ext;
    var wings = ['index', 'middle', 'ring'].every(function (n) { return ea[n] && eb[n]; });
    // Bird: thumbs hooked together, fingers spread as wings.
    if (thumbs < 0.5 && wings && apart > 0.9) return 'bird';
    // Butterfly: wrists crossed together, both hands open as wings.
    if (wrists < 0.7 && wings && thumbs > 0.8) return 'butterfly';
    var fist = function (e) { return !e.index && !e.middle && !e.ring && !e.pinky; };
    var vee = function (e) { return e.index && e.middle && !e.ring && !e.pinky; };
    // Bear: two fists side by side as a big head and paws.
    if (fist(ea) && fist(eb) && apart < 2.6) return 'bear';
    // Crab: two V signs as claws.
    if (vee(ea) && vee(eb)) return 'crab';
    return null;
  }

  function classify(hands) {
    if (!hands || !hands.length) return { shape: null, hand: -1 };
    if (hands.length >= 2) {
      var p = classifyPair(hands[0], hands[1]);
      if (p) return { shape: p, hand: -1 };
    }
    for (var i = 0; i < hands.length; i++) {
      var s = classifyHand(hands[i]);
      if (s) return { shape: s, hand: i };
    }
    return { shape: null, hand: -1 };
  }

  /* Synthetic hand builder, used by the tests, the guide diagrams and the no-camera demo.
     spec: { x, y, scale, rot (deg, 0 = fingers point up), fingers: {thumb,index,...}: 'ext'|'curl'|'pinch',
             spread (deg between fingers), thumbAngle (deg away from index) } */
  function makeHand(spec) {
    var sc = spec.scale || 100, rot = (spec.rot || 0) * Math.PI / 180;
    var fg = spec.fingers || {};
    var spread = spec.spread == null ? 10 : spec.spread;
    var pts = new Array(21);
    function put(i, lx, ly) {               // local coords: +y is toward fingertips
      var x = lx * sc, y = -ly * sc;
      pts[i] = { x: spec.x + x * Math.cos(rot) - y * Math.sin(rot), y: spec.y + x * Math.sin(rot) + y * Math.cos(rot) };
    }
    put(0, 0, 0);
    var bases = { index: [-0.32, 0.95], middle: [-0.08, 1.0], ring: [0.15, 0.95], pinky: [0.36, 0.82] };
    var lens = { index: [0.42, 0.26, 0.22], middle: [0.46, 0.29, 0.24], ring: [0.42, 0.27, 0.22], pinky: [0.32, 0.2, 0.18] };
    var offs = { index: -1.5, middle: -0.5, ring: 0.5, pinky: 1.5 };
    var pinchTarget = { x: -0.62, y: 1.15 };
    ['index', 'middle', 'ring', 'pinky'].forEach(function (n) {
      var j = F[n], b = bases[n], L = lens[n], mode = fg[n] || 'ext';
      put(j[0], b[0], b[1]);
      if (mode === 'pinch') {
        for (var k = 1; k < 4; k++) {
          var t = k / 3;
          put(j[k], b[0] + (pinchTarget.x - b[0]) * t + (k === 2 ? -0.05 : 0), b[1] + (pinchTarget.y - b[1]) * t + 0.12 * Math.sin(t * Math.PI));
        }
        return;
      }
      var a = offs[n] * spread * Math.PI / 180, x = b[0], y = b[1];
      if (mode === 'ext') {
        for (var m = 0; m < 3; m++) { x += Math.sin(a) * L[m]; y += Math.cos(a) * L[m]; put(j[m + 1], x, y); }
      } else {                               // curled: fold back toward the palm
        var dirs = [[Math.sin(a), Math.cos(a)], [0.1, -0.9], [0.05, -1]];
        for (var q = 0; q < 3; q++) { x += dirs[q][0] * L[q] * 0.8; y += dirs[q][1] * L[q] * 0.8; put(j[q + 1], x, y); }
      }
    });
    var tm = fg.thumb || 'ext';
    put(1, -0.3, 0.25); put(2, -0.55, 0.45);
    if (tm === 'pinch') { put(3, -0.68, 0.8); put(4, pinchTarget.x, pinchTarget.y - 0.02); }
    else if (tm === 'curl') { put(3, -0.5, 0.65); put(4, -0.3, 0.7); }
    else {
      var ta = (spec.thumbAngle == null ? 50 : spec.thumbAngle) * Math.PI / 180;
      put(3, -0.55 - Math.sin(ta) * 0.3, 0.45 + Math.cos(ta) * 0.3);
      put(4, -0.55 - Math.sin(ta) * 0.55, 0.45 + Math.cos(ta) * 0.55);
    }
    return pts;
  }

  var POSES = {
    dog: function (x, y, s) { return [makeHand({ x: x, y: y, scale: s, rot: -90, spread: 1, thumbAngle: 70, fingers: { pinky: 'curl' } }).map(function (p) { return { x: p.x, y: 2 * y - p.y }; })]; }, // thumb up as the ear
    rabbit: function (x, y, s) { return [makeHand({ x: x, y: y, scale: s, rot: 0, spread: 14, fingers: { ring: 'curl', pinky: 'curl', thumb: 'curl' } })]; },
    duck: function (x, y, s) { return [makeHand({ x: x, y: y, scale: s, rot: -80, fingers: { thumb: 'pinch', index: 'pinch', middle: 'pinch', ring: 'pinch', pinky: 'pinch' } })]; },
    bird: function (x, y, s) {
      var gap = s * 0.55;
      var l = makeHand({ x: x - gap, y: y + s * 0.35, scale: s, rot: -55, spread: 12, thumbAngle: 90 });
      var r = makeHand({ x: x + gap, y: y + s * 0.35, scale: s, rot: -55, spread: 12, thumbAngle: 90 });
      r = r.map(function (p) { return { x: 2 * (x + gap) - p.x, y: p.y }; }); // mirror to make a right hand
      // hook the thumbs together at the centre
      l[4] = { x: x + s * 0.06, y: l[4].y }; r[4] = { x: x - s * 0.06, y: l[4].y };
      return [l, r];
    },
    open: function (x, y, s) { return [makeHand({ x: x, y: y, scale: s, spread: 16, thumbAngle: 60 })]; },
    fist: function (x, y, s) { return [makeHand({ x: x, y: y, scale: s, fingers: { thumb: 'curl', index: 'curl', middle: 'curl', ring: 'curl', pinky: 'curl' } })]; }
  };

  var ROT = { up: 0, side: -90, down: 180 }, FN = ['thumb', 'index', 'middle', 'ring', 'pinky'];
  Object.keys(TABLE).forEach(function (k) {
    var b = k.split(' ')[0], o = k.split(' ')[1], fg = {};
    FN.forEach(function (n, i) { fg[n] = b[i] === '1' ? 'ext' : 'curl'; });
    POSES[TABLE[k]] = function (x, y, s) { return [makeHand({ x: x, y: y, scale: s, rot: ROT[o], spread: 12, thumbAngle: 60, fingers: fg })]; };
  });
  POSES.swan = function (x, y, s) { return [makeHand({ x: x, y: y, scale: s, spread: 12, fingers: { thumb: 'pinch', index: 'pinch' } })]; };
  function pair(x, y, s, gap, rot, spec) {
    var l = makeHand(Object.assign({ x: x - gap, y: y, scale: s, rot: rot }, spec));
    var r = makeHand(Object.assign({ x: x + gap, y: y, scale: s, rot: rot }, spec)).map(function (p) { return { x: 2 * (x + gap) - p.x, y: p.y }; });
    return [l, r];
  }
  POSES.lotus = function (x, y, s) { return [makeHand({ x: x, y: y, scale: s, spread: 16, thumbAngle: 60 })]; };
  POSES.mystery = function (x, y, s) { return [makeHand({ x: x, y: y, scale: s, fingers: { thumb: 'curl', index: 'curl', ring: 'curl', pinky: 'curl' } })]; };
  POSES.butterfly = function (x, y, s) { return pair(x, y + s * 0.4, s, s * 0.12, -35, { spread: 16, thumbAngle: 70 }); };
  POSES.bear = function (x, y, s) { return pair(x, y, s, s * 0.6, 0, { fingers: { thumb: 'curl', index: 'curl', middle: 'curl', ring: 'curl', pinky: 'curl' } }); };
  POSES.crab = function (x, y, s) { return pair(x, y, s, s * 1.1, -20, { spread: 14, fingers: { thumb: 'curl', ring: 'curl', pinky: 'curl' } }); };

  // Everything the theatre knows, in guide order, with how to make it.
  var CATALOG = [
    ['bird', 'Eagle', 'Garuda', 'Both hands, palms toward you. Hook your thumbs together and spread the fingers wide as wings.'],
    ['duck', 'Duck', 'Mukula', 'Bring every fingertip onto your thumb like a closed bud, then point it sideways as a beak.'],
    ['swan', 'Swan', 'Hamsasya', 'Touch the tips of thumb and index finger as the beak. Hold the other three fingers up.'],
    ['moon', 'Crescent moon', 'Chandrakala', 'Thumb and index open in an L, fingers pointing up. The rest folded.'],
    ['deer', 'Deer', 'Mrigashirsha', 'Thumb and little finger out, the middle three folded, fingers pointing up.'],
    ['lion', 'Lion', 'Simhamukha', 'Index and little finger up, middle and ring folded onto the thumb.'],
    ['peacock', 'Peacock', 'Mayura', 'Touch your ring finger to your thumb. Index, middle and little finger up.'],
    ['trident', 'Trident', 'Trishula', 'Index, middle and ring up, thumb and little finger folded.'],
    ['lotus', 'Lotus', 'Alapadma', 'Open every finger and fan them wide, palm toward the candle.'],
    ['rabbit', 'Rabbit', 'Kartarimukha', 'Index and middle up and apart like scissors for the ears. Fold the rest.'],
    ['penguin', 'Penguin', 'Shikhara', 'A fist with the thumb raised.'],
    ['hedgehog', 'Hedgehog', 'Mushti', 'A closed fist, knuckles up.'],
    ['giraffe', 'Giraffe', 'Suchi', 'Index finger alone, pointing up like a needle.'],
    ['dog', 'Dog', '', 'Hand side on, index, middle and ring fingers together as the snout, thumb up as the ear, little finger dropped as the jaw.'],
    ['butterfly', 'Butterfly', '', 'Cross your wrists and open both hands wide, thumbs pointing out.'],
    ['bear', 'Bear', '', 'Two fists side by side, close together.'],
    ['crab', 'Crab', '', 'A V on each hand, held apart like two claws.'],
    ['bat', 'Bat', '', 'Thumb, index and little finger out, fingers pointing up.'],
    ['whale', 'Whale', '', 'Thumb and little finger out, hand turned sideways.'],
    ['snake', 'Snake', '', 'Index finger alone, pointing sideways.'],
    ['spider', 'Spider', '', 'Index finger alone, pointing down.'],
    ['crocodile', 'Crocodile', '', 'Thumb and index in an L, turned sideways.'],
    ['ghost', 'Ghost', '', 'A thumbs down.'],
    ['mouse', 'Mouse', '', 'Little finger alone, pointing up.'],
    ['horse', 'Horse', '', 'Index and middle out, hand sideways.'],
    ['fox', 'Fox', '', 'Three middle fingers out sideways, thumb and little finger folded.'],
    ['fish', 'Fish', '', 'Open hand, fingers pointing sideways.'],
    ['jellyfish', 'Jellyfish', '', 'Open hand, fingers dangling down.'],
    ['turtle', 'Turtle', '', 'A fist turned sideways.'],
    ['shark', 'Shark', '', 'Four fingers out sideways, thumb tucked in.']
  ].map(function (r) { return { id: r[0], name: r[1], mudra: r[2], hint: r[3] }; });

  var api = { classify: classify, classifyHand: classifyHand, classifyPair: classifyPair, features: features, makeHand: makeHand, POSES: POSES, CATALOG: CATALOG, orient: orient };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ShadowShapes = api;
})(this);
