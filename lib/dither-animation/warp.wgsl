import { simplex3d } from "@vgpu/wgsl-std/noise/simplex";

// Sieben Bewegungsmuster als Parametrisierungen EINES Nearest-Warp-Shaders.
// Invariante fuer alle: Zellen werden verschoben, nie interpoliert — binaer
// rein => binaer raus. Alle Zeitverlaeufe sind periodisch in tau ∈ [0,1).
struct Params {
  tau:   f32,   // Loop-Position 0..1
  phase: f32,   // Kosinus-Schleife durchs Noise-Feld (nur drift)
  amp:   f32,   // Amplitude in 384er-Zellen
  mode:  u32,   // 0 drift, 1 sway, 2 flow, 3 ripple, 4 pulse, 5 spin, 6 shimmer
  pivot: vec2f, // Drehpunkt fuer sway, in 384er-Zellen (Waage: Balken OBEN)
  pad:   vec2f,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var ditherTex: texture_2d<f32>;

const PI2: f32 = 6.28318530718;

fn hash01(c: vec2i) -> f32 {
  var n: u32 = u32(c.x) * 1664525u + u32(c.y) * 1013904223u;
  n = (n ^ (n >> 16u)) * 2246822519u;
  n = (n ^ (n >> 13u)) * 3266489917u;
  return f32(n ^ (n >> 16u)) / 4294967295.0;
}

fn ladeZelle(cell: vec2i) -> vec4f {
  let c = clamp(cell, vec2i(0), vec2i(383));
  return textureLoad(ditherTex, c * 2, 0);
}

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let cell = floor(pos.xy / 2.0);
  let mitte = vec2f(192.0, 192.0);
  var warp = vec2f(0.0);

  switch params.mode {
    case 0u: { // drift — isotropes Noise-Feld, Zeit auf Kosinus-Schleife
      let p = cell * 0.028;
      warp = vec2f(
        simplex3d(vec3f(p, params.phase)),
        simplex3d(vec3f(p + vec2f(37.7, 91.3), params.phase + 11.0)),
      ) * params.amp;
    }
    case 1u: { // sway — Pendelrotation um Pivot unten Mitte
      let pivot = params.pivot;
      let theta = params.amp * 0.014 * sin(PI2 * params.tau); // amp≈Grad
      let d = cell - pivot;
      let rot = vec2f(d.x * cos(theta) - d.y * sin(theta),
                      d.x * sin(theta) + d.y * cos(theta));
      warp = rot - d;
    }
    case 2u: { // flow — abwaerts laufende Welle, exakt eine Periode je Loop
      let lambda = 160.0;
      warp = vec2f(0.0, params.amp * sin(PI2 * (params.tau - cell.y / lambda)));
    }
    case 3u: { // ripple — radiale Welle von der Mitte
      let d = cell - mitte;
      let dist = length(d);
      let dir = select(vec2f(0.0), d / max(dist, 0.001), dist > 0.5);
      warp = dir * params.amp * sin(PI2 * (params.tau - dist / 140.0));
    }
    case 4u: { // pulse — radiales Atmen
      warp = (cell - mitte) * (params.amp / 192.0) * sin(PI2 * params.tau);
    }
    case 5u: { // spin — Mikro-Pendelrotation um die Mitte
      let theta = params.amp * 0.010 * sin(PI2 * params.tau);
      let d = cell - mitte;
      warp = vec2f(d.x * cos(theta) - d.y * sin(theta),
                   d.x * sin(theta) + d.y * cos(theta)) - d;
    }
    case 6u: { // shimmer — isolierte Punkte blinzeln zeitversetzt
      // BUGFIX (Vollkorpus-Test 29.08.2026): amp wirkte hier vorher NICHT —
      // der Schwellenwert stand fest auf 0.90, jede Kalibrierung drehte an
      // einem wirkungslosen Hebel. Bilder mit wenigen isolierten Punkten
      // (kyc-pruefung: Dosis 0,09% trotz amp=4, dem Kalibrierungs-Deckel)
      // blieben so unkalibrierbar. Jetzt steuert amp die Blinzel-Haeufigkeit:
      // niedriger Schwellenwert = mehr Punkte pro Frame blinzeln.
      let schwelle = clamp(0.97 - 0.12 * params.amp, 0.55, 0.97);
      let hier = ladeZelle(vec2i(cell));
      if (hier.a > 0.5) {
        let c = vec2i(cell);
        let isoliert = ladeZelle(c + vec2i(1, 0)).a < 0.5
                    && ladeZelle(c - vec2i(1, 0)).a < 0.5
                    && ladeZelle(c + vec2i(0, 1)).a < 0.5
                    && ladeZelle(c - vec2i(0, 1)).a < 0.5;
        if (isoliert && sin(PI2 * (params.tau + hash01(c))) > schwelle) {
          return vec4f(0.0); // kurz aus — bleibt binaer
        }
      }
      return hier;
    }
    default: {}
  }
  return ladeZelle(vec2i(round(cell + warp)));
}
